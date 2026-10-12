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
   * Retrieves the current license state from persistent local storage.
   * Validates device binding to prevent copying storage files across machines.
   */
  public async getLicenseState(): Promise<LicenseState> {
    if (this.cachedLicense) {
      return this.cachedLicense;
    }

    const currentDeviceId = await this.getDeviceId();

    return new Promise((resolve) => {
      chrome.storage.local.get(['drivemate_license'], (res) => {
        const stored = res.drivemate_license as LicenseState | undefined;
        if (stored && stored.isPro) {
          // If stored license is bound to a different device, reject clone!
          if (stored.deviceId && stored.deviceId !== currentDeviceId) {
            console.warn('License device ID mismatch detected. Demoting to Free tier.');
            const defaultState: LicenseState = { isPro: false };
            this.cachedLicense = defaultState;
            chrome.storage.local.remove(['drivemate_license']);
            resolve(defaultState);
            return;
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

    // Standard format: Starts with DMPRO (5 chars) followed by 16 hex chars = 21 chars total
    // Or exactly 16 hex chars
    let token = raw;
    if (token.startsWith('DMPRO')) {
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

  /**
   * Activates the Pro Lifetime License with Device Binding and Anti-Piracy Protection.
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
        error: 'Invalid license key. Please check your key or buy a lifetime license.'
      };
    }

    const deviceId = await this.getDeviceId();

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
        }
      } catch (networkErr) {
        console.warn('Central license verification unreachable, fallback to local hardware binding:', networkErr);
      }
    }

    const proState: LicenseState = {
      isPro: true,
      licenseKey: cleanKey,
      activatedAt: new Date().toISOString(),
      planName: 'Lifetime Pro',
      deviceId: deviceId
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
