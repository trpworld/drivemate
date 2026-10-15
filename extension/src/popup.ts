// DriveMate Popup Controller — Public Link Mode (Unified 1-Step Workflow)
// Zero Google Login • Direct macOS Native Download • Automatic Scan & Start

import { PublicDriveScanner, collectDownloadableFiles } from './services/publicDriveScanner';
import { downloadClient } from './services/downloadClient';
import { LicenseService, DAILY_FREE_LIMIT_BYTES, AppUpdateInfo } from './services/licenseService';
import type {
  ScanResult,
  JobProgressEvent,
  FileCompletedEvent,
  FileFailedEvent,
  JobCompletedEvent,
  DownloadFileItem,
} from './types/drive';

// --- STATE ---
export interface FileItemState {
  name: string;
  bytes: number;
  total: number;
  status: 'DOWNLOADING' | 'VERIFIED' | 'FAILED' | 'QUEUED';
  verified?: boolean;
  error?: string;
}

let currentAbortController: AbortController | null = null;
let lastScanResult: ScanResult | null = null;
let currentJobId: string | null = null;
const activeFilesMap = new Map<string, FileItemState>();

// --- DOM ELEMENTS: NAVIGATION TABS ---
const tabBtnScanner = document.getElementById('tab-btn-scanner') as HTMLButtonElement;
const tabBtnNative = document.getElementById('tab-btn-native') as HTMLButtonElement;
const tabContentScanner = document.getElementById('tab-content-scanner') as HTMLElement;
const tabContentNative = document.getElementById('tab-content-native') as HTMLElement;

// --- DOM ELEMENTS: TARGET & CONFIGURATION ---
const inputFolderId = document.getElementById('input-folder-id') as HTMLInputElement;
const inputDestinationPath = document.getElementById('input-destination-path') as HTMLInputElement;
const selectConcurrency = document.getElementById('select-concurrency') as HTMLSelectElement;
const chkSkipExisting = document.getElementById('chk-skip-existing') as HTMLInputElement | null;
const btnStartDownload = document.getElementById('btn-start-download') as HTMLButtonElement;
const btnSampleLink = document.getElementById('btn-sample-link') as HTMLButtonElement;
const dlWarningBox = document.getElementById('dl-warning-box') as HTMLElement;
const downloadConfigCard = document.getElementById('download-config-card') as HTMLElement;

// --- DOM ELEMENTS: SCANNED FOLDER PREVIEW & MEDIA BREAKDOWN ---
const scanLoadingIndicator = document.getElementById('scan-loading-indicator') as HTMLElement;
const scanLoadingDetail = document.getElementById('scan-loading-detail') as HTMLElement;
const scannedFolderSummary = document.getElementById('scanned-folder-summary') as HTMLElement;
const summaryFolderName = document.getElementById('summary-folder-name') as HTMLElement;
const summaryTotalSubtitle = document.getElementById('summary-total-subtitle') as HTMLElement;
const btnRescanFolder = document.getElementById('btn-rescan-folder') as HTMLButtonElement;
const countVideos = document.getElementById('count-videos') as HTMLElement;
const countPhotos = document.getElementById('count-photos') as HTMLElement;
const countAudio = document.getElementById('count-audio') as HTMLElement;
const countDocs = document.getElementById('count-docs') as HTMLElement;
const btnToggleFilePreview = document.getElementById('btn-toggle-file-preview') as HTMLButtonElement;
const previewToggleIcon = document.getElementById('preview-toggle-icon') as HTMLElement;
const previewToggleText = document.getElementById('preview-toggle-text') as HTMLElement;
const scannedFilesPreviewList = document.getElementById('scanned-files-preview-list') as HTMLElement;

// --- DOM ELEMENTS: DOWNLOAD PROGRESS CARD ---
const downloadProgressCard = document.getElementById('download-progress-card') as HTMLElement;
const dlStatusTitle = document.getElementById('dl-status-title') as HTMLElement;
const dlStatusBadge = document.getElementById('dl-status-badge') as HTMLElement;
const dlProgressBar = document.getElementById('dl-progress-bar') as HTMLElement;
const dlProgressText = document.getElementById('dl-progress-text') as HTMLElement;
const dlSpeedEta = document.getElementById('dl-speed-eta') as HTMLElement;
const dlFilesCount = document.getElementById('dl-files-count') as HTMLElement;
const btnPauseDownload = document.getElementById('btn-pause-download') as HTMLButtonElement;
const btnResumeDownload = document.getElementById('btn-resume-download') as HTMLButtonElement;
const btnStopDownload = document.getElementById('btn-stop-download') as HTMLButtonElement;
const dlFilesList = document.getElementById('dl-files-list') as HTMLElement;

// --- DOM ELEMENTS: SUMMARY REPORT CARD ---
const downloadReportCard = document.getElementById('download-report-card') as HTMLElement;
const dlReportBadge = document.getElementById('dl-report-badge') as HTMLElement;
const reportCompletedFiles = document.getElementById('report-completed-files') as HTMLElement;
const reportFailedFiles = document.getElementById('report-failed-files') as HTMLElement;
const reportTotalBytes = document.getElementById('report-total-bytes') as HTMLElement;
const reportQuotaHint = document.getElementById('report-quota-hint') as HTMLElement;
const btnRetryFailed = document.getElementById('btn-retry-failed') as HTMLButtonElement;
const btnDismissReport = document.getElementById('btn-dismiss-report') as HTMLButtonElement;

// --- DOM ELEMENTS: DIAGNOSTICS & NATIVE BRIDGE (PHASE 1) ---
const btnTestNative = document.getElementById('btn-test-native') as HTMLButtonElement;
const valLatency = document.getElementById('val-latency') as HTMLElement;
const valVersion = document.getElementById('val-version') as HTMLElement;
const nativeLogContainer = document.getElementById('native-log-container') as HTMLElement;

// --- DOM ELEMENTS: LEGACY BACKWARDS-COMPATIBILITY HOOKS ---
const btnStartScan = document.getElementById('btn-start-scan') as HTMLButtonElement;
const btnDetectTab = document.getElementById('btn-detect-tab') as HTMLButtonElement;
const btnViewJson = document.getElementById('btn-view-json') as HTMLButtonElement;
const btnCopyJson = document.getElementById('btn-copy-json') as HTMLButtonElement;
const jsonViewerCard = document.getElementById('json-viewer-card') as HTMLElement;
const btnCloseJson = document.getElementById('btn-close-json') as HTMLButtonElement;
const jsonDisplay = document.getElementById('json-display') as HTMLTextAreaElement;
const btnOpenTab = document.getElementById('btn-open-tab') as HTMLButtonElement;

