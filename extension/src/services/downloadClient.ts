// DriveMate Phase 3 — Chrome Background-Delegated Download Client
// Fully decoupled from ephemeral popup lifecycle — persists across tab switches
import {
  DownloadJobRequest,
  JobProgressEvent,
  FileCompletedEvent,
  FileFailedEvent,
  JobCompletedEvent,
} from '../types/drive';

export interface DownloadClientCallbacks {
  onProgress?: (event: JobProgressEvent) => void;
  onFileCompleted?: (event: FileCompletedEvent) => void;
  onFileFailed?: (event: FileFailedEvent) => void;
  onJobCompleted?: (event: JobCompletedEvent) => void;
  onStateChange?: (state: 'idle' | 'running' | 'paused' | 'stopped' | 'completed' | 'error', error?: string) => void;
}

export class NativeDownloadClient {
  private currentJobId: string | null = null;
  private callbacks: DownloadClientCallbacks = {};
  private messageListenerAttached = false;

  constructor() {
    this.attachMessageListener();
  }

  private attachMessageListener(): void {
    if (this.messageListenerAttached) return;
    this.messageListenerAttached = true;

    chrome.runtime.onMessage.addListener((msg: any) => {
      this.handleInboundBroadcast(msg);
    });
  }

  public setCallbacks(callbacks: DownloadClientCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  public async startJob(request: DownloadJobRequest, callbacks: DownloadClientCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.currentJobId = request.jobId;

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          action: 'START_DOWNLOAD_JOB',
          request
        },
        (response) => {
          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message || 'Failed to communicate with background service worker.';
            this.callbacks.onStateChange?.('error', err);
            return reject(new Error(err));
          }
          if (response && response.success) {
            this.callbacks.onStateChange?.('running');
            resolve();
          } else {
            const err = response?.error || 'Failed to start download job.';
            this.callbacks.onStateChange?.('error', err);
            reject(new Error(err));
          }
        }
      );
    });
  }

  public pauseJob(jobId?: string): void {
    const jId = jobId || this.currentJobId;
    chrome.runtime.sendMessage({
      action: 'PAUSE_DOWNLOAD_JOB',
      jobId: jId
    });
  }

  public resumeJob(jobId?: string): void {
    const jId = jobId || this.currentJobId;
    chrome.runtime.sendMessage({
      action: 'RESUME_DOWNLOAD_JOB',
      jobId: jId
    });
  }

  public stopJob(jobId?: string): void {
    const jId = jobId || this.currentJobId;
    chrome.runtime.sendMessage({
      action: 'STOP_DOWNLOAD_JOB',
      jobId: jId
    });
  }

  public getCurrentState(): Promise<any> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'GET_CURRENT_JOB_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          resolve(null);
        } else {
          resolve(response.job || null);
        }
      });
    });
  }

  public clearJobState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'CLEAR_JOB_STATE' }, () => {
        resolve();
      });
    });
  }

  public disconnect(): void {
    // Connection is managed in background service worker
  }

  private handleInboundBroadcast(msg: any): void {
    if (!msg || typeof msg !== 'object') return;

    if (msg.action === 'JOB_STARTED' || msg.action === 'JOB_ACCEPTED') {
      this.callbacks.onStateChange?.('running');
      return;
    }

    if (msg.action === 'JOB_START_FAILED' || msg.action === 'JOB_ERROR') {
      this.callbacks.onStateChange?.('error', msg.error || 'Download job encountered an error.');
      return;
    }

    if (msg.action === 'DOWNLOAD_PROGRESS') {
      this.callbacks.onProgress?.(msg as JobProgressEvent);
      return;
    }

    if (msg.action === 'FILE_COMPLETED') {
      this.callbacks.onFileCompleted?.(msg as FileCompletedEvent);
      return;
    }

    if (msg.action === 'FILE_FAILED') {
      this.callbacks.onFileFailed?.(msg as FileFailedEvent);
      return;
    }

    if (msg.action === 'JOB_PAUSED') {
      this.callbacks.onStateChange?.('paused');
      return;
    }

    if (msg.action === 'JOB_RESUMED') {
      this.callbacks.onStateChange?.('running');
      return;
    }

    if (msg.action === 'JOB_STOPPED') {
      this.callbacks.onStateChange?.('stopped');
      return;
    }

    if (msg.action === 'JOB_COMPLETED') {
      this.callbacks.onJobCompleted?.(msg as JobCompletedEvent);
      this.callbacks.onStateChange?.('completed');
      return;
    }
  }
}

export const downloadClient = new NativeDownloadClient();
