use crate::core::engine::{DownloadError, DownloadItem, StreamingDownloadEngine};
use crate::core::storage::Storage;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgressEvent {
    pub job_id: String,
    pub overall_bytes: u64,
    pub overall_total_bytes: u64,
    pub speed_bps: f64,
    pub active_count: usize,
    pub completed_count: usize,
    pub failed_count: usize,
    pub skipped_count: usize,
    pub total_files: usize,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEvent {
    pub job_id: String,
    pub file_id: String,
    pub name: String,
    pub relative_path: String,
    pub bytes: u64,
    pub status: String,
    pub verification: String,
    pub error: Option<String>,
}

pub struct DownloadScheduler {
    storage: Storage,
    engine: Arc<StreamingDownloadEngine>,
}

impl DownloadScheduler {
    pub fn new(storage: Storage) -> Self {
        Self {
            storage,
            engine: Arc::new(StreamingDownloadEngine::new()),
        }
    }

    pub async fn run_job<P, F>(
        &self,
        job_id: String,
        dest_root: PathBuf,
        concurrency: usize,
        skip_existing: bool,
        files: Vec<DownloadItem>,
        cancel_flag: Arc<AtomicBool>,
        pause_flag: Arc<AtomicBool>,
        progress_cb: P,
        file_cb: F,
    ) where
        P: Fn(JobProgressEvent) + Send + Sync + 'static,
        F: Fn(FileEvent) + Send + Sync + 'static,
    {
        let total_files = files.len();
        let configured_concurrency = concurrency.clamp(1, 32);
        let mut effective_concurrency = configured_concurrency;

        let mut queue: VecDeque<DownloadItem> = files.into_iter().collect();
        let mut retry_cycles: HashMap<String, usize> = HashMap::new();

        let mut completed_count = 0usize;
        let mut failed_count = 0usize;
        let mut skipped_count = 0usize;
        let mut overall_bytes = 0u64;

        let mut consecutive_rate_limits = 0usize;
        let mut consecutive_successes = 0usize;

        let active_bytes_map: Arc<Mutex<HashMap<String, u64>>> = Arc::new(Mutex::new(HashMap::new()));
        let (done_tx, mut done_rx) = mpsc::channel::<(String, Result<crate::core::engine::DownloadWorkerResult, (DownloadItem, DownloadError)>)>(64);

        let mut active_count = 0usize;
        let mut last_speed_time = Instant::now();
        let mut last_speed_bytes = 0u64;
        let mut current_speed_bps;

        while (!queue.is_empty() || active_count > 0) && !cancel_flag.load(Ordering::Relaxed) {
            // While paused, wait
            while pause_flag.load(Ordering::Relaxed) && !cancel_flag.load(Ordering::Relaxed) {
                let _ = self.storage.set_job_status(&job_id, "PAUSED");
                tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;
            }

            // Launch workers up to effective concurrency
            while active_count < effective_concurrency && !queue.is_empty() && !cancel_flag.load(Ordering::Relaxed) {
                let item = queue.pop_front().unwrap();
                let file_id = item.id.clone();
                let dest = dest_root.clone();
                let engine = self.engine.clone();
                let c_flag = cancel_flag.clone();
                let p_flag = pause_flag.clone();
                let d_tx = done_tx.clone();
                let act_map = active_bytes_map.clone();
                let f_id = file_id.clone();

                active_count += 1;

                tokio::spawn(async move {
                    let f_id_inner = f_id.clone();
                    let act_map_inner = act_map.clone();
                    let res = engine
                        .download_file(
                            &item,
                            &dest,
                            skip_existing,
                            c_flag,
                            p_flag,
                            move |chunk_bytes| {
                                let fid = f_id_inner.clone();
                                let m = act_map_inner.clone();
                                tokio::spawn(async move {
                                    let mut lock = m.lock().await;
                                    let val = lock.entry(fid).or_insert(0);
                                    *val += chunk_bytes;
                                });
                            },
                        )
                        .await;

                    match res {
                        Ok(worker_res) => {
                            let _ = d_tx.send((f_id, Ok(worker_res))).await;
                        }
                        Err(err) => {
                            let _ = d_tx.send((f_id, Err((item, err)))).await;
                        }
                    }
                });

                // 150ms launch pacing offset to avoid burst connection spikes
                tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
            }

            // Await a worker completion or timeout for progress reporting
            tokio::select! {
                Some((fid, result)) = done_rx.recv() => {
                    active_count = active_count.saturating_sub(1);
                    {
                        let mut lock = active_bytes_map.lock().await;
                        lock.remove(&fid);
                    }

                    match result {
                        Ok(worker_res) => {
                            consecutive_rate_limits = 0;
                            consecutive_successes += 1;

                            // Additive increase in concurrency if traffic is smooth
                            if consecutive_successes >= 6 && effective_concurrency < configured_concurrency {
                                effective_concurrency = (effective_concurrency + 1).min(configured_concurrency);
                                consecutive_successes = 0;
                            }

                            if worker_res.skipped {
                                skipped_count += 1;
                            } else {
                                completed_count += 1;
                            }
                            overall_bytes += worker_res.bytes_written;

                            let status_str = if worker_res.skipped { "SKIPPED" } else { "COMPLETED" };
                            let _ = self.storage.update_file_completion(
                                &job_id,
                                &worker_res.file_id,
                                status_str,
                                worker_res.bytes_written,
                                &worker_res.verification.format_name,
                                Some(&worker_res.verification.format_name),
                                None
                            );

                            file_cb(FileEvent {
                                job_id: job_id.clone(),
                                file_id: worker_res.file_id,
                                name: worker_res.final_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                                relative_path: worker_res.final_path.to_string_lossy().to_string(),
                                bytes: worker_res.bytes_written,
                                status: status_str.to_string(),
                                verification: worker_res.verification.format_name,
                                error: None,
                            });
                        }
                        Err((item, err)) => {
                            let cycles = retry_cycles.get(&item.id).copied().unwrap_or(0);
                            let is_throttle = matches!(err, DownloadError::RateLimited(_));

                            if is_throttle && cycles < 5 {
                                consecutive_rate_limits += 1;
                                consecutive_successes = 0;

                                // Circuit breaker: multiplicative decrease
                                if consecutive_rate_limits >= 2 {
                                    effective_concurrency = (effective_concurrency / 2).max(4);
                                    // Cooldown delay
                                    tokio::time::sleep(tokio::time::Duration::from_millis(2500)).await;
                                }

                                // Tail Re-Queueing
                                retry_cycles.insert(item.id.clone(), cycles + 1);
                                queue.push_back(item);
                            } else {
                                // Permanent failure
                                failed_count += 1;
                                let err_msg = err.to_string();

                                let _ = self.storage.update_file_completion(
                                    &job_id,
                                    &item.id,
                                    "FAILED",
                                    0,
                                    "UNVERIFIED",
                                    None,
                                    Some(&err_msg),
                                );

                                file_cb(FileEvent {
                                    job_id: job_id.clone(),
                                    file_id: item.id,
                                    name: item.name,
                                    relative_path: item.relative_path,
                                    bytes: 0,
                                    status: "FAILED".to_string(),
                                    verification: "UNVERIFIED".to_string(),
                                    error: Some(err_msg),
                                });
                            }
                        }
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(300)) => {}
            }

            // Calculate instantaneous speed
            let now = Instant::now();
            let dt = now.duration_since(last_speed_time).as_secs_f64();
            if dt >= 0.4 {
                let in_flight: u64 = {
                    let lock = active_bytes_map.lock().await;
                    lock.values().sum()
                };
                let total_current = overall_bytes + in_flight;
                let delta = total_current.saturating_sub(last_speed_bytes);
                current_speed_bps = delta as f64 / dt;
                last_speed_time = now;
                last_speed_bytes = total_current;

                let _ = self.storage.update_job_progress(
                    &job_id,
                    completed_count,
                    failed_count,
                    skipped_count,
                    total_current,
                    "RUNNING"
                );

                progress_cb(JobProgressEvent {
                    job_id: job_id.clone(),
                    overall_bytes: total_current,
                    overall_total_bytes: 0,
                    speed_bps: current_speed_bps,
                    active_count,
                    completed_count,
                    failed_count,
                    skipped_count,
                    total_files,
                    status: "RUNNING".to_string(),
                });
            }
        }

        let final_status = if cancel_flag.load(Ordering::Relaxed) {
            "CANCELLED"
        } else if failed_count > 0 && completed_count == 0 {
            "FAILED"
        } else {
            "COMPLETED"
        };

        let _ = self.storage.update_job_progress(
            &job_id,
            completed_count,
            failed_count,
            skipped_count,
            overall_bytes,
            final_status
        );

        progress_cb(JobProgressEvent {
            job_id: job_id.clone(),
            overall_bytes,
            overall_total_bytes: overall_bytes,
            speed_bps: 0.0,
            active_count: 0,
            completed_count,
            failed_count,
            skipped_count,
            total_files,
            status: final_status.to_string(),
        });
    }
}