// --- DOM ELEMENTS: LICENSE & DAILY QUOTA METER ---
const licenseQuotaBar = document.getElementById('license-quota-bar') as HTMLElement;
const quotaStatusLabel = document.getElementById('quota-status-label') as HTMLElement;
const quotaProgressFill = document.getElementById('quota-progress-fill') as HTMLElement;
const btnOpenUpgrade = document.getElementById('btn-open-upgrade') as HTMLButtonElement;
const proActiveBar = document.getElementById('pro-active-bar') as HTMLElement;

// --- DOM ELEMENTS: PRO UPGRADE MODAL ---
const modalUpgrade = document.getElementById('modal-upgrade') as HTMLElement;
const btnCloseUpgradeModal = document.getElementById('btn-close-upgrade-modal') as HTMLButtonElement;
const modalQuotaAlert = document.getElementById('modal-quota-alert') as HTMLElement;
const inputLicenseKey = document.getElementById('input-license-key') as HTMLInputElement;
const btnActivateLicense = document.getElementById('btn-activate-license') as HTMLButtonElement;
const licenseFeedbackMsg = document.getElementById('license-feedback-msg') as HTMLElement;

// --- DOM ELEMENTS: IN-APP UPDATER ---
const btnCheckVersion = document.getElementById('btn-check-version') as HTMLElement;
const updateAlertBar = document.getElementById('update-alert-bar') as HTMLElement;
const valUpdateTitle = document.getElementById('val-update-title') as HTMLElement;
const valUpdateNotes = document.getElementById('val-update-notes') as HTMLElement;
const btnUpdateNow = document.getElementById('btn-update-now') as HTMLButtonElement;
const btnDismissUpdate = document.getElementById('btn-dismiss-update') as HTMLButtonElement;

// Dedicated Tab Pop-out Handler
btnOpenTab?.addEventListener('click', () => {
  const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
    ? chrome.runtime.getURL('dist/popup.html?mode=tab')
    : 'popup.html?mode=tab';
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
});

if (new URLSearchParams(window.location.search).get('mode') === 'tab') {
  if (btnOpenTab) {
    btnOpenTab.style.display = 'none';
  }
}

// --- TAB SWITCHING ---
tabBtnScanner?.addEventListener('click', () => {
  tabBtnScanner.classList.add('active');
  tabBtnNative.classList.remove('active');
  tabContentScanner.classList.add('active');
  tabContentNative.classList.remove('active');
});

tabBtnNative?.addEventListener('click', () => {
  tabBtnNative.classList.add('active');
  tabBtnScanner.classList.remove('active');
  tabContentNative.classList.add('active');
  tabContentScanner.classList.remove('active');
});

// --- LICENSE & DAILY QUOTA CONTROLLER ---

export async function refreshQuotaUI() {
  try {
    const licenseService = LicenseService.getInstance();
    const quota = await licenseService.getDailyQuota();

    if (quota.isPro) {
      if (licenseQuotaBar) licenseQuotaBar.style.display = 'none';
      if (proActiveBar) proActiveBar.style.display = 'flex';

      const license = await licenseService.getLicenseState();
      const planTitle = document.getElementById('val-pro-plan-title');
      const planSub = document.getElementById('val-pro-plan-sub');
      const slotBadge = document.getElementById('val-pro-device-slot');

      if (planTitle && license.planName) {
        planTitle.textContent = license.planName.toUpperCase();
      }
      if (planSub) {
        if (license.utr) {
          planSub.textContent = `— Verified with UTR: ${license.utr} (${license.daysRemaining != null ? license.daysRemaining + "d left" : "Active"})`;
        } else if (license.daysRemaining != null) {
          planSub.textContent = `— ${license.daysRemaining} days remaining (Unlimited Daily Downloads)`;
        } else {
          planSub.textContent = '— Unlimited Daily Downloads (No 10 GB Limit)';
        }
      }
      if (slotBadge) {
        if (license.maxDevices && license.maxDevices > 1) {
          slotBadge.textContent = `SLOT ${license.currentDevices || 1}/${license.maxDevices}`;
        } else {
          slotBadge.textContent = '1 DEVICE';
        }
      }
    } else {
      if (licenseQuotaBar) licenseQuotaBar.style.display = 'flex';
      if (proActiveBar) proActiveBar.style.display = 'none';

      const usedGB = (quota.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      const limitGB = (DAILY_FREE_LIMIT_BYTES / (1024 * 1024 * 1024)).toFixed(0);
      const pct = Math.min(100, Math.max(0, (quota.usedBytes / DAILY_FREE_LIMIT_BYTES) * 100));

      if (quotaStatusLabel) {
        quotaStatusLabel.textContent = `Daily Quota: ${usedGB} GB / ${limitGB} GB`;
      }
      if (quotaProgressFill) {
        quotaProgressFill.style.width = `${pct.toFixed(1)}%`;
        if (pct >= 90) {
          quotaProgressFill.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
        } else {
          quotaProgressFill.style.background = 'linear-gradient(90deg, #3b82f6, #10b981)';
        }
      }
    }
  } catch (err) {
    console.error('Failed to refresh quota UI:', err);
  }
}

export function openUpgradeModal(showAlert = false) {
  if (modalUpgrade) {
    modalUpgrade.style.display = 'flex';
    if (modalQuotaAlert) {
      modalQuotaAlert.style.display = showAlert ? 'block' : 'none';
    }
    if (licenseFeedbackMsg) {
      licenseFeedbackMsg.style.display = 'none';
      licenseFeedbackMsg.textContent = '';
    }
    if (inputLicenseKey) {
      setTimeout(() => inputLicenseKey.focus(), 50);
    }
  }
}

export function closeUpgradeModal() {
  if (modalUpgrade) {
    modalUpgrade.style.display = 'none';
    if (licenseFeedbackMsg) {
      licenseFeedbackMsg.style.display = 'none';
      licenseFeedbackMsg.textContent = '';
    }
  }
}

btnOpenUpgrade?.addEventListener('click', () => {
  openUpgradeModal(false);
});

btnCloseUpgradeModal?.addEventListener('click', () => {
  closeUpgradeModal();
});

modalUpgrade?.addEventListener('click', (e: MouseEvent) => {
  if (e.target === modalUpgrade) {
    closeUpgradeModal();
  }
});

btnActivateLicense?.addEventListener('click', async () => {
  const key = inputLicenseKey?.value.trim() || '';
  if (!key) {
    if (licenseFeedbackMsg) {
      licenseFeedbackMsg.style.display = 'block';
      licenseFeedbackMsg.className = 'license-feedback error';
      licenseFeedbackMsg.textContent = 'Please enter a valid license key.';
    }
    return;
  }

  btnActivateLicense.disabled = true;
  btnActivateLicense.textContent = 'Verifying...';

  try {
    const res = await LicenseService.getInstance().activateLicense(key);
    btnActivateLicense.disabled = false;
    btnActivateLicense.textContent = 'Activate';

    if (res.success) {
      if (licenseFeedbackMsg) {
        licenseFeedbackMsg.style.display = 'block';
        licenseFeedbackMsg.className = 'license-feedback success';
        licenseFeedbackMsg.textContent = '🎉 License activated! DriveMate Pro Lifetime unlocked.';
      }
      await refreshQuotaUI();
      setTimeout(() => {
        closeUpgradeModal();
      }, 1500);
    } else {
      if (licenseFeedbackMsg) {
        licenseFeedbackMsg.style.display = 'block';
        licenseFeedbackMsg.className = 'license-feedback error';
        licenseFeedbackMsg.textContent = res.error || 'Invalid license key.';
      }
    }
  } catch (err: any) {
    btnActivateLicense.disabled = false;
    btnActivateLicense.textContent = 'Activate';
    if (licenseFeedbackMsg) {
      licenseFeedbackMsg.style.display = 'block';
      licenseFeedbackMsg.className = 'license-feedback error';
      licenseFeedbackMsg.textContent = err.message || 'Verification error.';
    }
  }
});

inputLicenseKey?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnActivateLicense?.click();
  }
});

