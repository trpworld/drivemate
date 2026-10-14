import { LicenseState, DailyQuotaState } from '../types/drive';

export const DAILY_FREE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
export const MASTER_SALT = 'DriveMate-Pro-2026-SuperSecretMasterSalt-9941';
export const DEFAULT_ACTIVATION_SERVER_URL = 'https://script.google.com/macros/s/AKfycbx9x8tWbV-HOjcGE5CMB84tUeD1vuddgtk_rr0LPCned-SKbg1kuuluoGFuwPX_iyAV/exec';

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function sha256Hex(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class LicenseService {
  private static instance: LicenseService;
  private cachedLicense: LicenseState | null = null;

  public static getInstance(): LicenseService {
    if (!LicenseService.instance) {
      LicenseService.instance = new LicenseService();
    }
    return LicenseService.instance;
  }

  /**
   * Retrieves or generates a persistent unique Device ID for hardware binding.
   */
  public async getDeviceId(): Promise<string> {
    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_device_id'], (res) => {
        let id = res.drivemate_device_id as string | undefined;
        if (!id) {
          const rand = Math.random().toString(36).substring(2, 10).toUpperCase();
          const time = Date.now().toString(36).toUpperCase();
          id = `DM-DEV-${rand}-${time}`;
          chrome.storage.local.set({ drivemate_device_id: id });
        }
        resolve(id);
      });
    });
  }

  /**
   * Retrieves the configured central Google Apps Script Web App URL for device management.
   */
  public async getActivationServerUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_activation_url'], (res) => {
        resolve((res.drivemate_activation_url as string) || DEFAULT_ACTIVATION_SERVER_URL);
      });
    });
  }

  public async setActivationServerUrl(url: string): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.set({ drivemate_activation_url: url.trim() }, () => resolve());
    });
  }

  /**
   * Checks central Google Sheets ledger to confirm if this license key is still active.
   * If row was deleted or status marked REVOKED/EXPIRED, returns false to demote client.
   */
  public async validateOnlineWithLedger(key: string, deviceId: string): Promise<{ valid: boolean; details?: any }> {
    const serverUrl = await this.getActivationServerUrl();
    if (!serverUrl || !key) return { valid: true };

    try {
      const resp = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'CHECK',
          licenseKey: key,
          deviceId: deviceId,
          version: 'v0.3.0'
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data && data.success === false) {
          console.warn('[DriveMate Anti-Piracy] Central ledger rejected license:', data.message);
          return { valid: false };
        }
        if (data && data.success) {
          return { valid: true, details: data };
        }
      }
      return { valid: true };
    } catch {
      // Offline fallback: keep Pro if network is unreachable
      return { valid: true };
    }
  }

  /**
   * Retrieves the current license state from persistent local storage.
   * Validates device binding and verifies against Google Sheets central ledger.
   */
  public async getLicenseState(): Promise<LicenseState> {
    const currentDeviceId = await this.getDeviceId();

    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_license'], async (res) => {
        const stored = res.drivemate_license as LicenseState | undefined;
        if (stored && stored.isPro) {
          // Check local expiry
          if (stored.daysRemaining != null && stored.daysRemaining <= 0) {
            console.warn('License expired. Demoting to Free tier.');
            const expiredState: LicenseState = { isPro: false, planName: 'License Expired' };
            this.cachedLicense = expiredState;
            chrome.storage.local.remove(['drivemate_license']);
            resolve(expiredState);
            return;
          }

          // If stored license is bound to a different device, reject clone!
          if (stored.deviceId && stored.deviceId !== currentDeviceId) {
            console.warn('License device ID mismatch detected. Demoting to Free tier.');
            const defaultState: LicenseState = { isPro: false };
            this.cachedLicense = defaultState;
            chrome.storage.local.remove(['drivemate_license']);
            resolve(defaultState);
            return;
          }

          // Live validation with central Google Sheets ledger:
          if (stored.licenseKey) {
            const check = await this.validateOnlineWithLedger(stored.licenseKey, currentDeviceId);
            if (!check.valid) {
              console.warn('License revoked or expired in Google Sheets ledger. Demoting to Free tier.');
              const revokedState: LicenseState = { isPro: false, planName: 'License Revoked or Expired' };
              this.cachedLicense = revokedState;
              chrome.storage.local.remove(['drivemate_license']);
              resolve(revokedState);
              return;
            }
            if (check.details) {
              stored.planName = check.details.planName || stored.planName;
              stored.maxDevices = check.details.maxDevices || stored.maxDevices;
              stored.currentDevices = check.details.currentDevices || stored.currentDevices;
              stored.expiryDate = check.details.expiryDate || stored.expiryDate;
              stored.daysRemaining = check.details.daysRemaining != null ? check.details.daysRemaining : stored.daysRemaining;
              chrome.storage.local.set({ drivemate_license: stored });
            }
          }

          this.cachedLicense = stored;
          resolve(stored);
        } else {
          const defaultState: LicenseState = { isPro: false };
          this.cachedLicense = defaultState;
          resolve(defaultState);
        }
      });
    });
  }

  /**
   * Retrieves the daily quota status (used bytes, remaining bytes, isPro).
   */
  public async getDailyQuota(): Promise<{
    usedBytes: number;
    limitBytes: number;
    remainingBytes: number;
    isPro: boolean;
    date: string;
  }> {
    const license = await this.getLicenseState();
    const today = getTodayString();

    if (license.isPro) {
      return {
        usedBytes: 0,
        limitBytes: Infinity,
        remainingBytes: Infinity,
        isPro: true,
        date: today
      };
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_daily_quota'], (res) => {
        let quota = res.drivemate_daily_quota as DailyQuotaState | undefined;
        if (!quota || quota.date !== today) {
          // Reset quota for new day
          quota = {
            date: today,
            bytesDownloadedToday: 0
          };
          chrome.storage.local.set({ drivemate_daily_quota: quota });
        }

        const used = quota.bytesDownloadedToday || 0;
        const remaining = Math.max(0, DAILY_FREE_LIMIT_BYTES - used);

        resolve({
          usedBytes: used,
          limitBytes: DAILY_FREE_LIMIT_BYTES,
          remainingBytes: remaining,
          isPro: false,
          date: today
        });
      });
    });
  }

  /**
   * Adds newly downloaded bytes to today's daily tally.
   */
  public async recordDownloadedBytes(bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const license = await this.getLicenseState();
    if (license.isPro) return; // Pro users don't need quota recording

    const today = getTodayString();
    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_daily_quota'], (res) => {
        let quota = res.drivemate_daily_quota as DailyQuotaState | undefined;
        if (!quota || quota.date !== today) {
          quota = {
            date: today,
            bytesDownloadedToday: 0
          };
        }

        quota.bytesDownloadedToday += bytes;
        chrome.storage.local.set({ drivemate_daily_quota: quota }, () => {
          resolve();
        });
      });
    });
  }

  /**
   * Evaluates if a folder of the given byte size can be downloaded today.
   */
  public async canDownloadBatch(neededBytes: number): Promise<{
    allowed: boolean;
    reason?: 'QUOTA_EXCEEDED' | 'OK';
    usedBytes: number;
    remainingBytes: number;
    neededBytes: number;
  }> {
    const quota = await this.getDailyQuota();
    if (quota.isPro) {
      return {
        allowed: true,
        reason: 'OK',
        usedBytes: 0,
        remainingBytes: Infinity,
        neededBytes
      };
    }

    if (quota.usedBytes >= DAILY_FREE_LIMIT_BYTES || (quota.usedBytes + neededBytes > DAILY_FREE_LIMIT_BYTES)) {
      return {
        allowed: false,
        reason: 'QUOTA_EXCEEDED',
        usedBytes: quota.usedBytes,
        remainingBytes: quota.remainingBytes,
        neededBytes
      };
    }

    return {
      allowed: true,
      reason: 'OK',
      usedBytes: quota.usedBytes,
      remainingBytes: quota.remainingBytes,
      neededBytes
    };
  }

  /**
   * Validates a license key using zero-server cryptographic signature verification.
   * Format: DM-PRO-XXXX-XXXX-YYYY-YYYY
   * (XXXX-XXXX = 8 char payload, YYYY-YYYY = 8 char signature)
   */
  public async verifyKey(key: string): Promise<boolean> {
    const raw = key.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Check VIP developer bypass keys
    if (raw === 'DMPROLIFETIMEVIP' || raw === 'DRIVEMATEPRO2026') {
      return true;
    }

    // Standard format: Starts with DM6M / DM1Y (4 chars) or DMPRO (5 chars)
    let token = raw;
    if (token.startsWith('DM6M') || token.startsWith('DM1Y')) {
      token = token.slice(4);
    } else if (token.startsWith('DMPRO')) {
      token = token.slice(5);
    }

    if (token.length !== 16) {
      return false;
    }

    const payload = token.slice(0, 8);
    const signature = token.slice(8, 16);

    const expectedHash = await sha256Hex(payload + MASTER_SALT);
    const expectedSig = expectedHash.slice(0, 8).toUpperCase();

    return signature === expectedSig;
  }

  public detectPlanOffline(key: string): { planName: string; maxDevices: number; daysRemaining: number } {
    const raw = key.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw === 'DMPROLIFETIMEVIP' || raw === 'DRIVEMATEPRO2026') {
      return { planName: 'VIP Lifetime Pro (10 Devices)', maxDevices: 10, daysRemaining: 3650 };
    }
    if (raw.startsWith('DM1Y')) {
      return { planName: '1-Year Team Pro (5 Devices)', maxDevices: 5, daysRemaining: 365 };
    }
    if (raw.startsWith('DM6M')) {
      return { planName: '6-Month Pro (1 Device)', maxDevices: 1, daysRemaining: 180 };
    }
    return { planName: '6-Month Pro (1 Device)', maxDevices: 1, daysRemaining: 180 };
  }

  /**
   * Activates the Pro License with Device Binding, Tier Selection, and Anti-Piracy Protection.
   */
  public async activateLicense(key: string): Promise<{ success: boolean; error?: string }> {
    const cleanKey = key.trim();
    if (!cleanKey) {
      return { success: false, error: 'Please enter a valid license key.' };
    }

    const isValid = await this.verifyKey(cleanKey);
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid license key format. Please check your key or buy a subscription.'
      };
    }

    const deviceId = await this.getDeviceId();
    const offlinePlan = this.detectPlanOffline(cleanKey);

    let planName = offlinePlan.planName;
    let maxDevices = offlinePlan.maxDevices;
    let currentDevices = 1;
    let expiryDate: string | null = null;
    let daysRemaining: number | null = offlinePlan.daysRemaining;

    // Check Online Anti-Piracy / Device Limit Ledger (if configured)
    const serverUrl = await this.getActivationServerUrl();
    if (serverUrl) {
      try {
        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'ACTIVATE',
            licenseKey: cleanKey,
            deviceId: deviceId,
            version: 'v0.3.0'
          })
        });

        if (response.ok) {
          const resData = await response.json();
          if (resData && resData.success === false) {
            return {
              success: false,
              error: resData.message || '⚠️ Device limit exceeded: This license is already in use on another computer.'
            };
          }
          if (resData && resData.success) {
            planName = resData.planName || planName;
            maxDevices = resData.maxDevices || maxDevices;
            currentDevices = resData.currentDevices || currentDevices;
            expiryDate = resData.expiryDate || null;
            daysRemaining = resData.daysRemaining != null ? resData.daysRemaining : daysRemaining;
          }
        }
      } catch (networkErr) {
        console.warn('Central license verification unreachable, fallback to local hardware binding:', networkErr);
      }
    }

    const proState: LicenseState = {
      isPro: true,
      licenseKey: cleanKey,
      activatedAt: new Date().toISOString(),
      planName: planName,
      deviceId: deviceId,
      maxDevices: maxDevices,
      currentDevices: currentDevices,
      expiryDate: expiryDate,
      daysRemaining: daysRemaining
    };

    return new Promise((resolve) => {
      chrome.storage.local.set({ drivemate_license: proState }, () => {
        this.cachedLicense = proState;
        resolve({ success: true });
      });
    });
  }

  /**
   * Deactivates license (useful for testing or resetting).
   */
  public async deactivateLicense(): Promise<void> {
    const freeState: LicenseState = { isPro: false };
    this.cachedLicense = freeState;
    return new Promise((resolve) => {
      chrome.storage.local.remove(['drivemate_license'], () => {
        resolve();
      });
    });
  }
}
