use crate::core::parser::{parse_drive_url, TargetKind};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFileItem {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CompletenessStatus {
    Complete,
    IncompleteListing,
    IncompletePermissionDenied,
    IncompleteNetworkError,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub root_folder_id: String,
    pub root_folder_name: String,
    pub completeness_status: CompletenessStatus,
    pub completeness_reason: Option<String>,
    pub total_folders_count: usize,
    pub total_files_count: usize,
    pub files: Vec<ScanFileItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub folders_scanned: usize,
    pub files_found: usize,
    pub current_path: String,
}

pub struct PublicDriveScanner {
    client: reqwest::Client,
    cancel_flag: Arc<AtomicBool>,
}

impl PublicDriveScanner {
    pub fn new(cancel_flag: Arc<AtomicBool>) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            cancel_flag,
        }
    }

    /// Sanitizes file/folder names against Windows/macOS filesystem reserved characters
    pub fn sanitize_name(name: &str) -> String {
        let mut clean = name
            .replace(['\\', '/', ':', '*', '?', '"', '<', '>', '|'], "_")
            .trim()
            .to_string();

        while clean.starts_with('.') || clean.starts_with(' ') {
            clean.remove(0);
        }
        while clean.ends_with('.') || clean.ends_with(' ') {
            clean.pop();
        }

        if clean.is_empty() {
            "unnamed_item".to_string()
        } else {
            clean
        }
    }

    /// Recursively scans a public Google Drive folder or single file
    pub async fn scan<F>(&self, target_url: &str, on_progress: F) -> Result<ScanResult, String>
    where
        F: Fn(ScanProgress) + Send + Sync + 'static,
    {
        let parsed = parse_drive_url(target_url).map_err(|e| e.to_string())?;

        if parsed.kind == TargetKind::File {
            let single_item = ScanFileItem {
                id: parsed.id.clone(),
                name: format!("file_{}", parsed.id),
                relative_path: format!("file_{}", parsed.id),
                size_bytes: 0,
                mime_type: "application/octet-stream".to_string(),
            };

            return Ok(ScanResult {
                root_folder_id: parsed.id,
                root_folder_name: "Single File Download".to_string(),
                completeness_status: CompletenessStatus::Complete,
                completeness_reason: None,
                total_folders_count: 0,
                total_files_count: 1,
                files: vec![single_item],
            });
        }

        let root_folder_id = parsed.id;
        let mut visited = HashSet::new();
        let mut collected_files = Vec::new();
        let mut root_folder_name = String::new();
        let mut folders_scanned = 0usize;
        let mut completeness_status = CompletenessStatus::Complete;
        let mut completeness_reason = None;

        // BFS traversal stack: (folder_id, relative_path)
        let mut folder_queue = vec![(root_folder_id.clone(), String::new())];

        let link_re = Regex::new(r#"<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)</a>"#).unwrap();
        let folder_href_re = Regex::new(r#"folders/([-_\w]+)"#).unwrap();
        let file_href_re = Regex::new(r#"file/d/([-_\w]+)"#).unwrap();
        let next_page_re = Regex::new(r#"href=["'](/embeddedfolderview\?[^"']*(?:pageToken|start)=[^"']*)["']"#).unwrap();
        let title_re = Regex::new(r#"<title>(.*?)</title>"#).unwrap();
        let tag_strip_re = Regex::new(r#"<[^>]+>"#).unwrap();

        while let Some((curr_folder_id, curr_path)) = folder_queue.pop() {
            if self.cancel_flag.load(Ordering::Relaxed) {
                completeness_status = CompletenessStatus::Cancelled;
                completeness_reason = Some("Scan cancelled by user.".to_string());
                break;
            }

            if visited.contains(&curr_folder_id) {
                continue;
            }
            visited.insert(curr_folder_id.clone());
            folders_scanned += 1;

            let mut page_url = Some(format!(
                "https://drive.google.com/embeddedfolderview?id={}",
                urlencoding::encode(&curr_folder_id)
            ));
            let mut detected_folder_name = String::new();

            while let Some(url) = page_url {
                if self.cancel_flag.load(Ordering::Relaxed) {
                    completeness_status = CompletenessStatus::Cancelled;
                    break;
                }

                on_progress(ScanProgress {
                    folders_scanned,
                    files_found: collected_files.len(),
                    current_path: if curr_path.is_empty() {
                        "Root".to_string()
                    } else {
                        curr_path.clone()
                    },
                });

                let resp = match self.client.get(&url).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        completeness_status = CompletenessStatus::IncompleteNetworkError;
                        completeness_reason = Some(format!("Network error while scanning: {}", e));
                        break;
                    }
                };

                let status = resp.status();
                if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
                    completeness_status = CompletenessStatus::IncompletePermissionDenied;
                    completeness_reason = Some("Access Denied: This Google Drive link is private or restricted by its owner.".to_string());
                    break;
                }
                if status == reqwest::StatusCode::NOT_FOUND {
                    completeness_status = CompletenessStatus::IncompletePermissionDenied;
                    completeness_reason = Some("Resource Not Found: This Google Drive link does not exist or has been deleted.".to_string());
                    break;
                }
                if !status.is_success() {
                    completeness_status = CompletenessStatus::IncompleteNetworkError;
                    completeness_reason = Some(format!("Google Drive returned HTTP status {}", status));
                    break;
                }

                let html = match resp.text().await {
                    Ok(t) => t,
                    Err(e) => {
                        completeness_status = CompletenessStatus::IncompleteNetworkError;
                        completeness_reason = Some(format!("Failed to read HTML body: {}", e));
                        break;
                    }
                };

                // Truncation check
                if !html.contains("</html>") && !html.contains("</body>") && !html.is_empty() {
                    completeness_status = CompletenessStatus::IncompleteListing;
                    completeness_reason = Some("Google Drive response terminated prematurely (missing closing tags).".to_string());
                }

                // Title check
                if detected_folder_name.is_empty() {
                    if let Some(caps) = title_re.captures(&html) {
                        if let Some(m) = caps.get(1) {
                            let raw_title = m.as_str().replace("- Google Drive", "").trim().to_string();
                            detected_folder_name = Self::sanitize_name(&raw_title);
                        }
                    }
                    if detected_folder_name.is_empty() {
                        detected_folder_name = curr_folder_id.clone();
                    }
                }

                if root_folder_name.is_empty() {
                    root_folder_name = detected_folder_name.clone();
                }

                let current_dir = if curr_path.is_empty() {
                    detected_folder_name.clone()
                } else {
                    format!("{}/{}", curr_path, detected_folder_name)
                };

                // Extract all files & subfolders from HTML
                for caps in link_re.captures_iter(&html) {
                    let href = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                    let raw_text = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                    let clean_text = tag_strip_re.replace_all(raw_text, "").trim().to_string();

                    // Check if subfolder
                    if let Some(f_caps) = folder_href_re.captures(href) {
                        if let Some(sub_id) = f_caps.get(1) {
                            let sid = sub_id.as_str().to_string();
                            if !visited.contains(&sid) {
                                folder_queue.push((sid, current_dir.clone()));
                            }
                        }
                        continue;
                    }

                    // Check if file
                    if let Some(file_caps) = file_href_re.captures(href) {
                        if let Some(fid_m) = file_caps.get(1) {
                            let fid = fid_m.as_str().to_string();
                            let fname = if clean_text.is_empty() {
                                format!("file_{}", fid)
                            } else {
                                Self::sanitize_name(&clean_text)
                            };

                            let rel_path = format!("{}/{}", current_dir, fname);
                            collected_files.push(ScanFileItem {
                                id: fid,
                                name: fname,
                                relative_path: rel_path,
                                size_bytes: 0,
                                mime_type: "application/octet-stream".to_string(),
                            });
                        }
                    }
                }

                // Check pagination
                if let Some(next_caps) = next_page_re.captures(&html) {
                    if let Some(next_token) = next_caps.get(1) {
                        let unescaped = next_token.as_str().replace("&amp;", "&");
                        page_url = Some(format!("https://drive.google.com{}", unescaped));
                    } else {
                        page_url = None;
                    }
                } else {
                    page_url = None;
                }
            }
        }

        if root_folder_name.is_empty() {
            root_folder_name = "Google Drive Folder".to_string();
        }

        Ok(ScanResult {
            root_folder_id,
            root_folder_name,
            completeness_status,
            completeness_reason,
            total_folders_count: folders_scanned,
            total_files_count: collected_files.len(),
            files: collected_files,
        })
    }
}