const btnCopyUpi = document.getElementById('btn-copy-upi') as HTMLButtonElement;
btnCopyUpi?.addEventListener('click', () => {
  const upiId = '8927202527@yapl';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(upiId).then(() => {
      btnCopyUpi.textContent = '✓ Copied!';
      setTimeout(() => {
        btnCopyUpi.textContent = '📋 Copy';
      }, 1500);
    }).catch(() => {
      btnCopyUpi.textContent = '8927202527@yapl';
    });
  } else {
    btnCopyUpi.textContent = '8927202527@yapl';
  }
});

// --- IN-APP AUTO-UPDATER CONTROLLER ---
let activeUpdateInfo: AppUpdateInfo | null = null;

export async function checkAppUpdates(isManual = false): Promise<void> {
  const licenseService = LicenseService.getInstance();

  if (isManual && btnCheckVersion) {
    btnCheckVersion.textContent = 'Checking...';
    btnCheckVersion.classList.remove('badge-update-ready');
    btnCheckVersion.title = 'Checking for updates...';
  }

  try {
    const info = await licenseService.checkForAppUpdates(isManual);
    activeUpdateInfo = info;

    if (info.updateAvailable) {
      if (btnCheckVersion) {
        btnCheckVersion.textContent = `⚡ v${info.latestVersion}`;
        btnCheckVersion.classList.add('badge-update-ready');
        btnCheckVersion.title = `New DriveMate v${info.latestVersion} available! Click to update.`;
      }

      if (!info.isDismissed || isManual) {
        if (updateAlertBar) updateAlertBar.style.display = 'flex';
        if (valUpdateTitle) valUpdateTitle.textContent = `DriveMate v${info.latestVersion} Available!`;
        if (valUpdateNotes) valUpdateNotes.textContent = info.releaseNotes || 'Faster download engine & bug fixes';
      }
    } else {
      if (updateAlertBar) updateAlertBar.style.display = 'none';
      if (btnCheckVersion) {
        btnCheckVersion.classList.remove('badge-update-ready');
        if (isManual) {
          btnCheckVersion.textContent = '✓ Up to date';
          btnCheckVersion.title = `DriveMate v${info.currentVersion} is up to date`;
          setTimeout(() => {
            btnCheckVersion.textContent = `v${info.currentVersion}`;
            btnCheckVersion.title = 'Click to Check for Updates';
          }, 2500);
        } else {
          btnCheckVersion.textContent = `v${info.currentVersion}`;
          btnCheckVersion.title = 'Click to Check for Updates';
        }
      }
    }
  } catch (err) {
    console.warn('[DriveMate Update] Check failed:', err);
    if (isManual && btnCheckVersion) {
      btnCheckVersion.textContent = 'Check Failed';
      setTimeout(() => {
        btnCheckVersion.textContent = 'v0.3.0';
        btnCheckVersion.title = 'Click to Check for Updates';
      }, 2000);
    }
  }
}

btnCheckVersion?.addEventListener('click', () => {
  if (activeUpdateInfo?.updateAvailable) {
    if (updateAlertBar) updateAlertBar.style.display = 'flex';
    const targetUrl = activeUpdateInfo.updateUrl || 'https://drivemate-pro.pages.dev/assets/DriveMate-Chrome-Extension.zip';
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank');
    }
  } else {
    checkAppUpdates(true);
  }
});

btnUpdateNow?.addEventListener('click', () => {
  const targetUrl = activeUpdateInfo?.updateUrl || 'https://drivemate-pro.pages.dev/assets/DriveMate-Chrome-Extension.zip';
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url: targetUrl });
  } else {
    window.open(targetUrl, '_blank');
  }
});

btnDismissUpdate?.addEventListener('click', async () => {
  if (updateAlertBar) updateAlertBar.style.display = 'none';
  if (activeUpdateInfo?.latestVersion) {
    await LicenseService.getInstance().dismissUpdate(activeUpdateInfo.latestVersion);
  }
});


// --- HELPER: FORMAT BYTES ---
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || !isFinite(bytes)) {
    return '0 Bytes';
  }
  const b = Math.max(0, bytes);
  if (b === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  if (i < 0 || i >= sizes.length || isNaN(i)) {
    return `${b} Bytes`;
  }
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds) || !isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

// --- SHOW USER WARNING BOX ---
function showWarning(title: string, message: string, showSampleButton = true) {
  if (!dlWarningBox) return;
  dlWarningBox.style.display = 'block';
  dlWarningBox.innerHTML = `
    <div style="font-weight: 700; margin-bottom: 4px; color: #f87171;">${title}</div>
    <div style="margin-bottom: 8px; color: #cbd5e1; font-size: 11px; line-height: 1.4;">${message}</div>
    ${showSampleButton ? `
      <button id="btn-fix-sample" class="button-secondary" style="width: 100%; font-size: 11px; padding: 6px 10px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; cursor: pointer;">
        👉 Click to Test with Verified Public Sample Folder
      </button>
    ` : ''}
  `;

  if (showSampleButton) {
    const btnFix = document.getElementById('btn-fix-sample');
    btnFix?.addEventListener('click', () => {
      const sample = 'https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks';
      inputFolderId.value = sample;
      startUnifiedDownload(sample);
    });
  }
}

function hideWarning() {
  if (dlWarningBox) {
    dlWarningBox.style.display = 'none';
    dlWarningBox.innerHTML = '';
  }
}

// --- FILE CLASSIFICATION & MEDIA BREAKDOWN ---
export interface MediaBreakdown {
  videos: DownloadFileItem[];
  photos: DownloadFileItem[];
  audio: DownloadFileItem[];
  docs: DownloadFileItem[];
  totalCount: number;
}

