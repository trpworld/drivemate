import type { AppUpdateInfo } from '../types';

export class DesktopUpdaterService {
  private static instance: DesktopUpdaterService;
  private currentVersion = '1.0.0';

  public static getInstance(): DesktopUpdaterService {
    if (!DesktopUpdaterService.instance) {
      DesktopUpdaterService.instance = new DesktopUpdaterService();
    }
    return DesktopUpdaterService.instance;
  }

  public getCurrentVersion(): string {
    return this.currentVersion;
  }

  public async checkForUpdates(forceRefresh = false): Promise<AppUpdateInfo> {
    const currentVer = this.currentVersion;
    const dismissedVer = forceRefresh ? null : this.getDismissedVersion();

    const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
    const defaultDownloadUrl = isMac
      ? 'https://drivemate-pro.pages.dev/assets/DriveMate-Mac.zip'
      : 'https://drivemate-pro.pages.dev/assets/DriveMate-Windows.zip';

    const defaultResult: AppUpdateInfo = {
      updateAvailable: false,
      currentVersion: currentVer,
      latestVersion: currentVer,
      updateUrl: defaultDownloadUrl,
      isDismissed: false,
    };

    const sources = [
      'https://drivemate-pro.pages.dev/version.json',
      'https://raw.githubusercontent.com/gobindabiswas/drivemate/main/landing-page/version.json',
    ];

    for (const url of sources) {
      try {
        const resp = await fetch(url, { cache: forceRefresh ? 'no-cache' : 'default' });
        if (resp.ok) {
          const data = await resp.json();
          if (data) {
            // Check desktop-specific version or general latestVersion
            const remoteVersion = String(data.desktopVersion || data.latestVersion || currentVer).trim();
            const isNewer = this.compareSemver(remoteVersion, currentVer) > 0;
            const isDismissed = dismissedVer === remoteVersion;

            const targetUrl = isMac
              ? (data.desktopMacUrl || data.downloadPage || defaultDownloadUrl)
              : (data.desktopWindowsUrl || data.downloadPage || defaultDownloadUrl);

            return {
              updateAvailable: isNewer,
              currentVersion: currentVer,
              latestVersion: remoteVersion,
              releaseDate: data.releaseDate,
              releaseNotes: data.releaseNotes || 'New high-speed download optimizations & stability improvements.',
              updateUrl: targetUrl,
              isDismissed,
            };
          }
        }
      } catch {
        // Fallback to next source
      }
    }

    return defaultResult;
  }

  public dismissUpdate(version: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('drivemate_dismissed_desktop_version', version);
      }
    } catch {}
  }

  public getDismissedVersion(): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem('drivemate_dismissed_desktop_version');
      }
    } catch {}
    return null;
  }

  public compareSemver(v1: string, v2: string): number {
    const p1 = v1.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const p2 = v2.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }
}
