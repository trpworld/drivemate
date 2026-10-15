export interface ScanFileItem {
  id: string;
  name: string;
  relative_path: string;
  size_bytes: number;
  mime_type: string;
}

export type CompletenessStatus =
  | 'Complete'
  | 'IncompleteListing'
  | 'IncompletePermissionDenied'
  | 'IncompleteNetworkError'
  | 'Cancelled';

export interface ScanResult {
  root_folder_id: string;
  root_folder_name: string;
  completeness_status: CompletenessStatus;
  completeness_reason?: string;
  total_folders_count: number;
  total_files_count: number;
  files: ScanFileItem[];
}

export interface ScanProgress {
  folders_scanned: number;
  files_found: number;
  current_path: string;
}

export interface DownloadItem {
  id: string;
  name: string;
  relative_path: string;
  expected_size?: number;
  md5_checksum?: string;
}

export interface JobProgressEvent {
  job_id: string;
  overall_bytes: number;
  overall_total_bytes: number;
  speed_bps: number;
  active_count: number;
  completed_count: number;
  failed_count: number;
  skipped_count: number;
  total_files: number;
  status: string;
}

export interface FileEvent {
  job_id: string;
  file_id: string;
  name: string;
  relative_path: string;
  bytes: number;
  status: string;
  verification: string;
  error?: string;
}

export interface DbJob {
  id: string;
  source_url: string;
  root_folder_name: string;
  destination_path: string;
  concurrency: number;
  skip_existing: boolean;
  status: string;
  total_files: number;
  completed_files: number;
  failed_files: number;
  skipped_files: number;
  total_bytes: number;
  downloaded_bytes: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

export interface DbJobFile {
  id: string;
  job_id: string;
  name: string;
  relative_path: string;
  expected_size: number;
  downloaded_bytes: number;
  md5_checksum?: string;
  mime_type: string;
  status: string;
  verification_status: string;
  format_name?: string;
  error_message?: string;
  retry_count: number;
}

export interface LicenseState {
  is_pro: boolean;
  license_key?: string;
  plan_name: string;
  device_id: string;
  max_devices?: number;
  devices_used?: number;
  expiry_date?: string | null;
  days_remaining?: number | null;
  daily_quota_bytes: number;
  bytes_downloaded_today: number;
}

export interface DiagnosticsReport {
  os_name: string;
  arch: string;
  network_status: string;
  latency_ms: number;
  google_drive_reachable: boolean;
  free_disk_space_bytes: number;
  database_status: string;
}

export interface AppSettings {
  concurrency: number;
  theme: 'dark' | 'light' | 'system';
  skipExisting: boolean;
  defaultDestination: string;
}

export interface AppUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseDate?: string;
  releaseNotes?: string;
  updateUrl: string;
  isDismissed: boolean;
}