export function classifyFiles(files: DownloadFileItem[]): MediaBreakdown {
  const result: MediaBreakdown = {
    videos: [],
    photos: [],
    audio: [],
    docs: [],
    totalCount: files.length,
  };

  const videoExts = new Set([
    'mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv', '3gp', 'prores',
    'mts', 'm2ts', 'ts', 'vob', 'ogv', 'braw', 'r3d', 'mxf', 'dv'
  ]);
  const photoExts = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif',
    'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'psd',
    'ai', 'eps', 'svg', 'ico', 'avif'
  ]);
  const audioExts = new Set([
    'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma', 'aiff', 'alac', 'opus', 'mid', 'midi'
  ]);

  for (const f of files) {
    const parts = f.name.split('.');
    const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
    const mime = (f.mimeType || '').toLowerCase();

    if (videoExts.has(ext) || mime.startsWith('video/')) {
      result.videos.push(f);
    } else if (photoExts.has(ext) || mime.startsWith('image/')) {
      result.photos.push(f);
    } else if (audioExts.has(ext) || mime.startsWith('audio/')) {
      result.audio.push(f);
    } else {
      result.docs.push(f);
    }
  }

  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

let currentScannedTarget: string = '';
let isScanningActive: boolean = false;
let currentBreakdown: MediaBreakdown | null = null;
let currentDownloadableFiles: DownloadFileItem[] = [];

export function getCurrentBreakdown(): MediaBreakdown | null {
  return currentBreakdown;
}

function renderScannedFolderBreakdown(scanResult: ScanResult, files: DownloadFileItem[]) {
  const breakdown = classifyFiles(files);
  currentBreakdown = breakdown;
  currentDownloadableFiles = files;

  if (summaryFolderName) {
    summaryFolderName.textContent = scanResult.rootFolderName || 'Google Drive Folder';
  }
  if (summaryTotalSubtitle) {
    summaryTotalSubtitle.textContent = `${files.length} file(s) counted • Zero Google Login`;
  }
  if (countVideos) {
    countVideos.textContent = String(breakdown.videos.length);
  }
  if (countPhotos) {
    countPhotos.textContent = String(breakdown.photos.length);
  }
  if (countAudio) {
    countAudio.textContent = String(breakdown.audio.length);
  }
  if (countDocs) {
    countDocs.textContent = String(breakdown.docs.length);
  }
  if (previewToggleText) {
    previewToggleText.textContent = `Preview all files (${files.length})`;
  }

  // Populate preview list
  if (scannedFilesPreviewList) {
    scannedFilesPreviewList.innerHTML = '';
    for (const f of files) {
      const parts = f.name.split('.');
      const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';
      const mime = (f.mimeType || '').toLowerCase();

      let icon = '📄';
      if (['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'prores', 'mts'].includes(ext) || mime.startsWith('video/')) {
        icon = '🎬';
      } else if (['jpg', 'jpeg', 'png', 'heic', 'raw', 'cr2', 'cr3', 'dng', 'arw', 'nef', 'webp'].includes(ext) || mime.startsWith('image/')) {
        icon = '📸';
      } else if (['mp3', 'wav', 'aac', 'flac', 'm4a'].includes(ext) || mime.startsWith('audio/')) {
        icon = '🎵';
      }

      const itemEl = document.createElement('div');
      itemEl.className = 'scanned-preview-item';
      itemEl.innerHTML = `
        <div class="scanned-item-left">
          <span>${icon}</span>
          <span class="scanned-item-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        </div>
        ${f.relativePath && f.relativePath !== f.name ? `<span class="scanned-item-path" title="${escapeHtml(f.relativePath)}">${escapeHtml(f.relativePath.split('/')[0])}</span>` : ''}
      `;
      scannedFilesPreviewList.appendChild(itemEl);
    }
  }

  if (scannedFolderSummary) {
    scannedFolderSummary.style.display = 'flex';
  }

  if (btnStartDownload) {
    btnStartDownload.innerHTML = `🚀 START DOWNLOAD (${files.length} FILES)`;
    btnStartDownload.disabled = false;
  }
}

// --- STEP 1: INSPECT & COUNT DRIVE FOLDER (TRIGGERED ON PASTE OR INPUT) ---
export async function inspectAndCountFolder(targetOverride?: string, autoStartDownload = false) {
  const targetUrl = (targetOverride || inputFolderId.value).trim();
  if (!targetUrl) {
    inputFolderId.focus();
    showWarning(
      '⚠️ Link Required',
      'Please paste a public Google Drive folder link in the box above.',
      true
    );
    return;
  }

  if (isScanningActive) return;
  isScanningActive = true;

  // Abort any prior scan
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch {}
  }
  currentAbortController = new AbortController();

  hideWarning();

  // Show live scanning box
  if (scannedFolderSummary) scannedFolderSummary.style.display = 'none';
  if (scanLoadingIndicator) scanLoadingIndicator.style.display = 'flex';
  if (scanLoadingDetail) scanLoadingDetail.textContent = 'Counting footages, photos, and files (Zero Login)...';

  if (btnStartDownload) {
    btnStartDownload.textContent = '⏳ COUNTING FILES IN DRIVE...';
    btnStartDownload.disabled = true;
  }

  let scanResult: ScanResult;
  try {
    const scanner = new PublicDriveScanner({
      targetUrlOrId: targetUrl,
      signal: currentAbortController.signal,
      enrichMetadata: false, // Instant directory traversal
      onProgress: (info) => {
        if (scanLoadingDetail) {
          scanLoadingDetail.textContent = `Scanned ${info.foldersScanned} folder(s), counted ${info.filesFound} file(s)...`;
        }
      }
    });

    scanResult = await scanner.scan();
    lastScanResult = scanResult;
    currentScannedTarget = targetUrl;
  } catch (err: any) {
    if (currentAbortController?.signal.aborted) {
      currentAbortController = null;
      isScanningActive = false;
      if (scanLoadingIndicator) scanLoadingIndicator.style.display = 'none';
      return;
    }

    currentAbortController = null;
    isScanningActive = false;
    if (scanLoadingIndicator) scanLoadingIndicator.style.display = 'none';
    if (btnStartDownload) {
      btnStartDownload.textContent = 'DOWNLOAD FOLDER NOW';
      btnStartDownload.disabled = false;
    }
    showWarning(
      '❌ Scan Failed',
      `Could not scan folder: ${err.message || String(err)}`,
      true
    );
    return;
  }

  currentAbortController = null;
  isScanningActive = false;
  if (scanLoadingIndicator) scanLoadingIndicator.style.display = 'none';

  // Validate scan completeness
  if (!scanResult.isComplete || scanResult.errors.length > 0) {
    if (btnStartDownload) {
      btnStartDownload.textContent = 'DOWNLOAD FOLDER NOW';
      btnStartDownload.disabled = false;
    }
    const isAccessDenied = scanResult.completenessStatus === 'INCOMPLETE_PERMISSION_DENIED' ||
      scanResult.errors.some(e => e.errorCode === 'INACCESSIBLE_RESOURCE');

    if (isAccessDenied) {
      showWarning(
        '🔒 Folder is Private or Restricted',
        `Google Drive denied access to this folder. DriveMate requires public link access with Zero Login.<br><br>` +
        `<strong>How to fix:</strong><br>` +
        `1. Open this folder in Google Drive.<br>` +
        `2. Click <strong>Share</strong>.<br>` +
        `3. Under <em>General access</em>, set to <strong>"Anyone with the link"</strong> (Viewer).`,
        true
      );
    } else {
      showWarning(
        '⚠️ Scan Incomplete',
        scanResult.completenessReason || 'Folder scan was incomplete. Recursive download blocked for safety.',
        true
      );
    }
    return;
  }

  const filesToDownload: DownloadFileItem[] = collectDownloadableFiles(scanResult.rootNode);
  if (filesToDownload.length === 0) {
    if (btnStartDownload) {
      btnStartDownload.textContent = 'DOWNLOAD FOLDER NOW';
      btnStartDownload.disabled = false;
    }
    showWarning(
      '⚠️ No Downloadable Files Found',
      'This folder contains no binary files supported for unauthenticated public download.',
      true
    );
    return;
  }

  // Render pre-download category breakdown and preview
  renderScannedFolderBreakdown(scanResult, filesToDownload);

  // If user requested immediate download execution
  if (autoStartDownload) {
    await startDownloadNow();
  }
}

