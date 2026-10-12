// DriveMate Background Service Worker (Manifest V3)
// Full Background Execution & Native Messaging Job Controller
// Allows downloads to run uninterrupted when switching tabs or closing popups

const HOST_NAME = "com.drivemate.helper";

interface TestConnectionResponse {
  success: boolean;
  latencyMs?: number;
  response?: any;
  error?: string;
  errorCode?: "HOST_NOT_FOUND" | "HOST_CRASHED" | "FORBIDDEN" | "TIMEOUT" | "UNKNOWN";
}

export interface ActiveJobState {
  jobId: string;
  state: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error';
  request: {
    jobId: string;
    destinationPath: string;
    concurrency: number;
    skipExisting?: boolean;
    files: Array<{
      id: string;
      name: string;
      relativePath: string;
      expectedSize?: number;
      md5Checksum?: string;
      mimeType?: string;
    }>;
  };
  progress: {
    jobId: string;
    overallBytes: number;
    overallTotalBytes: number;
    speedBps: number;
    activeCount: number;
    completedCount: number;
    failedCount: number;
    totalFiles?: number;
  } | null;
  activeFiles: Record<string, {
    name: string;
    bytes: number;
    total: number;
    status: 'DOWNLOADING' | 'VERIFIED' | 'FAILED' | 'QUEUED';
    verified?: boolean;
    error?: string;
  }>;
  stats: {
    totalFiles: number;
    completedFiles: number;
    failedFiles: number;
    totalBytes: number;
  } | null;
  error?: string;
  lastUpdated: number;
}

let activeJobState: ActiveJobState | null = null;
let downloadPort: chrome.runtime.Port | null = null;
let storageSaveDebounceTimer: any = null;

// Initialize state from storage on service worker start
chrome.storage.local.get(['activeJob'], (res) => {
  const job = res.activeJob as ActiveJobState | undefined;
  if (job && job.jobId) {
    activeJobState = job;
    updateBadge();
  }
});

// Helper: Broadcast message to any open popup or tab views
function broadcastMessage(msg: any) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup or tab is closed, which is completely expected
  });
}

// Helper: Save state to chrome.storage.local
function saveStateToStorage(immediate = false) {
  if (storageSaveDebounceTimer) {
    clearTimeout(storageSaveDebounceTimer);
    storageSaveDebounceTimer = null;
  }

  const persist = () => {
    if (activeJobState) {
      activeJobState.lastUpdated = Date.now();
      chrome.storage.local.set({ activeJob: activeJobState });
    }
  };

  if (immediate) {
    persist();
  } else {
    storageSaveDebounceTimer = setTimeout(persist, 500);
  }
}

// Helper: Mathematically reconcile counters from unique files in activeFiles map
function reconcileJobCounters() {
  if (!activeJobState || !activeJobState.activeFiles) return;
  let completed = 0;
  let failed = 0;
  let active = 0;
  let totalBytesWritten = 0;

  for (const item of Object.values(activeJobState.activeFiles)) {
    if (item.status === 'VERIFIED') {
      completed++;
      totalBytesWritten += (item.bytes || item.total || 0);
    } else if (item.status === 'FAILED') {
      failed++;
    } else if (item.status === 'DOWNLOADING') {
      active++;
      totalBytesWritten += (item.bytes || 0);
    }
  }

  if (activeJobState.progress) {
    activeJobState.progress.completedCount = completed;
    activeJobState.progress.failedCount = failed;
    activeJobState.progress.activeCount = active;
    activeJobState.progress.overallBytes = Math.max(activeJobState.progress.overallBytes || 0, totalBytesWritten);
  }
}

// Helper: Update extension badge for background visibility
function updateBadge() {
  if (!activeJobState) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  if (activeJobState.state === 'running' && activeJobState.progress) {
    const total = Number(activeJobState.progress.overallTotalBytes) || 0;
    const bytes = Number(activeJobState.progress.overallBytes) || 0;
    const completed = Number(activeJobState.progress.completedCount) || 0;
    const totalFiles = Number(activeJobState.progress.totalFiles) || (activeJobState.request?.files?.length || 0);
    let pct = 0;
    if (total > 0) {
      pct = Math.min(100, Math.round((bytes / total) * 100));
    } else if (totalFiles > 0) {
      pct = Math.min(100, Math.round((completed / totalFiles) * 100));
    }
    chrome.action.setBadgeText({ text: `${pct}%` });
    chrome.action.setBadgeBackgroundColor({ color: '#0284c7' }); // Sky blue
  } else if (activeJobState.state === 'paused') {
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Amber
  } else if (activeJobState.state === 'completed') {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#16a34a' }); // Green
  } else if (activeJobState.state === 'error') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' }); // Red
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Keepalive Alarm Handler
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'drivemate_keepalive') {
    if (activeJobState && activeJobState.state === 'running' && downloadPort) {
      try {
        downloadPort.postMessage({ action: 'PING', timestamp: Date.now() });
      } catch {}
    }
  }
});

