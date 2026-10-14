pub mod core;

use crate::core::diagnostics::{DiagnosticsManager, DiagnosticsReport};
use crate::core::engine::DownloadItem;
use crate::core::licensing::{LicenseState, LicensingManager};
use crate::core::scanner::{PublicDriveScanner, ScanProgress, ScanResult};
use crate::core::scheduler::DownloadScheduler;
use crate::core::storage::{DbJob, DbJobFile, Storage};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub storage: Storage,
    pub scan_cancel_flag: Arc<AtomicBool>,
    pub download_cancel_flag: Arc<AtomicBool>,
    pub download_pause_flag: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadJobRequest {
    pub source_url: String,
    pub root_folder_name: String,
    pub destination_path: String,
    pub concurrency: u32,
    pub skip_existing: bool,
    pub files: Vec<DownloadItem>,
}

#[tauri::command]
async fn scan_link(
    url: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
    state.scan_cancel_flag.store(false, Ordering::Relaxed);
    let scanner = PublicDriveScanner::new(state.scan_cancel_flag.clone());

    let app_handle = app.clone();
    let result = scanner
        .scan(&url, move |prog: ScanProgress| {
            let _ = app_handle.emit("scan:progress", prog);
        })
        .await?;

    Ok(result)
}

#[tauri::command]
async fn cancel_scan(state: State<'_, AppState>) -> Result<(), String> {
    state.scan_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn start_download_job(
    request: DownloadJobRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let dev_id = LicensingManager::get_device_id();
    let saved_key = state.storage.get_setting("license_key").unwrap_or(None);
    let is_pro = state.storage.get_setting("is_pro").unwrap_or(None).as_deref() == Some("true");

    let is_key_valid = is_pro && saved_key.as_ref().map(|k| LicensingManager::verify_key(k)).unwrap_or(false);
    let days_remaining = state
        .storage
        .get_setting("days_remaining")
        .unwrap_or(None)
        .and_then(|v| v.parse::<i64>().ok());
    let is_expired = days_remaining.map(|d| d <= 0).unwrap_or(false);

    if is_key_valid && !is_expired {
        // Active Pro user: Validate against remote Google Sheets kill-switch before streaming!
        if let Some(key) = saved_key.as_ref() {
            match LicensingManager::check_online(key, &dev_id).await {
                Ok(act_res) => {
                    // Update cache from ledger
                    let _ = state.storage.set_setting("plan_name", &act_res.plan_name);
                    let _ = state.storage.set_setting("max_devices", &act_res.max_devices.to_string());
                    let _ = state.storage.set_setting("devices_used", &act_res.current_devices.to_string());
                    if let Some(exp) = &act_res.expiry_date {
                        let _ = state.storage.set_setting("expiry_date", exp);
                    }
                    if let Some(days) = act_res.days_remaining {
                        let _ = state.storage.set_setting("days_remaining", &days.to_string());
                        if days <= 0 {
                            let _ = state.storage.set_setting("is_pro", "false");
                            return Err(format!("License Expired: Your {} subscription has ended. Upgrade to continue.", act_res.plan_name));
                        }
                    }

                    // Report live activity to Google Sheets ledger
                    let key_c = key.clone();
                    let dev_c = dev_id.clone();
                    let total_bytes = state.storage.get_total_bytes_downloaded().unwrap_or(0);
                    let act = format!("Downloading: {} ({} files)", request.root_folder_name, request.files.len());
                    tokio::spawn(async move {
                        let _ = LicensingManager::report_activity(&key_c, &dev_c, &act, total_bytes).await;
                    });
                }
                Err(err_msg) => {
                    // License revoked, expired, or deleted by developer! Demote to Free and block!
                    let _ = state.storage.set_setting("is_pro", "false");
                    return Err(format!("License Notice: {}. Download blocked.", err_msg));
                }
            }
        }
    } else {
        // Free user: Enforce 10 GB daily quota
        let total_job_bytes: u64 = request.files.iter().map(|f| f.expected_size.unwrap_or(0)).sum();
        let bytes_today = state.storage.get_bytes_downloaded_today().unwrap_or(0);
        let free_limit = 10 * 1024 * 1024 * 1024; // 10 GB

        if bytes_today + total_job_bytes > free_limit {
            let used_gb = bytes_today as f64 / (1024.0 * 1024.0 * 1024.0);
            let needed_gb = total_job_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
            return Err(format!(
                "Daily Free Quota Exceeded: You have used {:.2} GB / 10 GB today. This download requires {:.2} GB. Please upgrade to Pro for unlimited downloads.",
                used_gb, needed_gb
            ));
        }
    }

    state.download_cancel_flag.store(false, Ordering::Relaxed);
    state.download_pause_flag.store(false, Ordering::Relaxed);

    let job_id = format!("job_{}", chrono::Utc::now().timestamp_millis());
    let dest_path = PathBuf::from(&request.destination_path);

    let db_job = DbJob {
        id: job_id.clone(),
        source_url: request.source_url,
        root_folder_name: request.root_folder_name,
        destination_path: request.destination_path.clone(),
        concurrency: request.concurrency,
        skip_existing: request.skip_existing,
        status: "RUNNING".to_string(),
        total_files: request.files.len(),
        completed_files: 0,
        failed_files: 0,
        skipped_files: 0,
        total_bytes: 0,
        downloaded_bytes: 0,
        created_at: String::new(),
        updated_at: String::new(),
        completed_at: None,
    };

    state.storage.insert_job(&db_job).map_err(|e| e.to_string())?;

    let db_files: Vec<DbJobFile> = request
        .files
        .iter()
        .map(|f| DbJobFile {
            id: f.id.clone(),
            job_id: job_id.clone(),
            name: f.name.clone(),
            relative_path: f.relative_path.clone(),
            expected_size: f.expected_size.unwrap_or(0),
            downloaded_bytes: 0,
            md5_checksum: f.md5_checksum.clone(),
            mime_type: "application/octet-stream".to_string(),
            status: "QUEUED".to_string(),
            verification_status: "UNVERIFIED".to_string(),
            format_name: None,
            error_message: None,
            retry_count: 0,
        })
        .collect();

    state.storage.insert_job_files(&db_files).map_err(|e| e.to_string())?;

    let scheduler = DownloadScheduler::new(state.storage.clone());
    let cancel_flag = state.download_cancel_flag.clone();
    let pause_flag = state.download_pause_flag.clone();
    let j_id = job_id.clone();
    let app_h = app.clone();
    let app_h2 = app.clone();

    tokio::spawn(async move {
        scheduler
            .run_job(
                j_id,
                dest_path,
                request.concurrency as usize,
                request.skip_existing,
                request.files,
                cancel_flag,
                pause_flag,
                move |prog| {
                    let _ = app_h.emit("job:progress", prog);
                },
                move |file_evt| {
                    let _ = app_h2.emit("file:event", file_evt);
                },
            )
            .await;
    });

    Ok(job_id)
}

#[tauri::command]
async fn pause_download_job(state: State<'_, AppState>) -> Result<(), String> {
    state.download_pause_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn resume_download_job(state: State<'_, AppState>) -> Result<(), String> {
    state.download_pause_flag.store(false, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn stop_download_job(state: State<'_, AppState>) -> Result<(), String> {
    state.download_cancel_flag.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
async fn get_jobs_history(state: State<'_, AppState>) -> Result<Vec<DbJob>, String> {
    state.storage.get_all_jobs().map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_job_files(job_id: String, state: State<'_, AppState>) -> Result<Vec<DbJobFile>, String> {
    state.storage.get_job_files(&job_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_folder_in_os(path: String) -> Result<(), String> {
    open::that(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn select_destination_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select Destination Folder\")")
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            } else {
                return Ok(None);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = "Select Destination Folder"
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $f.SelectedPath
}
"#;
        let output = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(script)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(Some(path));
                }
            } else {
                return Ok(None);
            }
        }
    }

    let default_dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.to_string_lossy().to_string());
    Ok(default_dir)
}

#[derive(serde::Deserialize, Debug)]
pub struct AppSettingsPayload {
    pub concurrency: Option<u32>,
    pub theme: Option<String>,
    #[serde(rename = "skipExisting")]
    pub skip_existing: Option<bool>,
    #[serde(rename = "defaultDestination")]
    pub default_destination: Option<String>,
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let concurrency = state
        .storage
        .get_setting("concurrency")
        .unwrap_or(None)
        .unwrap_or_else(|| "16".to_string());

    let theme = state
        .storage
        .get_setting("theme")
        .unwrap_or(None)
        .unwrap_or_else(|| "light".to_string());

    let skip_existing = state
        .storage
        .get_setting("skip_existing")
        .unwrap_or(None)
        .unwrap_or_else(|| "true".to_string());

    let default_dest = state
        .storage
        .get_setting("destination")
        .unwrap_or(None)
        .unwrap_or_else(|| {
            dirs::download_dir()
                .or_else(dirs::home_dir)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| ".".to_string())
        });

    Ok(serde_json::json!({
        "concurrency": concurrency.parse::<u32>().unwrap_or(16),
        "theme": theme,
        "skipExisting": skip_existing == "true",
        "defaultDestination": default_dest
    }))
}

#[tauri::command]
async fn save_settings(settings: AppSettingsPayload, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(c) = settings.concurrency {
        let _ = state.storage.set_setting("concurrency", &c.to_string());
    }
    if let Some(t) = settings.theme {
        let _ = state.storage.set_setting("theme", &t);
    }
    if let Some(s) = settings.skip_existing {
        let _ = state.storage.set_setting("skip_existing", if s { "true" } else { "false" });
    }
    if let Some(d) = settings.default_destination {
        let _ = state.storage.set_setting("destination", &d);
    }
    Ok(())
}

#[tauri::command]
async fn save_setting(key: String, value: String, state: State<'_, AppState>) -> Result<(), String> {
    state.storage.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn verify_license(key: String, state: State<'_, AppState>) -> Result<LicenseState, String> {
    let clean_key = key.trim().to_uppercase().replace("-", "").replace(" ", "");
    let is_valid = LicensingManager::verify_key(&clean_key);
    let dev_id = LicensingManager::get_device_id();

    if !is_valid {
        return Err("Invalid License Key format. Please check your activation key.".to_string());
    }

    // Register activation online in the central Google Sheets ledger
    let act_res = match LicensingManager::activate_online(&clean_key, &dev_id).await {
        Ok(res) => {
            println!("[DriveMate License] Online activation response: {}", res.message);
            res
        }
        Err(err) => {
            // Block activation if the central anti-piracy ledger rejects it (e.g., DEVICE_LIMIT_EXCEEDED or LICENSE_EXPIRED)
            return Err(err);
        }
    };

    let _ = state.storage.set_setting("license_key", &clean_key);
    let _ = state.storage.set_setting("is_pro", "true");
    let _ = state.storage.set_setting("plan_name", &act_res.plan_name);
    let _ = state.storage.set_setting("max_devices", &act_res.max_devices.to_string());
    let _ = state.storage.set_setting("devices_used", &act_res.current_devices.to_string());
    if let Some(exp) = &act_res.expiry_date {
        let _ = state.storage.set_setting("expiry_date", exp);
    }
    if let Some(days) = act_res.days_remaining {
        let _ = state.storage.set_setting("days_remaining", &days.to_string());
    }

    Ok(LicenseState {
        is_pro: true,
        license_key: Some(clean_key),
        plan_name: act_res.plan_name,
        device_id: dev_id,
        max_devices: act_res.max_devices,
        devices_used: act_res.current_devices,
        expiry_date: act_res.expiry_date,
        days_remaining: act_res.days_remaining,
        daily_quota_bytes: u64::MAX,
        bytes_downloaded_today: 0,
    })
}

#[tauri::command]
async fn deactivate_license(state: State<'_, AppState>) -> Result<LicenseState, String> {
    let saved_key = state.storage.get_setting("license_key").unwrap_or(None);
    let dev_id = LicensingManager::get_device_id();

    if let Some(key) = saved_key.filter(|k| !k.is_empty()) {
        let dev_id_clone = dev_id.clone();
        tokio::spawn(async move {
            let _ = LicensingManager::deactivate_online(&key, &dev_id_clone).await;
        });
    }

    let _ = state.storage.set_setting("license_key", "");
    let _ = state.storage.set_setting("is_pro", "false");
    let _ = state.storage.set_setting("plan_name", "Free Edition");
    let _ = state.storage.set_setting("max_devices", "1");
    let _ = state.storage.set_setting("devices_used", "0");
    let _ = state.storage.set_setting("expiry_date", "");
    let _ = state.storage.set_setting("days_remaining", "0");

    Ok(LicenseState {
        is_pro: false,
        license_key: None,
        plan_name: "DriveMate Free Edition".to_string(),
        device_id: dev_id,
        max_devices: 1,
        devices_used: 0,
        expiry_date: None,
        days_remaining: None,
        daily_quota_bytes: 10 * 1024 * 1024 * 1024,
        bytes_downloaded_today: 0,
    })
}

#[tauri::command]
async fn get_license_state(state: State<'_, AppState>) -> Result<LicenseState, String> {
    let dev_id = LicensingManager::get_device_id();
    let saved_key = state.storage.get_setting("license_key").unwrap_or(None);
    let is_pro = state.storage.get_setting("is_pro").unwrap_or(None).as_deref() == Some("true");

    let plan_name = state
        .storage
        .get_setting("plan_name")
        .unwrap_or(None)
        .unwrap_or_else(|| "DriveMate Free Edition".to_string());

    let max_devices = state
        .storage
        .get_setting("max_devices")
        .unwrap_or(None)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1);

    let devices_used = state
        .storage
        .get_setting("devices_used")
        .unwrap_or(None)
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1);

    let expiry_date = state.storage.get_setting("expiry_date").unwrap_or(None).filter(|s| !s.is_empty());
    let days_remaining = state
        .storage
        .get_setting("days_remaining")
        .unwrap_or(None)
        .and_then(|v| v.parse::<i64>().ok());

    let is_expired = days_remaining.map(|d| d <= 0).unwrap_or(false);

    if is_pro && !is_expired && saved_key.as_ref().map(|k| LicensingManager::verify_key(k)).unwrap_or(false) {
        if let Some(key_clone) = saved_key.clone() {
            let dev_id_clone = dev_id.clone();
            let storage_clone = state.storage.clone();
            tokio::spawn(async move {
                match LicensingManager::check_online(&key_clone, &dev_id_clone).await {
                    Ok(act_res) => {
                        let _ = storage_clone.set_setting("plan_name", &act_res.plan_name);
                        let _ = storage_clone.set_setting("max_devices", &act_res.max_devices.to_string());
                        let _ = storage_clone.set_setting("devices_used", &act_res.current_devices.to_string());
                        if let Some(exp) = &act_res.expiry_date {
                            let _ = storage_clone.set_setting("expiry_date", exp);
                        }
                        if let Some(days) = act_res.days_remaining {
                            let _ = storage_clone.set_setting("days_remaining", &days.to_string());
                            if days <= 0 {
                                let _ = storage_clone.set_setting("is_pro", "false");
                            }
                        }
                    }
                    Err(err_msg) => {
                        eprintln!("[DriveMate Anti-Piracy] Remote verification rejected: {}", err_msg);
                        let _ = storage_clone.set_setting("is_pro", "false");
                    }
                }
            });
        }

        let bytes_today = state.storage.get_bytes_downloaded_today().unwrap_or(0);

        Ok(LicenseState {
            is_pro: true,
            license_key: saved_key,
            plan_name,
            device_id: dev_id,
            max_devices,
            devices_used,
            expiry_date,
            days_remaining,
            daily_quota_bytes: u64::MAX,
            bytes_downloaded_today: bytes_today,
        })
    } else {
        let bytes_today = state.storage.get_bytes_downloaded_today().unwrap_or(0);
        let display_plan = if is_expired {
            "License Expired (Free Edition)".to_string()
        } else {
            "DriveMate Free Edition".to_string()
        };

        Ok(LicenseState {
            is_pro: false,
            license_key: None,
            plan_name: display_plan,
            device_id: dev_id,
            max_devices: 1,
            devices_used: 0,
            expiry_date,
            days_remaining: if is_expired { Some(0) } else { None },
            daily_quota_bytes: 10 * 1024 * 1024 * 1024, // 10 GB Free limit
            bytes_downloaded_today: bytes_today,
        })
    }
}