// --- STEP 2: START DOWNLOAD EXECUTION ---
export async function startDownloadNow() {
  const targetUrl = inputFolderId.value.trim();
  if (!lastScanResult || currentDownloadableFiles.length === 0 || targetUrl !== currentScannedTarget) {
    await inspectAndCountFolder(targetUrl, true);
    return;
  }

  let destinationPath = inputDestinationPath.value.trim();
  if (!destinationPath) {
    destinationPath = '/Users/gobindabiswas/Downloads/DriveMate';
    inputDestinationPath.value = destinationPath;
  }

  const concurrency = parseInt(selectConcurrency.value, 10) || 16;
  const filesToDownload = currentDownloadableFiles;
  const initialTotal = Number(lastScanResult.stats.supportedFilesSizeBytes) || 0;

  // Check daily quota enforcement for free tier (10 GB/day)
  const quotaCheck = await LicenseService.getInstance().canDownloadBatch(initialTotal);
  if (!quotaCheck.allowed) {
    openUpgradeModal(true);
    showWarning(
      '⚠️ Daily Free Quota Exceeded (10 GB)',
      `This download requires ${formatBytes(initialTotal)}, but you only have ${formatBytes(quotaCheck.remainingBytes)} free quota remaining today. Upgrade to Pro Lifetime for unlimited downloads or wait until tomorrow!`,
      false
    );
    return;
  }

  hideWarning();

  // Transition UI directly to Progress Card in DOWNLOADING state
  downloadConfigCard.style.display = 'none';
  downloadProgressCard.style.display = 'flex';
  downloadReportCard.style.display = 'none';

  currentJobId = `job_${Date.now()}`;
  activeFilesMap.clear();

  for (const f of filesToDownload) {
    activeFilesMap.set(f.id, {
      name: f.name,
      bytes: 0,
      total: f.expectedSize || 0,
      status: 'QUEUED',
    });
  }

  if (dlStatusTitle) {
    dlStatusTitle.textContent = 'DriveMate Active Download';
  }
  dlStatusBadge.className = 'badge badge-connecting';
  dlStatusBadge.textContent = 'DOWNLOADING';
  dlProgressBar.style.width = '0%';
  dlProgressText.textContent = initialTotal > 0
    ? `0% (0 Bytes / ${formatBytes(initialTotal)})`
    : `0% (0 Bytes / Calculating…)`;
  dlSpeedEta.textContent = '— • ETA: —';
  dlFilesCount.textContent = `0 completed (0 active, 0 failed)`;
  btnPauseDownload.style.display = 'inline-block';
  btnResumeDownload.style.display = 'none';
  btnStopDownload.style.display = 'inline-block';
  btnStopDownload.textContent = 'STOP';

  renderFileList();

  try {
    const skipExisting = chkSkipExisting ? chkSkipExisting.checked : true;
    await downloadClient.startJob(
      {
        jobId: currentJobId,
        destinationPath,
        concurrency,
        skipExisting,
        files: filesToDownload,
      },
      {
        onProgress: handleJobProgress,
        onFileCompleted: handleFileCompleted,
        onFileFailed: handleFileFailed,
        onJobCompleted: handleJobCompleted,
        onStateChange: handleStateChange,
      }
    );
  } catch (err: any) {
    downloadProgressCard.style.display = 'none';
    downloadConfigCard.style.display = 'flex';
    showWarning(
      '❌ Download Start Failed',
      `Failed to launch download job via macOS native helper: ${err.message}`,
      false
    );
  }
}

// Backwards-compatible alias for 1-step automated caller
export async function startUnifiedDownload(targetOverride?: string) {
  return inspectAndCountFolder(targetOverride, true);
}

// --- EVENT HANDLERS: USER INTERACTIONS ---

// 1. Instantly inspect and count files on PASTE into the input field (Does NOT auto-download yet)
inputFolderId?.addEventListener('paste', (e: ClipboardEvent) => {
  const pastedText = e.clipboardData?.getData('text') || '';
  if (pastedText.trim().length > 5) {
    inputFolderId.value = pastedText.trim();
    setTimeout(() => {
      inspectAndCountFolder(pastedText.trim(), false);
    }, 50);
  }
});

// 2. Debounced inspection when editing or typing a valid link
let inputDebounceTimer: any = null;
inputFolderId?.addEventListener('input', () => {
  const val = inputFolderId?.value.trim() || '';
  clearTimeout(inputDebounceTimer);
  if (val && val !== currentScannedTarget && (val.includes('drive.google.com') || val.length >= 15)) {
    inputDebounceTimer = setTimeout(() => {
      inspectAndCountFolder(val, false);
    }, 600);
  }
});

// 3. Start download on ENTER key
inputFolderId?.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = inputFolderId?.value.trim() || '';
    if (lastScanResult && currentDownloadableFiles.length > 0 && val === currentScannedTarget) {
      startDownloadNow();
    } else {
      inspectAndCountFolder(val, true);
    }
  }
});

// 4. Primary action button click
btnStartDownload?.addEventListener('click', () => {
  const val = inputFolderId?.value.trim() || '';
  if (lastScanResult && currentDownloadableFiles.length > 0 && val === currentScannedTarget) {
    startDownloadNow();
  } else {
    inspectAndCountFolder(val, true);
  }
});

