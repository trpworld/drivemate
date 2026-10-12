// DriveMate Phase 3 — Typed Data Models (Scanning & Download Engine)

export interface DriveApiFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  capabilities?: {
    canDownload?: boolean;
  };
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
  trashed?: boolean;
}

export interface DriveApiListResponse {
  nextPageToken?: string;
  files?: DriveApiFile[];
  incompleteSearch?: boolean;
}

export type ScanItemStatus =
  | 'SUPPORTED'
  | 'SKIPPED_WORKSPACE'
  | 'SKIPPED_SHORTCUT_CYCLE'
  | 'SKIPPED_PERMISSION_DENIED'
  | 'UNSUPPORTED_TYPE'
  | 'ERROR';

export interface ScanNode {
  id: string;
  name: string;
  type: 'folder' | 'file' | 'shortcut' | 'unsupported';
  mimeType: string;
  sizeBytes?: number;
  md5Checksum?: string;
  modifiedTime?: string;
  canDownload: boolean;
  status: ScanItemStatus;
  skipReason?: string;
  children?: ScanNode[];
  relativePath: string;
}

export interface ScanError {
  folderId?: string;
  fileId?: string;
  itemName?: string;
  message: string;
  errorCode?: string;
  retryable?: boolean;
}

export type CompletenessStatus =
  | 'COMPLETE'
  | 'INCOMPLETE_LISTING'
  | 'INCOMPLETE_PERMISSION_DENIED'
  | 'INCOMPLETE_NETWORK_ERROR'
  | 'CANCELLED';

export interface ScanResult {
  scanId: string;
  rootFolderId: string;
  rootFolderName: string;
  startedAt: string;
  completedAt: string;
  isComplete: boolean;
  completenessStatus?: CompletenessStatus;
  completenessReason?: string;
  stats: {
    totalFoldersCount: number;
    supportedFilesCount: number;
    supportedFilesSizeBytes: number;
    skippedFilesCount: number;
    errorsCount: number;
  };
  errors: ScanError[];
  rootNode: ScanNode;
}

// MARK: - Phase 3 Download Engine Models

export interface DownloadFileItem {
  id: string;
  name: string;
  relativePath: string;
  expectedSize?: number;
  md5Checksum?: string;
  mimeType?: string;
}

export interface DownloadJobRequest {
  jobId: string;
  destinationPath: string;
  concurrency: number;
  skipExisting?: boolean;
  files: DownloadFileItem[];
}

export type FileDownloadStatus =
  | 'QUEUED'
  | 'DOWNLOADING'
  | 'PAUSED'
  | 'VERIFIED'
  | 'FAILED'
  | 'SKIPPED';

export interface FileProgressState {
  fileId: string;
  name: string;
  relativePath: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: FileDownloadStatus;
  error?: string;
}

export interface JobProgressEvent {
  action: 'DOWNLOAD_PROGRESS';
  jobId: string;
  fileId?: string;
  bytesDownloaded?: number;
  bytesWritten?: number;
  totalBytes?: number;
  overallBytes: number;
  overallTotalBytes: number;
  speedBps: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  totalFiles?: number;
}

export interface FileCompletedEvent {
  action: 'FILE_COMPLETED';
  jobId: string;
  fileId: string;
  name: string;
  relativePath: string;
  bytesWritten?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  md5Checksum?: string;
  verified: boolean;
}

export interface FileFailedEvent {
  action: 'FILE_FAILED';
  jobId: string;
  fileId: string;
  error: string;
}

export interface JobCompletedEvent {
  action: 'JOB_COMPLETED';
  jobId: string;
  stats: {
    totalFiles: number;
    completedFiles: number;
    failedFiles: number;
    totalBytes: number;
  };
}

// MARK: - License & Daily Quota Types

export interface LicenseState {
  isPro: boolean;
  licenseKey?: string;
  activatedAt?: string;
  planName?: string;
  deviceId?: string;
}

export interface DailyQuotaState {
  date: string; // YYYY-MM-DD
  bytesDownloadedToday: number;
}