#[tauri::command]
async fn run_diagnostics() -> Result<DiagnosticsReport, String> {
    let temp_dir = std::env::temp_dir();
    Ok(DiagnosticsManager::run_report(&temp_dir).await)
}

pub fn run() {
    let candidates: Vec<PathBuf> = vec![
        dirs::data_local_dir().map(|p| p.join("DriveMate")),
        dirs::home_dir().map(|p| p.join(".drivemate")),
        Some(std::env::temp_dir().join("DriveMate")),
    ]
    .into_iter()
    .flatten()
    .collect();

    let mut storage_opt = None;
    for candidate in candidates {
        if let Err(e) = std::fs::create_dir_all(&candidate) {
            eprintln!("[DriveMate Warning] Cannot create directory {:?}: {}", candidate, e);
            continue;
        }
        let db_path = candidate.join("drivemate_v2.sqlite");
        match Storage::new(&db_path) {
            Ok(s) => {
                eprintln!("[DriveMate Info] Storage initialized at {:?}", db_path);
                storage_opt = Some(s);
                break;
            }
            Err(e) => {
                eprintln!("[DriveMate Warning] Storage initialization failed at {:?}: {}", db_path, e);
            }
        }
    }

    let storage = match storage_opt {
        Some(s) => s,
        None => {
            eprintln!("[DriveMate Warning] All disk storage candidates failed. Activating in-memory storage fallback.");
            match Storage::in_memory() {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("[DriveMate Fatal] Unable to initialize in-memory SQLite storage: {}", e);
                    return;
                }
            }
        }
    };

    let state = AppState {
        storage,
        scan_cancel_flag: Arc::new(AtomicBool::new(false)),
        download_cancel_flag: Arc::new(AtomicBool::new(false)),
        download_pause_flag: Arc::new(AtomicBool::new(false)),
    };

    if let Err(err) = tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            scan_link,
            cancel_scan,
            start_download_job,
            pause_download_job,
            resume_download_job,
            stop_download_job,
            get_jobs_history,
            get_job_files,
            open_folder_in_os,
            select_destination_folder,
            get_settings,
            save_setting,
            save_settings,
            verify_license,
            deactivate_license,
            get_license_state,
            run_diagnostics
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("[DriveMate Fatal] Application terminated: {}", err);
    }
}