// 5. Sample link click (Inspects and counts sample folder)
btnSampleLink?.addEventListener('click', () => {
  const sample = 'https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks';
  inputFolderId.value = sample;
  inspectAndCountFolder(sample, false);
});

// 6. Rescan / Refresh Folder button
btnRescanFolder?.addEventListener('click', () => {
  inspectAndCountFolder(inputFolderId.value.trim(), false);
});

// 7. Toggle File Preview Accordion
let isPreviewExpanded = false;
btnToggleFilePreview?.addEventListener('click', () => {
  isPreviewExpanded = !isPreviewExpanded;
  if (scannedFilesPreviewList) {
    scannedFilesPreviewList.style.display = isPreviewExpanded ? 'flex' : 'none';
  }
  if (previewToggleIcon) {
    previewToggleIcon.textContent = isPreviewExpanded ? '▼' : '▶';
  }
});

// 5. Dismiss Summary Report
btnDismissReport?.addEventListener('click', async () => {
  await downloadClient.clearJobState();
  downloadReportCard.style.display = 'none';
  downloadConfigCard.style.display = 'flex';
  inputFolderId.value = '';
  inputFolderId.focus();
});

// 6. Retry Failed Files Handler
btnRetryFailed?.addEventListener('click', async () => {
  const state = await downloadClient.getCurrentState();
  let filesToRetry: DownloadFileItem[] = [];

  if (state?.request?.files) {
    for (const f of state.request.files) {
      const activeItem = state.activeFiles?.[f.id];
      if (!activeItem || activeItem.status !== 'VERIFIED') {
        filesToRetry.push(f);
      }
    }
  }

  const destinationPath = state?.request?.destinationPath || inputDestinationPath.value.trim() || '/Users/gobindabiswas/Downloads/DriveMate';
  const concurrency = state?.request?.concurrency || parseInt(selectConcurrency.value, 10) || 16;

  if (filesToRetry.length > 0) {
    const retryBytes = filesToRetry.reduce((sum, f) => sum + (f.expectedSize || 0), 0);
    const quotaCheck = await LicenseService.getInstance().canDownloadBatch(retryBytes);
    if (!quotaCheck.allowed) {
      openUpgradeModal(true);
      showWarning(
        '⚠️ Daily Free Quota Exceeded (10 GB)',
        `Retrying these files requires ${formatBytes(retryBytes)}, which exceeds your remaining daily free limit. Upgrade to Pro Lifetime for unlimited downloads.`,
        false
      );
      return;
    }

    downloadReportCard.style.display = 'none';
    downloadProgressCard.style.display = 'flex';

    currentJobId = `job_${Date.now()}`;
    activeFilesMap.clear();

    for (const f of filesToRetry) {
      activeFilesMap.set(f.id, {
        name: f.name,
        bytes: 0,
        total: f.expectedSize || 0,
        status: 'QUEUED'
      });
    }

    dlStatusBadge.className = 'badge badge-connecting';
    dlStatusBadge.textContent = 'DOWNLOADING';
    dlProgressBar.style.width = '0%';
    dlProgressText.textContent = `Retrying ${filesToRetry.length} remaining file(s)...`;
    dlSpeedEta.textContent = '— • ETA: —';
    dlFilesCount.textContent = `0 completed (0 active, 0 failed)`;
    btnPauseDownload.style.display = 'inline-block';
    btnResumeDownload.style.display = 'none';
    btnStopDownload.style.display = 'inline-block';
    btnStopDownload.textContent = 'STOP';

    renderFileList();

    try {
      await downloadClient.startJob(
        {
          jobId: currentJobId,
          destinationPath,
          concurrency,
          skipExisting: true,
          files: filesToRetry
        },
        {
          onProgress: handleJobProgress,
          onFileCompleted: handleFileCompleted,
          onFileFailed: handleFileFailed,
          onJobCompleted: handleJobCompleted,
          onStateChange: handleStateChange
        }
      );
    } catch (err: any) {
      downloadProgressCard.style.display = 'none';
      downloadReportCard.style.display = 'flex';
      showWarning('❌ Retry Launch Failed', `Failed to relaunch download: ${err.message}`, false);
    }
  } else if (inputFolderId.value.trim()) {
    downloadReportCard.style.display = 'none';
    startUnifiedDownload(inputFolderId.value.trim());
  } else {
    downloadReportCard.style.display = 'none';
    downloadConfigCard.style.display = 'flex';
  }
});

// --- DOWNLOAD PROGRESS & CONTROLS ---

function handleJobProgress(event: JobProgressEvent) {
  const overallBytes = Number(event.overallBytes) || 0;
  let overallTotal = Number(event.overallTotalBytes) || 0;
  if (overallTotal <= 0 && lastScanResult?.stats?.supportedFilesSizeBytes) {
    overallTotal = Number(lastScanResult.stats.supportedFilesSizeBytes) || 0;
  }

  let mapCompleted = 0;
  let mapActive = 0;
  let mapFailed = 0;
  for (const f of activeFilesMap.values()) {
    if (f.status === 'VERIFIED') mapCompleted++;
    else if (f.status === 'FAILED') mapFailed++;
    else if (f.status === 'DOWNLOADING') mapActive++;
  }
  const completed = Math.max(Number(event.completedCount) || 0, mapCompleted);
  const active = (event.activeCount !== undefined && event.activeCount !== null) ? Number(event.activeCount) : mapActive;
  const failed = Math.max(Number(event.failedCount) || 0, mapFailed);
  const totalFiles = Number(event.totalFiles) || (lastScanResult?.stats?.supportedFilesCount) || (completed + active + failed);

  let pct = 0;
  if (overallTotal > 0) {
    pct = Math.min(100, Math.max(0, (overallBytes / overallTotal) * 100));
    dlProgressBar.style.width = `${pct.toFixed(1)}%`;
    dlProgressText.textContent = `${pct.toFixed(1)}% (${formatBytes(overallBytes)} / ${formatBytes(overallTotal)})`;
  } else {
    // Total bytes genuinely unknown
    if (totalFiles > 0) {
      pct = Math.min(100, Math.max(0, (completed / totalFiles) * 100));
      dlProgressBar.style.width = `${pct.toFixed(1)}%`;
    } else {
      dlProgressBar.style.width = '0%';
    }
    const byteStr = overallBytes > 0 ? formatBytes(overallBytes) : '0 Bytes';
    dlProgressText.textContent = `${pct.toFixed(1)}% (${byteStr} / Calculating…)`;
  }

  let speedStr = '—';
  let etaStr = '—';
  const speed = Number(event.speedBps) || 0;
  if (speed > 0) {
    speedStr = `${formatBytes(speed)}/s`;
    if (overallTotal > 0 && overallTotal > overallBytes) {
      const remainingBytes = overallTotal - overallBytes;
      const etaSeconds = Math.round(remainingBytes / speed);
      etaStr = formatEta(etaSeconds);
    } else if (overallTotal <= 0) {
      etaStr = 'Calculating…';
    }
  } else {
    speedStr = '—';
    etaStr = '—';
  }
  dlSpeedEta.textContent = `${speedStr} • ETA: ${etaStr}`;
  dlFilesCount.textContent = `${completed} completed (${active} active, ${failed} failed)`;

  if (event.fileId && activeFilesMap.has(event.fileId)) {
    const item = activeFilesMap.get(event.fileId)!;
    const downloaded = event.bytesDownloaded !== undefined ? Number(event.bytesDownloaded) : (event.bytesWritten !== undefined ? Number(event.bytesWritten) : item.bytes);
    item.bytes = isNaN(downloaded) ? item.bytes : downloaded;
    if (event.totalBytes !== undefined && Number(event.totalBytes) > 0) {
      item.total = Number(event.totalBytes);
    }
    item.status = 'DOWNLOADING';
    requestRenderFileList();
  }
}

