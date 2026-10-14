use crate::core::fs::{finalize_part_file, resolve_safe_path};
use crate::core::verifier::{FileFormatValidator, VerificationResult};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadItem {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub expected_size: Option<u64>,
    pub md5_checksum: Option<String>,
}

#[derive(Debug, Clone)]
pub struct DownloadWorkerResult {
    pub file_id: String,
    pub final_path: PathBuf,
    pub bytes_written: u64,
    pub verification: VerificationResult,
    pub skipped: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("Cancelled by user")]
    Cancelled,
    #[error("Google Drive daily quota exceeded on this file")]
    QuotaExceeded,
    #[error("Google rate limited / throttled (HTTP {0})")]
    RateLimited(u16),
    #[error("Resource inaccessible / forbidden (HTTP {0})")]
    Forbidden(u16),
    #[error("File not found or deleted (HTTP 404)")]
    NotFound,
    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Filesystem safety error: {0}")]
    FsSafety(#[from] crate::core::fs::FsError),
    #[error("Corrupt file container after download: {0}")]
    CorruptContainer(String),
}

pub struct StreamingDownloadEngine {
    client: reqwest::Client,
}

impl StreamingDownloadEngine {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .cookie_store(true)
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self { client }
    }

    /// Downloads a single file with virus bypass, Range 206 resume, and format verification.
    pub async fn download_file<F>(
        &self,
        item: &DownloadItem,
        dest_root: &Path,
        skip_existing: bool,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        on_progress: F,
    ) -> Result<DownloadWorkerResult, DownloadError>
    where
        F: Fn(u64) + Send + Sync + 'static,
    {
        let final_path = resolve_safe_path(dest_root, &item.relative_path)?;
        let part_path = final_path.with_extension(format!(
            "{}.part",
            final_path.extension().and_then(|e| e.to_str()).unwrap_or("bin")
        ));

        // 1. Skip existing check with integrity verification
        if skip_existing && final_path.exists() {
            let vr = FileFormatValidator::validate(&final_path, item.expected_size, item.md5_checksum.as_deref());
            if vr.is_valid {
                return Ok(DownloadWorkerResult {
                    file_id: item.id.clone(),
                    final_path,
                    bytes_written: vr.actual_size,
                    verification: vr,
                    skipped: true,
                });
            }
        }

        let mut existing_bytes = if part_path.exists() {
            std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };

        // Standard Google Drive unauthenticated endpoints
        let candidate_urls = vec![
            format!("https://drive.google.com/uc?id={}&export=download", item.id),
            format!("https://drive.usercontent.google.com/download?id={}&export=download&confirm=t", item.id),
            format!("https://drive.google.com/uc?export=download&id={}&confirm=t", item.id),
        ];

        let confirm_re = Regex::new(r#"confirm=([0-9A-Za-z_\-]+)"#).unwrap();
        let input_re = Regex::new(r#"<input\s+[^>]*name=["']([^"']+)["']\s+[^>]*value=["']([^"']*)["']"#).unwrap();
        let input_alt_re = Regex::new(r#"<input\s+[^>]*value=["']([^"']*)["']\s+[^>]*name=["']([^"']+)["']"#).unwrap();
        let form_action_re = Regex::new(r#"<form\s+[^>]*action=["']([^"']+)["']"#).unwrap();

        let mut last_error = DownloadError::Forbidden(403);

        for url in candidate_urls {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            let mut req = self.client.get(&url);
            if existing_bytes > 0 {
                req = req.header("Range", format!("bytes={}-", existing_bytes));
            }

            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) => {
                    last_error = DownloadError::Network(e);
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    continue;
                }
            };

            let status = resp.status();

            // Handle rate limits / 429 / 503
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::SERVICE_UNAVAILABLE {
                return Err(DownloadError::RateLimited(status.as_u16()));
            }

            if status == reqwest::StatusCode::FORBIDDEN {
                last_error = DownloadError::Forbidden(status.as_u16());
                continue;
            }

            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(DownloadError::NotFound);
            }

            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_lowercase();

            // Check for Google Virus Warning HTML page on files > 100MB or Quota exceeded
            let resp = if content_type.contains("text/html") {
                let html = resp.text().await.unwrap_or_default();
                if html.contains("Quota exceeded") || html.contains("Too many users have viewed or downloaded this file recently") {
                    return Err(DownloadError::QuotaExceeded);
                }

                // Extract all hidden inputs from Google Drive's virus scan warning form
                let mut form_params = std::collections::HashMap::new();
                for cap in input_re.captures_iter(&html) {
                    form_params.insert(cap[1].to_string(), cap[2].to_string());
                }
                for cap in input_alt_re.captures_iter(&html) {
                    form_params.insert(cap[2].to_string(), cap[1].to_string());
                }

                if !form_params.contains_key("confirm") {
                    if let Some(caps) = confirm_re.captures(&html) {
                        if let Some(token) = caps.get(1) {
                            form_params.insert("confirm".to_string(), token.as_str().to_string());
                        }
                    }
                }

                if form_params.is_empty() && !html.contains("download-form") && !html.contains("Virus scan warning") {
                    last_error = DownloadError::Forbidden(403);
                    continue;
                }

                let action_url = form_action_re.captures(&html)
                    .and_then(|c| c.get(1))
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_else(|| "https://drive.usercontent.google.com/download".to_string());

                let mut query_parts = Vec::new();
                for (k, v) in &form_params {
                    query_parts.push(format!("{}={}", k, urlencoding::encode(v)));
                }
                if !form_params.contains_key("id") {
                    query_parts.push(format!("id={}", item.id));
                }
                if !form_params.contains_key("export") {
                    query_parts.push("export=download".to_string());
                }
                if !form_params.contains_key("confirm") {
                    query_parts.push("confirm=t".to_string());
                }

                let retry_url = format!("{}?{}", action_url, query_parts.join("&"));
                let mut retry_req = self.client.get(&retry_url).header("Referer", &url);
                if existing_bytes > 0 {
                    retry_req = retry_req.header("Range", format!("bytes={}-", existing_bytes));
                }

                match retry_req.send().await {
                    Ok(r) => {
                        let ct = r.headers().get(reqwest::header::CONTENT_TYPE)
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("")
                            .to_lowercase();
                        if ct.contains("text/html") {
                            let text = r.text().await.unwrap_or_default();
                            if text.contains("Quota exceeded") || text.contains("Too many users have viewed or downloaded this file recently") {
                                return Err(DownloadError::QuotaExceeded);
                            }
                            last_error = DownloadError::Forbidden(403);
                            continue;
                        }
                        r
                    }
                    Err(e) => {
                        last_error = DownloadError::Network(e);
                        continue;
                    }
                }
            } else {
                resp
            };

            let resp_status = resp.status();
            let is_partial = resp_status == reqwest::StatusCode::PARTIAL_CONTENT;

            let mut file = if is_partial && existing_bytes > 0 {
                let mut f = OpenOptions::new().write(true).open(&part_path)?;
                f.seek(SeekFrom::End(0))?;
                f
            } else {
                existing_bytes = 0;
                OpenOptions::new().write(true).create(true).truncate(true).open(&part_path)?
            };

            let mut stream = resp.bytes_stream();
            let mut total_written = existing_bytes;

            while let Some(chunk_res) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) {
                    return Err(DownloadError::Cancelled);
                }

                while pause_flag.load(Ordering::Relaxed) && !cancel_flag.load(Ordering::Relaxed) {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                }

                let chunk = match chunk_res {
                    Ok(c) => c,
                    Err(e) => {
                        return Err(DownloadError::Network(e));
                    }
                };

                file.write_all(&chunk)?;
                total_written += chunk.len() as u64;
                on_progress(chunk.len() as u64);
            }

            file.flush()?;
            drop(file);

            // Container structural validation
            let vr = FileFormatValidator::validate(&part_path, item.expected_size, item.md5_checksum.as_deref());
            if !vr.is_valid {
                // If container is incomplete or corrupted, reject
                return Err(DownloadError::CorruptContainer(vr.details));
            }

            // Atomic rename from .part to final file
            finalize_part_file(&part_path, &final_path)?;

            return Ok(DownloadWorkerResult {
                file_id: item.id.clone(),
                final_path,
                bytes_written: total_written,
                verification: vr,
                skipped: false,
            });
        }

        Err(last_error)
    }
}
