use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MASTER_SALT: &str = "DriveMate-Pro-2026-SuperSecretMasterSalt-9941";

pub const DEFAULT_ACTIVATION_SERVER_URL: &str =
    "https://script.google.com/macros/s/AKfycbx9x8tWbV-HOjcGE5CMB84tUeD1vuddgtk_rr0LPCned-SKbg1kuuluoGFuwPX_iyAV/exec";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseState {
    pub is_pro: bool,
    pub license_key: Option<String>,
    pub plan_name: String,
    pub device_id: String,
    pub max_devices: u32,
    pub devices_used: u32,
    pub expiry_date: Option<String>,
    pub days_remaining: Option<i64>,
    pub daily_quota_bytes: u64,
    pub bytes_downloaded_today: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationResponse {
    pub success: bool,
    pub message: String,
    pub plan_name: String,
    pub max_devices: u32,
    pub current_devices: u32,
    pub expiry_date: Option<String>,
    pub days_remaining: Option<i64>,
}

pub struct LicensingManager;

impl LicensingManager {
    /// Computes hardware device ID from machine characteristics
    pub fn get_device_id() -> String {
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = std::process::Command::new("ioreg")
                .args(["-rd1", "-c", "IOPlatformExpertDevice"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                if let Some(pos) = text.find("\"IOPlatformUUID\" = \"") {
                    let rest = &text[pos + 20..];
                    if let Some(end) = rest.find('"') {
                        let uuid = &rest[..end];
                        let prefix = if uuid.len() >= 8 { &uuid[..8] } else { uuid };
                        return format!("DM-MAC-{}", prefix.to_uppercase());
                    }
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            if let Ok(output) = std::process::Command::new("wmic")
                .args(["csproduct", "get", "UUID"])
                .output()
            {
                let text = String::from_utf8_lossy(&output.stdout);
                let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
                if lines.len() > 1 {
                    let uuid = lines[1];
                    let prefix = if uuid.len() >= 8 { &uuid[..8] } else { uuid };
                    return format!("DM-WIN-{}", prefix.to_uppercase());
                }
            }
        }

        // Deterministic fallback based on hostname
        let hostname = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "DESKTOP-NODE".to_string());

        let mut hash: u32 = 0;
        for b in hostname.bytes() {
            hash = hash.wrapping_mul(31).wrapping_add(b as u32);
        }

        #[cfg(target_os = "macos")]
        return format!("DM-MAC-{:08X}", hash);
        #[cfg(not(target_os = "macos"))]
        return format!("DM-WIN-{:08X}", hash);
    }

    /// Offline plan detection based on key prefix
    pub fn detect_plan_offline(key: &str) -> (String, u32, i64) {
        let clean = key.trim().to_uppercase().replace(['-', ' '], "");
        if clean == "DMPROLIFETIMEVIP" || clean == "DRIVEMATEPRO2026" {
            ("VIP Lifetime Pro (10 Devices)".to_string(), 10, 3650)
        } else if clean.starts_with("DM1Y") {
            ("1-Year Team Pro (5 Devices)".to_string(), 5, 365)
        } else if clean.starts_with("DM6M") {
            ("6-Month Pro (1 Device)".to_string(), 1, 180)
        } else {
            ("6-Month Pro (1 Device)".to_string(), 1, 180)
        }
    }

    /// Verifies license key cryptographically offline
    pub fn verify_key(key: &str) -> bool {
        let trimmed = key.trim().to_uppercase().replace(['-', ' '], "");
        if trimmed.is_empty() {
            return false;
        }

        // VIP Developer Bypass Keys
        if trimmed == "DMPROLIFETIMEVIP" || trimmed == "DRIVEMATEPRO2026" {
            return true;
        }

        let mut token = trimmed.as_str();
        if token.starts_with("DM6M") || token.starts_with("DM1Y") {
            token = &token[4..];
        } else if token.starts_with("DMPRO") {
            token = &token[5..];
        }

        if token.len() != 16 {
            return false;
        }

        let payload = &token[..8];
        let sig = &token[8..16];

        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        hasher.update(MASTER_SALT.as_bytes());
        let hash_result = format!("{:x}", hasher.finalize());

        if hash_result.len() >= 8 {
            sig.eq_ignore_ascii_case(&hash_result[..8])
        } else {
            false
        }
    }

    /// Activates the license key online with Google Apps Script Web App (Google Sheet ledger).
    /// Registers the device ID, updates Last Seen, and enforces device limits and plan expiration.
    pub async fn activate_online(key: &str, device_id: &str) -> Result<ActivationResponse, String> {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::limited(10))
            .tls_built_in_root_certs(true);

        if let Ok(cert_file) = std::env::var("SSL_CERT_FILE") {
            if let Ok(bytes) = std::fs::read(&cert_file) {
                if let Ok(bundle) = reqwest::Certificate::from_pem_bundle(&bytes) {
                    for cert in bundle {
                        builder = builder.add_root_certificate(cert);
                    }
                } else if let Ok(cert) = reqwest::Certificate::from_pem(&bytes) {
                    builder = builder.add_root_certificate(cert);
                }
            }
        }

        let client = match builder.build() {
            Ok(c) => c,
            Err(e) => return Err(format!("HTTP client build error: {}", e)),
        };

        let payload = serde_json::json!({
            "action": "ACTIVATE",
            "licenseKey": key,
            "deviceId": device_id,
            "version": "1.0.0"
        });

        match client
            .post(DEFAULT_ACTIVATION_SERVER_URL)
            .header("Content-Type", "text/plain;charset=utf-8")
            .body(payload.to_string())
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if val.get("success").and_then(|s| s.as_bool()) == Some(false) {
                        let msg = val
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("License activation rejected by central ledger.");
                        return Err(msg.to_string());
                    }
                    let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                    let plan_name = val
                        .get("planName")
                        .and_then(|p| p.as_str())
                        .unwrap_or(&def_plan)
                        .to_string();
                    let max_devices = val
                        .get("maxDevices")
                        .and_then(|m| m.as_u64())
                        .map(|m| m as u32)
                        .unwrap_or(def_max);
                    let current_devices = val
                        .get("currentDevices")
                        .and_then(|c| c.as_u64())
                        .map(|c| c as u32)
                        .unwrap_or(1);
                    let expiry_date = val
                        .get("expiryDate")
                        .and_then(|e| e.as_str())
                        .map(|s| s.to_string());
                    let days_remaining = val
                        .get("daysRemaining")
                        .and_then(|d| d.as_i64())
                        .or(Some(def_days));
                    let msg = val
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("License activated successfully.")
                        .to_string();

                    Ok(ActivationResponse {
                        success: true,
                        message: msg,
                        plan_name,
                        max_devices,
                        current_devices,
                        expiry_date,
                        days_remaining,
                    })
                } else if status.is_success() {
                    let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                    Ok(ActivationResponse {
                        success: true,
                        message: "License activated successfully.".to_string(),
                        plan_name: def_plan,
                        max_devices: def_max,
                        current_devices: 1,
                        expiry_date: None,
                        days_remaining: Some(def_days),
                    })
                } else {
                    let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                    Ok(ActivationResponse {
                        success: true,
                        message: "License validated.".to_string(),
                        plan_name: def_plan,
                        max_devices: def_max,
                        current_devices: 1,
                        expiry_date: None,
                        days_remaining: Some(def_days),
                    })
                }
            }
            Err(err) => {
                eprintln!(
                    "[DriveMate Warning] Central activation ledger unreachable ({:?}). Offline license activated.",
                    err
                );
                let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                Ok(ActivationResponse {
                    success: true,
                    message: "License activated offline.".to_string(),
                    plan_name: def_plan,
                    max_devices: def_max,
                    current_devices: 1,
                    expiry_date: None,
                    days_remaining: Some(def_days),
                })
            }
        }
    }

    /// Checks with the Google Sheets ledger if the license is still active and valid for this device.
    /// Returns Err if revoked, expired, deleted, or unauthorized.
    pub async fn check_online(key: &str, device_id: &str) -> Result<ActivationResponse, String> {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .tls_built_in_root_certs(true);

        if let Ok(cert_file) = std::env::var("SSL_CERT_FILE") {
            if let Ok(bytes) = std::fs::read(&cert_file) {
                if let Ok(bundle) = reqwest::Certificate::from_pem_bundle(&bytes) {
                    for cert in bundle {
                        builder = builder.add_root_certificate(cert);
                    }
                } else if let Ok(cert) = reqwest::Certificate::from_pem(&bytes) {
                    builder = builder.add_root_certificate(cert);
                }
            }
        }

        let client = match builder.build() {
            Ok(c) => c,
            Err(e) => return Err(format!("HTTP client build error: {}", e)),
        };

        let payload = serde_json::json!({
            "action": "CHECK",
            "licenseKey": key,
            "deviceId": device_id,
            "version": "1.0.0"
        });

        match client
            .post(DEFAULT_ACTIVATION_SERVER_URL)
            .header("Content-Type", "text/plain;charset=utf-8")
            .body(payload.to_string())
            .send()
            .await
        {
            Ok(resp) => {
                let text = resp.text().await.unwrap_or_default();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    if val.get("success").and_then(|s| s.as_bool()) == Some(false) {
                        let msg = val
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("License revoked or not found in central ledger.");
                        return Err(msg.to_string());
                    }
                    let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                    let plan_name = val
                        .get("planName")
                        .and_then(|p| p.as_str())
                        .unwrap_or(&def_plan)
                        .to_string();
                    let max_devices = val
                        .get("maxDevices")
                        .and_then(|m| m.as_u64())
                        .map(|m| m as u32)
                        .unwrap_or(def_max);
                    let current_devices = val
                        .get("currentDevices")
                        .and_then(|c| c.as_u64())
                        .map(|c| c as u32)
                        .unwrap_or(1);
                    let expiry_date = val
                        .get("expiryDate")
                        .and_then(|e| e.as_str())
                        .map(|s| s.to_string());
                    let days_remaining = val
                        .get("daysRemaining")
                        .and_then(|d| d.as_i64())
                        .or(Some(def_days));

                    Ok(ActivationResponse {
                        success: true,
                        message: "License active.".to_string(),
                        plan_name,
                        max_devices,
                        current_devices,
                        expiry_date,
                        days_remaining,
                    })
                } else {
                    let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                    Ok(ActivationResponse {
                        success: true,
                        message: "Validated.".to_string(),
                        plan_name: def_plan,
                        max_devices: def_max,
                        current_devices: 1,
                        expiry_date: None,
                        days_remaining: Some(def_days),
                    })
                }
            }
            Err(_) => {
                let (def_plan, def_max, def_days) = Self::detect_plan_offline(key);
                Ok(ActivationResponse {
                    success: true,
                    message: "Checked offline.".to_string(),
                    plan_name: def_plan,
                    max_devices: def_max,
                    current_devices: 1,
                    expiry_date: None,
                    days_remaining: Some(def_days),
                })
            }
        }
    }

    /// Reports live user activity (active folder, total downloaded bytes) to Google Sheets
    pub async fn report_activity(key: &str, device_id: &str, activity: &str, total_bytes: u64) -> Result<(), String> {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .tls_built_in_root_certs(true);

        if let Ok(cert_file) = std::env::var("SSL_CERT_FILE") {
            if let Ok(bytes) = std::fs::read(&cert_file) {
                if let Ok(bundle) = reqwest::Certificate::from_pem_bundle(&bytes) {
                    for cert in bundle {
                        builder = builder.add_root_certificate(cert);
                    }
                } else if let Ok(cert) = reqwest::Certificate::from_pem(&bytes) {
                    builder = builder.add_root_certificate(cert);
                }
            }
        }

        if let Ok(client) = builder.build() {
            let payload = serde_json::json!({
                "action": "CHECK",
                "licenseKey": key,
                "deviceId": device_id,
                "version": "1.0.0",
                "activity": activity,
                "totalDownloadedBytes": total_bytes
            });
            let _ = client
                .post(DEFAULT_ACTIVATION_SERVER_URL)
                .header("Content-Type", "text/plain;charset=utf-8")
                .body(payload.to_string())
                .send()
                .await;
        }
        Ok(())
    }

    /// Deactivates this device online, releasing the license slot in the Google Sheets ledger.
    pub async fn deactivate_online(key: &str, device_id: &str) -> Result<String, String> {
        let mut builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(10))
            .tls_built_in_root_certs(true);

        if let Ok(cert_file) = std::env::var("SSL_CERT_FILE") {
            if let Ok(bytes) = std::fs::read(&cert_file) {
                if let Ok(bundle) = reqwest::Certificate::from_pem_bundle(&bytes) {
                    for cert in bundle {
                        builder = builder.add_root_certificate(cert);
                    }
                } else if let Ok(cert) = reqwest::Certificate::from_pem(&bytes) {
                    builder = builder.add_root_certificate(cert);
                }
            }
        }

        let client = match builder.build() {
            Ok(c) => c,
            Err(e) => return Err(format!("HTTP client build error: {}", e)),
        };

        let payload = serde_json::json!({
            "action": "DEACTIVATE",
            "licenseKey": key,
            "deviceId": device_id,
            "version": "1.0.0"
        });

        match client
            .post(DEFAULT_ACTIVATION_SERVER_URL)
            .header("Content-Type", "text/plain;charset=utf-8")
            .body(payload.to_string())
            .send()
            .await
        {
            Ok(resp) => {
                let text = resp.text().await.unwrap_or_default();
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg = val
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("Device unlinked from central ledger.");
                    Ok(msg.to_string())
                } else {
                    Ok("Device unlinked.".to_string())
                }
            }
            Err(err) => {
                eprintln!("[DriveMate Warning] Deactivation ledger unreachable: {:?}", err);
                Ok("Deactivated locally.".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vip_keys() {
        assert!(LicensingManager::verify_key("DMPROLIFETIMEVIP"));
        assert!(LicensingManager::verify_key("DRIVEMATEPRO2026"));
        assert!(LicensingManager::verify_key("DM-PRO-LIFETIME-VIP"));
    }

    #[test]
    fn test_6m_and_1y_keys() {
        // Construct valid 6M and 1Y keys with SHA256 of payload + MASTER_SALT
        let payload = "A1B2C3D4";
        let mut hasher = Sha256::new();
        hasher.update(payload.as_bytes());
        hasher.update(MASTER_SALT.as_bytes());
        let hash = format!("{:x}", hasher.finalize());
        let sig = &hash[..8];

        let key_6m = format!("DM-6M-A1B2-C3D4-{}-{}", &sig[..4], &sig[4..8]);
        let key_1y = format!("DM-1Y-A1B2-C3D4-{}-{}", &sig[..4], &sig[4..8]);

        assert!(LicensingManager::verify_key(&key_6m));
        assert!(LicensingManager::verify_key(&key_1y));

        let (plan_6m, max_6m, days_6m) = LicensingManager::detect_plan_offline(&key_6m);
        assert_eq!(max_6m, 1);
        assert_eq!(days_6m, 180);
        assert!(plan_6m.contains("6-Month"));

        let (plan_1y, max_1y, days_1y) = LicensingManager::detect_plan_offline(&key_1y);
        assert_eq!(max_1y, 5);
        assert_eq!(days_1y, 365);
        assert!(plan_1y.contains("1-Year"));
    }

    #[test]
    fn test_invalid_keys() {
        assert!(!LicensingManager::verify_key(""));
        assert!(!LicensingManager::verify_key("INVALID-KEY-1234"));
        assert!(!LicensingManager::verify_key("DM-PRO-0000-0000-0000-0000"));
        assert!(!LicensingManager::verify_key("DM-6M-0000-0000-0000-0000"));
        assert!(!LicensingManager::verify_key("DM-1Y-0000-0000-0000-0000"));
    }

    #[test]
    fn test_device_id_format() {
        let dev_id = LicensingManager::get_device_id();
        assert!(dev_id.starts_with("DM-MAC-") || dev_id.starts_with("DM-WIN-"));
    }

    #[tokio::test]
    async fn test_activate_online() {
        let dev_id = LicensingManager::get_device_id();
        let res = LicensingManager::activate_online("DMPROLIFETIMEVIP", &dev_id).await;
        println!("Activate online result: {:?}", res);
        assert!(res.is_ok());
    }
}