function handleFileCompleted(event: FileCompletedEvent) {
  if (activeFilesMap.has(event.fileId)) {
    const item = activeFilesMap.get(event.fileId)!;
    item.status = 'VERIFIED';
    const rawWritten = event.bytesWritten !== undefined ? Number(event.bytesWritten) : (event.bytesDownloaded !== undefined ? Number(event.bytesDownloaded) : 0);
    const written = isNaN(rawWritten) ? 0 : rawWritten;
    item.bytes = written;
    item.total = (item.total && item.total > 0) ? item.total : written;
    item.verified = Boolean(event.verified);
    requestRenderFileList();

    if (written > 0) {
      LicenseService.getInstance().recordDownloadedBytes(written).then(() => {
        refreshQuotaUI();
      }).catch(console.error);
    }
  }
}

function handleFileFailed(event: FileFailedEvent) {
  if (activeFilesMap.has(event.fileId)) {
    const item = activeFilesMap.get(event.fileId)!;
    item.status = 'FAILED';
    item.error = event.error;
    requestRenderFileList();
  }
}

function handleJobCompleted(event: JobCompletedEvent) {
  downloadProgressCard.style.display = 'none';
  downloadReportCard.style.display = 'flex';

  const stats = event.stats;
  if (stats.failedFiles === 0) {
    dlReportBadge.className = 'badge badge-connected';
    dlReportBadge.textContent = 'COMPLETED';
    if (btnRetryFailed) btnRetryFailed.style.display = 'none';
    if (reportQuotaHint) reportQuotaHint.style.display = 'none';
  } else {
    dlReportBadge.className = 'badge badge-error';
    dlReportBadge.textContent = 'COMPLETED WITH ERRORS';
    if (btnRetryFailed) {
      btnRetryFailed.style.display = 'inline-block';
      btnRetryFailed.textContent = `⚡ Retry Failed Files (${stats.failedFiles})`;
    }
    if (reportQuotaHint) reportQuotaHint.style.display = 'block';
  }

  reportCompletedFiles.textContent = String(stats.completedFiles);
  reportFailedFiles.textContent = String(stats.failedFiles);
  reportTotalBytes.textContent = formatBytes(stats.totalBytes);
}

function handleStateChange(state: string, error?: string) {
  if (state === 'paused') {
    dlStatusBadge.className = 'badge badge-connecting';
    dlStatusBadge.textContent = 'PAUSED';
    btnPauseDownload.style.display = 'none';
    btnResumeDownload.style.display = 'inline-block';
  } else if (state === 'running') {
    dlStatusBadge.className = 'badge badge-connecting';
    dlStatusBadge.textContent = 'DOWNLOADING';
    btnPauseDownload.style.display = 'inline-block';
    btnResumeDownload.style.display = 'none';
  } else if (state === 'stopped') {
    dlStatusBadge.className = 'badge badge-error';
    dlStatusBadge.textContent = 'STOPPED';
    btnPauseDownload.style.display = 'none';
    btnResumeDownload.style.display = 'none';
  } else if (state === 'error') {
    dlStatusBadge.className = 'badge badge-error';
    dlStatusBadge.textContent = 'ERROR';
    if (error) alert(`Download error: ${error}`);
  }
}

let renderScheduled = false;
function requestRenderFileList() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderFileList();
  });
}

function getDisplayItems(maxCount = 8): FileItemState[] {
  const result: FileItemState[] = [];
  // Priority 1: Actively downloading items
  for (const item of activeFilesMap.values()) {
    if (item.status === 'DOWNLOADING') {
      result.push(item);
      if (result.length >= maxCount) return result;
    }
  }
  // Priority 2: Failed / error items
  for (const item of activeFilesMap.values()) {
    if (item.status === 'FAILED') {
      result.push(item);
      if (result.length >= maxCount) return result;
    }
  }
  // Priority 3: Completed / verified items
  for (const item of activeFilesMap.values()) {
    if (item.status === 'VERIFIED') {
      result.push(item);
      if (result.length >= maxCount) return result;
    }
  }
  // Priority 4: Queued items
  for (const item of activeFilesMap.values()) {
    if (item.status === 'QUEUED') {
      result.push(item);
      if (result.length >= maxCount) return result;
    }
  }
  return result;
}