// Central Message Dispatcher
chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  // 1. PROXY_FETCH for Public Link Scanner (Direct in-process fetch with extension host permissions)
  if (message.action === "PROXY_FETCH") {
    fetch(message.url, {
      method: message.method || "GET",
      headers: message.headers,
      credentials: "omit"
    })
    .then(async (resp) => {
      const text = message.method === "HEAD" ? "" : await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => { headers[k] = v; });
      const requiresLogin = resp.url && (resp.url.includes("accounts.google.com") || resp.url.includes("ServiceLogin"));
      sendResponse({
        success: true,
        ok: requiresLogin ? false : resp.ok,
        status: requiresLogin ? 401 : resp.status,
        headers,
        text,
        url: resp.url,
        requiresLogin
      });
    })
    .catch((err) => {
      sendResponse({
        success: false,
        ok: false,
        status: 0,
        error: err.message || String(err)
      });
    });
    return true;
  }

  // 2. GET CURRENT JOB STATE (For popup to immediately restore UI on open)
  if (message.action === "GET_CURRENT_JOB_STATE") {
    if (activeJobState) {
      sendResponse({ success: true, job: activeJobState });
    } else {
      chrome.storage.local.get(['activeJob'], (res) => {
        const job = res.activeJob as ActiveJobState | undefined;
        activeJobState = (job && job.jobId) ? job : null;
        sendResponse({ success: true, job: activeJobState });
      });
    }
    return true;
  }

  // 3. CLEAR JOB STATE (When user clicks dismiss report or resets)
  if (message.action === "CLEAR_JOB_STATE") {
    activeJobState = null;
    chrome.storage.local.remove(['activeJob']);
    updateBadge();
    sendResponse({ success: true });
    return false;
  }

  // 4. START DOWNLOAD JOB (Managed directly in Background Service Worker)
  if (message.action === "START_DOWNLOAD_JOB") {
    const req = message.request;
    if (!req || !req.jobId || !req.files) {
      sendResponse({ success: false, error: "Missing required request parameters." });
      return false;
    }

    // Clean up any existing connection
    if (downloadPort) {
      try { downloadPort.disconnect(); } catch {}
      downloadPort = null;
    }

    // Setup active state
    const initialFiles: ActiveJobState['activeFiles'] = {};
    for (const f of req.files) {
      initialFiles[f.id] = {
        name: f.name,
        bytes: 0,
        total: f.expectedSize ?? 0,
        status: 'QUEUED'
      };
    }

    activeJobState = {
      jobId: req.jobId,
      state: 'running',
      request: req,
      progress: {
        jobId: req.jobId,
        overallBytes: 0,
        overallTotalBytes: req.files.reduce((acc: number, f: any) => acc + (f.expectedSize || 0), 0),
        speedBps: 0,
        activeCount: 0,
        completedCount: 0,
        failedCount: 0
      },
      activeFiles: initialFiles,
      stats: null,
      lastUpdated: Date.now()
    };

    updateBadge();
    saveStateToStorage(true);

    try {
      downloadPort = chrome.runtime.connectNative(HOST_NAME);

      // Start keepalive alarm
      chrome.alarms.create('drivemate_keepalive', { periodInMinutes: 0.25 });

      downloadPort.onMessage.addListener((msg: any) => {
        if (!msg || typeof msg !== 'object') return;

        if (msg.action === 'JOB_STARTED' || msg.action === 'JOB_ACCEPTED') {
          if (activeJobState) {
            activeJobState.state = 'running';
          }
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'JOB_START_FAILED') {
          if (activeJobState) {
            activeJobState.state = 'error';
            activeJobState.error = msg.error || 'Failed to start download job';
          }
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          chrome.alarms.clear('drivemate_keepalive');
          return;
        }

        if (msg.action === 'DOWNLOAD_PROGRESS') {
          if (activeJobState) {
            activeJobState.progress = msg;
            if (msg.fileId && activeJobState.activeFiles[msg.fileId]) {
              const fileItem = activeJobState.activeFiles[msg.fileId];
              const downloaded = msg.bytesDownloaded !== undefined ? Number(msg.bytesDownloaded) : (msg.bytesWritten !== undefined ? Number(msg.bytesWritten) : fileItem.bytes);
              fileItem.bytes = isNaN(downloaded) ? fileItem.bytes : downloaded;
              if (msg.totalBytes !== undefined && Number(msg.totalBytes) > 0) {
                fileItem.total = Number(msg.totalBytes);
              }
              fileItem.status = 'DOWNLOADING';
            }
          }
          updateBadge();
          saveStateToStorage(false);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'FILE_COMPLETED') {
          if (activeJobState) {
            const rawWritten = msg.bytesWritten !== undefined ? Number(msg.bytesWritten) : (msg.bytesDownloaded !== undefined ? Number(msg.bytesDownloaded) : 0);
            const written = isNaN(rawWritten) ? 0 : rawWritten;
            if (activeJobState.activeFiles[msg.fileId]) {
              const item = activeJobState.activeFiles[msg.fileId];
              item.status = 'VERIFIED';
              item.bytes = written;
              item.total = (item.total && item.total > 0) ? item.total : written;
              item.verified = Boolean(msg.verified);
            } else {
              activeJobState.activeFiles[msg.fileId] = {
                name: msg.name || msg.fileId,
                bytes: written,
                total: written,
                status: 'VERIFIED',
                verified: Boolean(msg.verified)
              };
            }
            reconcileJobCounters();
          }
          saveStateToStorage(true);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'FILE_FAILED') {
          if (activeJobState) {
            if (activeJobState.activeFiles[msg.fileId]) {
              const item = activeJobState.activeFiles[msg.fileId];
              item.status = 'FAILED';
              item.error = msg.error;
            } else {
              activeJobState.activeFiles[msg.fileId] = {
                name: msg.fileId,
                bytes: 0,
                total: 0,
                status: 'FAILED',
                error: msg.error
              };
            }
            reconcileJobCounters();
          }
          saveStateToStorage(true);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'JOB_PAUSED') {
          if (activeJobState) activeJobState.state = 'paused';
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'JOB_RESUMED') {
          if (activeJobState) activeJobState.state = 'running';
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          return;
        }

        if (msg.action === 'JOB_STOPPED') {
          if (activeJobState) activeJobState.state = 'stopped';
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          chrome.alarms.clear('drivemate_keepalive');
          return;
        }

        if (msg.action === 'JOB_COMPLETED') {
          if (activeJobState) {
            activeJobState.state = 'completed';
            activeJobState.stats = msg.stats;
          }
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage(msg);
          chrome.alarms.clear('drivemate_keepalive');
          try { downloadPort?.disconnect(); } catch {}
          downloadPort = null;
          return;
        }
      });

      downloadPort.onDisconnect.addListener(() => {
        // Always consume chrome.runtime.lastError first to prevent "Unchecked runtime.lastError"
        const lastErr = chrome.runtime.lastError?.message || 'Native helper disconnected.';
        chrome.alarms.clear('drivemate_keepalive');
        if (activeJobState && activeJobState.state === 'running') {
          console.error(`[DriveMate SW] Native host disconnected: ${lastErr}`);
          activeJobState.state = 'error';
          activeJobState.error = lastErr;
          updateBadge();
          saveStateToStorage(true);
          broadcastMessage({
            action: 'JOB_ERROR',
            jobId: activeJobState.jobId,
            error: lastErr
          });
        }
        downloadPort = null;
      });

      // Post START_DOWNLOAD_JOB message to native host (streaming/batching files via APPEND_FILES to protect native messaging payloads)
      const BATCH_SIZE = 5000;
      const initialChunk = req.files.slice(0, BATCH_SIZE);
      const remainingFiles = req.files.slice(BATCH_SIZE);

      downloadPort.postMessage({
        action: 'START_DOWNLOAD_JOB',
        jobId: req.jobId,
        destinationPath: req.destinationPath,
        concurrency: req.concurrency,
        skipExisting: req.skipExisting !== false,
        files: initialChunk,
        totalFilesExpected: req.files.length
      });

      // Stream remaining files in batches via APPEND_FILES rather than requiring one oversized initial payload
      if (remainingFiles.length > 0) {
        for (let i = 0; i < remainingFiles.length; i += BATCH_SIZE) {
          const chunk = remainingFiles.slice(i, i + BATCH_SIZE);
          downloadPort.postMessage({
            action: 'APPEND_FILES',
            jobId: req.jobId,
            files: chunk
          });
        }
      }

      sendResponse({ success: true, jobId: req.jobId });
    } catch (err: any) {
      console.error("[DriveMate SW] Failed to start native job:", err);
      if (activeJobState) {
        activeJobState.state = 'error';
        activeJobState.error = err.message;
      }
      updateBadge();
      saveStateToStorage(true);
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }

  // 5. PAUSE DOWNLOAD JOB
  if (message.action === "PAUSE_DOWNLOAD_JOB") {
    if (downloadPort) {
      downloadPort.postMessage({
        action: "PAUSE_DOWNLOAD_JOB",
        jobId: message.jobId || activeJobState?.jobId
      });
    }
    if (activeJobState) {
      activeJobState.state = 'paused';
      updateBadge();
      saveStateToStorage(true);
    }
    sendResponse({ success: true });
    return false;
  }

  // 6. RESUME DOWNLOAD JOB
  if (message.action === "RESUME_DOWNLOAD_JOB") {
    if (downloadPort) {
      downloadPort.postMessage({
        action: "RESUME_DOWNLOAD_JOB",
        jobId: message.jobId || activeJobState?.jobId
      });
    }
    if (activeJobState) {
      activeJobState.state = 'running';
      updateBadge();
      saveStateToStorage(true);
    }
    sendResponse({ success: true });
    return false;
  }

  // 7. STOP DOWNLOAD JOB
  if (message.action === "STOP_DOWNLOAD_JOB") {
    if (downloadPort) {
      try {
        downloadPort.postMessage({
          action: "STOP_DOWNLOAD_JOB",
          jobId: message.jobId || activeJobState?.jobId
        });
        downloadPort.disconnect();
      } catch {}
      downloadPort = null;
    }
    chrome.alarms.clear('drivemate_keepalive');
    if (activeJobState) {
      activeJobState.state = 'stopped';
      updateBadge();
      saveStateToStorage(true);
    }
    sendResponse({ success: true });
    return false;
  }

  // 8. TEST_NATIVE_CONNECTION (Diagnostic tab)
  if (message.action === "TEST_NATIVE_CONNECTION") {
    const startTime = Date.now();
    let hasReplied = false;

    console.log(`[DriveMate SW] Initiating Native Messaging connection to '${HOST_NAME}'...`);

    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (err: any) {
      console.error("[DriveMate SW] connectNative threw exception:", err);
      sendResponse({
        success: false,
        error: `connectNative failed: ${err.message || String(err)}`,
        errorCode: "UNKNOWN"
      } as TestConnectionResponse);
      return false;
    }

    const timeoutId = setTimeout(() => {
      if (!hasReplied) {
        hasReplied = true;
        console.warn("[DriveMate SW] Connection timed out after 5000ms.");
        try { port.disconnect(); } catch {}
        sendResponse({
          success: false,
          error: "Native messaging host did not respond within 5000ms timeout.",
          errorCode: "TIMEOUT"
        } as TestConnectionResponse);
      }
    }, 5000);

    port.onMessage.addListener((msg) => {
      if (hasReplied) return;
      hasReplied = true;
      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;
      try { port.disconnect(); } catch {}

      sendResponse({
        success: msg.status === "SUCCESS",
        latencyMs: latency,
        response: msg,
        error: msg.status === "SUCCESS" ? undefined : (msg.error || "Host returned error status")
      } as TestConnectionResponse);
    });

    port.onDisconnect.addListener(() => {
      clearTimeout(timeoutId);
      // Always consume chrome.runtime.lastError first before checking hasReplied
      const lastError = chrome.runtime.lastError?.message || "Clean disconnect";
      if (hasReplied) return;
      hasReplied = true;

      console.error(`[DriveMate SW] Native host disconnected. Error: ${lastError}`);

      let errorCode: TestConnectionResponse["errorCode"] = "UNKNOWN";
      let userFriendlyError = lastError;

      if (lastError.includes("Specified native messaging host not found")) {
        errorCode = "HOST_NOT_FOUND";
        userFriendlyError =
          "Host manifest not found. Please verify ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.drivemate.helper.json exists.";
      } else if (lastError.includes("Access to the specified native messaging host is forbidden")) {
        errorCode = "FORBIDDEN";
        userFriendlyError =
          "Extension ID mismatch in allowed_origins. Verify com.drivemate.helper.json matches the loaded extension ID.";
      } else if (lastError.includes("Native host has exited")) {
        errorCode = "HOST_CRASHED";
        userFriendlyError =
          "Native host process exited unexpectedly. Verify executable binary path and execution permissions.";
      }

      sendResponse({
        success: false,
        error: userFriendlyError,
        errorCode: errorCode
      } as TestConnectionResponse);
    });

    const pingPayload = {
      action: "PING",
      timestamp: startTime,
      payload: message.payload || "Phase 1 Feasibility Probe"
    };

    try {
      port.postMessage(pingPayload);
    } catch (err: any) {
      if (!hasReplied) {
        hasReplied = true;
        clearTimeout(timeoutId);
        sendResponse({
          success: false,
          error: `postMessage failed: ${err.message || String(err)}`,
          errorCode: "UNKNOWN"
        } as TestConnectionResponse);
      }
    }

    return true;
  }

  return false;
});