function renderFileList() {
  dlFilesList.innerHTML = '';
  const items = getDisplayItems(8);
  for (const item of items) {
    const el = document.createElement('div');
    el.className = 'file-item';

    let badgeHtml = '';
    if (item.status === 'DOWNLOADING') {
      badgeHtml = `<span class="badge badge-downloading">DOWNLOADING</span>`;
    } else if (item.status === 'VERIFIED') {
      badgeHtml = item.verified
        ? `<span class="badge badge-connected">✓ MD5 VERIFIED</span>`
        : `<span class="badge badge-connected">✓ SIZE VERIFIED</span>`;
    } else if (item.status === 'FAILED') {
      const errLower = (item.error || '').toLowerCase();
      let failBadge = 'FAILED';
      if (errLower.includes('size unverified')) {
        failBadge = 'SIZE UNVERIFIED';
      } else if (errLower.includes('429') || errLower.includes('quota') || errLower.includes('rate limit')) {
        failBadge = 'QUOTA EXCEEDED';
      } else if (errLower.includes('403') || errLower.includes('401') || errLower.includes('permission') || errLower.includes('access denied')) {
        failBadge = 'ACCESS DENIED';
      } else if (errLower.includes('404') || errLower.includes('not found')) {
        failBadge = 'NOT FOUND';
      } else if (errLower.includes('507') || errLower.includes('disk space') || errLower.includes('disk error') || errLower.includes('no space')) {
        failBadge = 'DISK ERROR';
      } else if (errLower.includes('integrity') || errLower.includes('md5') || errLower.includes('mismatch')) {
        failBadge = 'INTEGRITY FAILED';
      } else if (errLower.includes('network') || errLower.includes('timeout') || errLower.includes('connection lost')) {
        failBadge = 'NETWORK ERROR';
      }
      badgeHtml = `<span class="badge badge-error" title="${item.error || 'Failed'}">${failBadge}</span>`;
    } else {
      badgeHtml = `<span class="badge badge-idle">QUEUED</span>`;
    }

    let detailText = '';
    const bytesNum = typeof item.bytes === 'number' && !isNaN(item.bytes) ? item.bytes : 0;
    const totalNum = typeof item.total === 'number' && !isNaN(item.total) ? item.total : 0;

    if (item.status === 'FAILED') {
      detailText = item.error || 'Failed';
    } else if (item.status === 'VERIFIED') {
      const displayTotal = totalNum > 0 ? totalNum : bytesNum;
      detailText = `${formatBytes(bytesNum)} / ${formatBytes(displayTotal)}`;
    } else if (item.status === 'DOWNLOADING') {
      if (totalNum > 0) {
        detailText = `${formatBytes(bytesNum)} / ${formatBytes(totalNum)}`;
      } else {
        detailText = `${formatBytes(bytesNum)} / Calculating…`;
      }
    } else {
      // QUEUED
      if (totalNum > 0) {
        detailText = `Queued (${formatBytes(totalNum)})`;
      } else {
        detailText = `Queued (Size unknown)`;
      }
    }

    el.innerHTML = `
      <div class="file-item-header">
        <span class="file-item-title" title="${item.name}">${item.name}</span>
        ${badgeHtml}
      </div>
      <div class="file-item-details">
        <span>${detailText}</span>
      </div>
    `;
    dlFilesList.appendChild(el);
  }
}

// Pause, Resume, Stop controls
btnPauseDownload?.addEventListener('click', () => {
  downloadClient.pauseJob(currentJobId || undefined);
});

btnResumeDownload?.addEventListener('click', () => {
  downloadClient.resumeJob(currentJobId || undefined);
});

btnStopDownload?.addEventListener('click', () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    downloadProgressCard.style.display = 'none';
    downloadConfigCard.style.display = 'flex';
    return;
  }
  if (confirm('Are you sure you want to stop the download job?')) {
    downloadClient.stopJob(currentJobId || undefined);
  }
});

// --- JSON INSPECTION & EXPORT (BACKWARDS-COMPATIBILITY) ---
btnViewJson?.addEventListener('click', () => {
  if (!lastScanResult) return;
  jsonViewerCard.style.display = 'flex';
  jsonDisplay.value = JSON.stringify(lastScanResult, null, 2);
});

btnCloseJson?.addEventListener('click', () => {
  jsonViewerCard.style.display = 'none';
});

btnCopyJson?.addEventListener('click', () => {
  if (!lastScanResult) return;
  navigator.clipboard.writeText(JSON.stringify(lastScanResult, null, 2));
  alert('JSON hierarchy copied to clipboard!');
});

// Legacy hooks for tests
btnStartScan?.addEventListener('click', () => startUnifiedDownload());
btnDetectTab?.addEventListener('click', () => startUnifiedDownload());

// --- PHASE 1 NATIVE BRIDGE (PRESERVED) ---
function addNativeLog(text: string, type: 'info' | 'success' | 'error' = 'info') {
  if (!nativeLogContainer) return;
  const line = document.createElement('div');
  line.className = `log-line log-${type}`;
  const time = new Date().toLocaleTimeString();
  line.textContent = `[${time}] ${text}`;
  nativeLogContainer.appendChild(line);
  nativeLogContainer.scrollTop = nativeLogContainer.scrollHeight;
}

btnTestNative?.addEventListener('click', () => {
  addNativeLog('Pinging native Swift helper...', 'info');
  const startTime = Date.now();
  let hasReplied = false;

  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative('com.drivemate.helper');
  } catch (err: any) {
    addNativeLog(`connectNative error: ${err.message || String(err)}`, 'error');
    return;
  }

  const timeoutId = setTimeout(() => {
    if (!hasReplied) {
      hasReplied = true;
      addNativeLog('Native helper connection timed out (5000ms).', 'error');
      try { port.disconnect(); } catch {}
    }
  }, 5000);

  port.onMessage.addListener((msg) => {
    if (hasReplied) return;
    hasReplied = true;
    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;
    if (valLatency) valLatency.textContent = `${latency} ms`;
    if (valVersion) valVersion.textContent = msg.helperVersion ?? 'v0.3.0-phase3';
    addNativeLog(`Handshake response: ${msg.action} (latency: ${latency}ms)`, 'success');
    try { port.disconnect(); } catch {}
  });

  port.onDisconnect.addListener(() => {
    clearTimeout(timeoutId);
    // Always consume chrome.runtime.lastError first to prevent "Unchecked runtime.lastError"
    const lastError = chrome.runtime.lastError?.message || 'Native host disconnected.';
    if (hasReplied) return;
    hasReplied = true;
    addNativeLog(`Disconnected: ${lastError}`, 'error');
  });

  port.postMessage({
    action: 'PING',
    timestamp: startTime,
    payload: 'Phase 3 Native Bridge Handshake'
  });
});

addNativeLog('Native Bridge loaded and ready.', 'info');

// --- BACKGROUND JOB RESTORATION ---
// Ensures UI immediately recovers active downloads when reopening popup from another tab
async function restoreActiveJobState() {
  try {
    const job = await downloadClient.getCurrentState();
    if (!job) return;

    if (job.state === 'running' || job.state === 'paused') {
      currentJobId = job.jobId;
      downloadConfigCard.style.display = 'none';
      downloadProgressCard.style.display = 'flex';

      activeFilesMap.clear();
      if (job.activeFiles) {
        for (const [id, f] of Object.entries(job.activeFiles)) {
          activeFilesMap.set(id, f as any);
        }
      }
      renderFileList();

      downloadClient.setCallbacks({
        onProgress: handleJobProgress,
        onFileCompleted: handleFileCompleted,
        onFileFailed: handleFileFailed,
        onJobCompleted: handleJobCompleted,
        onStateChange: handleStateChange,
      });

      if (job.progress) {
        handleJobProgress(job.progress);
      }

      handleStateChange(job.state);
    } else if (job.state === 'completed' && job.stats) {
      currentJobId = job.jobId;
      downloadConfigCard.style.display = 'none';
      handleJobCompleted({
        action: 'JOB_COMPLETED',
        jobId: job.jobId,
        stats: job.stats
      });
    }
  } catch (e) {
    console.error('Failed to restore active job state:', e);
  }
}

restoreActiveJobState();
refreshQuotaUI();
checkAppUpdates(false);
