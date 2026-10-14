# DriveMate Native — Target Architecture and Migration Design (Phase 2)

## Executive Summary
This document specifies the technical architecture for **DriveMate Native**, migrating the Chrome Extension and native helper into a standalone desktop application for **Windows (x64)** and **macOS (Apple Silicon ARM64 & Intel x64)**.

The solution utilizes:
- **Tauri v2** as the native desktop shell and application runtime.
- **Rust** for native system operations, high-performance HTTP streaming, rate-limit circuit breaking, file verification, and SQLite persistence.
- **React 18 / TypeScript / Vite** for the desktop frontend UI with modern design aesthetics, dark/light themes, and real-time event streaming.
- **SQLite 3** for versioned local persistence of jobs, settings, file manifests, and crash recovery.

---

## 1. High-Level Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DriveMate Desktop UI (React / TS / Vite)              │
│  ┌───────────┐ ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Dashboard │ │ New Download │ │ Active Jobs  │ │ Completed/History │  │
│  └─────┬─────┘ └──────┬───────┘ └──────┬───────┘ └────────┬──────────┘  │
│  ┌─────┴──────────────┴────────────────┴──────────────────┴──────────┐  │
│  │        Application State Hooks (useScan, useJob, useSettings)      │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ Tauri v2 IPC (invoke / emit)
┌────────────────────────────────────▼───────────────────────────────────┐
│                      Tauri v2 Rust Core Layer                          │
│  ┌───────────────────────┐ ┌──────────────────────┐ ┌────────────────┐ │
│  │ Tauri Command Router  │ │ Event Bus (emit)     │ │ FS Scoped Safe │ │
│  └───────────┬───────────┘ └──────────┬───────────┘ └───────┬────────┘ │
│              │                        │                     │          │
│  ┌───────────▼────────────────────────▼─────────────────────▼────────┐ │
│  │                       DriveMate Native Core                       │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │ │
│  │  │ Public Parser &  │  │ Async Streaming  │  │ Adaptive Circuit │ │ │
│  │  │ Folder Crawler   │  │ Download Engine  │  │ Breaker & Pacer  │ │ │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │ │
│  │  ┌────────┴─────────┐  ┌────────┴─────────┐  ┌────────┴─────────┐ │ │
│  │  │ Container Format │  │ Crash Recovery & │  │ SQLite Database  │ │ │
│  │  │ File Validator   │  │ Range Resumption │  │ Repository       │ │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Rust Modular System Architecture

The native backend is organized into decoupled, unit-testable modules under `src-tauri/src/core`:

### 2.1 `parser`: Public Link Parser
- **Responsibility**: Parses Google Drive public links, validates URL structures, and rejects unsupported/private/workspace-restricted URLs.
- **Supported Link Formats**:
  - `https://drive.google.com/drive/folders/{id}`
  - `https://drive.google.com/drive/u/0/folders/{id}`
  - `https://drive.google.com/open?id={id}`
  - `https://drive.google.com/file/d/{id}/view`
  - `https://drive.google.com/uc?id={id}`
  - Raw alphanumeric folder/file IDs (`[-_\w]{20,}`)
- **Safety**: Rejects Google Docs/Sheets/Slides links with clear instructions explaining that Google requires authenticated export for Google Workspace document formats.

### 2.2 `scanner`: Public Folder Crawler
- **Responsibility**: Crawls public Google Drive folder structures without authentication.
- **Mechanism**:
  - Hits `https://drive.google.com/embeddedfolderview?id={folderId}`.
  - Extracts folder titles, nested folders (`folders/{id}`), and files (`file/d/{id}`).
  - Follows pagination tokens (`pageToken` or `start`) up to 10,000 pages.
  - Prevents recursion loops via `visited_folder_ids: HashSet<String>`.
  - Enforces HTML termination checks (`</body>` or `</html>`) to detect truncated responses.
- **Completeness Classification**:
  - `COMPLETE`: All pages cleanly closed and verified.
  - `INCOMPLETE_LISTING`: Missing closing tags or broken pagination.
  - `INCOMPLETE_PERMISSION_DENIED`: HTTP 403 or 401 encountered.
  - `INCOMPLETE_NETWORK_ERROR`: Network drop mid-traversal.
  - `CANCELLED`: Aborted by user.

### 2.3 `engine`: Direct-to-Disk Streaming Downloader
- **Responsibility**: Streams HTTP responses directly into `.part` temporary files on disk without loading entire payloads into RAM.
- **Core Capabilities**:
  - Built on `reqwest` with custom connection pooling and redirect policies.
  - **Google Large File Virus Warning Bypass**:
    - Automatically checks response `Content-Type`. If `text/html`, extracts `confirm=([0-9A-Za-z_\-]+)` token and resubmits request with cookie persistence.
  - **HTTP Range 206 Resumption**:
    - Queries `.part` file size on disk.
    - If `existing_bytes > 0`, issues `Range: bytes={existing_bytes}-`.
    - If server replies `206 Partial Content`, safely appends bytes.
    - If server replies `200 OK`, truncates `.part` and restarts safely (preventing file corruption).
    - If server replies `416 Range Not Satisfiable`, checks if file is already complete or restarts.
  - **Atomic Finalization**:
    - On complete byte write, closes file handle and atomically renames `{path}.part` to `{path}`.

### 2.4 `scheduler`: Concurrency & Adaptive Circuit Breaker
- **Responsibility**: Manages worker pool (default 16, maximum 32 streams) with anti-abuse protections.
- **Ported Algorithms from Existing Swift Engine**:
  - **Launch Pacing**: Inserts a 150ms gentle offset between concurrent stream starts to prevent sudden burst traffic spikes.
  - **Adaptive Circuit Breaker**:
    - On HTTP 429 (Too Many Requests), 403 (Rate Limited), or 503:
      * Consecutively throttled: Multiplicatively decreases concurrency (`max(4, current / 2)`).
      * Cooldown: Imposes a 2.5-second cooldown timer before launching subsequent workers.
      * **Tail Re-Queueing**: Silently moves throttled files to the tail of the retry queue for up to 5 passes without marking them failed.
    - On smooth transfers:
      * Additively increases concurrency (`min(configured, current + 1)`) after 6 consecutive successful downloads.

### 2.5 `verifier`: Container Format & File Integrity Validator
- **Responsibility**: Inspects downloaded files on disk to prevent false completion claims.
- **Container Signatures Validated** (Ported from `FileFormatValidator.swift`):
  - **ISO BMFF (`mp4`, `mov`, `m4v`)**: Validates presence of `ftyp`, `moov`, and `mdat` atom boxes.
  - **JPEG (`jpg`, `jpeg`)**: Validates SOI marker (`0xFF 0xD8`) and EOI marker (`0xFF 0xD9`).
  - **PNG (`png`)**: Validates 8-byte PNG header and ending `IEND` chunk.
  - **ZIP (`zip`)**: Validates End of Central Directory (`0x50 0x4B 0x05 0x06`).
  - **JSON (`json`)**: Parses syntax tree for valid root object/array.
  - **XML (`xml`)**: Validates well-formed XML prolog and root tags.
  - **MD5 / Size Verification**: Validates total byte count against expected size when available; checks MD5 checksum when provided by metadata.

### 2.6 `storage`: SQLite Database Repository
- **Responsibility**: Manages all local state, jobs, file manifests, settings, and recovery logs.
- Uses parameterized queries and WAL mode for high concurrency.

### 2.7 `fs`: Path Safety & Scoped Filesystem Service
- **Responsibility**: Validates all file paths before writing to disk.
- **Protections**:
  - Sanitizes forbidden characters across Windows (`: * ? " < > | \ /`) and macOS (`/`).
  - Canonicalizes paths and verifies that all target paths resolve strictly within the user-selected destination root (prevents path traversal `../`).

### 2.8 `licensing`: Cryptographic Anti-Piracy & Device Binding
- **Responsibility**: Fully offline license key verification and device lock.
- **Algorithm**:
  - Matches format: `DM-PRO-XXXX-XXXX-YYYY-YYYY` or `DMPRO...`.
  - Computes `sha256Hex(payload + MASTER_SALT)`.
  - Supports VIP developer keys (`DMPROLIFETIMEVIP`, `DRIVEMATEPRO2026`).
  - Binds to hardware UUID (via `ioreg` on macOS / machine GUID on Windows).

---

## 3. SQLite Database Schema (`V1__initial_schema.sql`)

```sql
-- Application Settings
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Download Jobs
CREATE TABLE IF NOT EXISTS download_jobs (
    id TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    root_folder_name TEXT NOT NULL,
    destination_path TEXT NOT NULL,
    concurrency INTEGER NOT NULL DEFAULT 16,
    skip_existing INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL, -- PENDING, RUNNING, PAUSED, COMPLETED, CANCELLED, FAILED
    total_files INTEGER NOT NULL DEFAULT 0,
    completed_files INTEGER NOT NULL DEFAULT 0,
    failed_files INTEGER NOT NULL DEFAULT 0,
    skipped_files INTEGER NOT NULL DEFAULT 0,
    total_bytes INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON download_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON download_jobs(created_at DESC);

-- Job Files Manifest
CREATE TABLE IF NOT EXISTS job_files (
    id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    expected_size INTEGER DEFAULT 0,
    downloaded_bytes INTEGER DEFAULT 0,
    md5_checksum TEXT,
    mime_type TEXT,
    status TEXT NOT NULL, -- QUEUED, DOWNLOADING, PAUSED, COMPLETED, SKIPPED, FAILED
    verification_status TEXT NOT NULL, -- UNVERIFIED, VERIFIED, CORRUPT, SKIPPED
    format_name TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (job_id, id),
    FOREIGN KEY (job_id) REFERENCES download_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_job_status ON job_files(job_id, status);

-- Diagnostics & Error Logs
CREATE TABLE IF NOT EXISTS diagnostic_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    level TEXT NOT NULL, -- INFO, WARN, ERROR
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Tauri v2 IPC Command & Event Specifications

### 4.1 Commands (Frontend -> Backend via `invoke`)

| Command | Arguments | Return Type | Description |
|---|---|---|---|
| `scan_link` | `{ url: string, enrich: boolean }` | `ScanResult` | Initiates manual crawl of public link. |
| `cancel_scan` | `{ scanId: string }` | `void` | Cancels in-progress crawler. |
| `start_download_job` | `{ request: DownloadJobRequest }` | `string` (jobId) | Starts multi-worker streaming job. |
| `pause_download_job` | `{ jobId: string }` | `void` | Pauses job and checkpoints active files. |
| `resume_download_job` | `{ jobId: string }` | `void` | Resumes paused job from disk state. |
| `stop_download_job` | `{ jobId: string }` | `void` | Cancels job and flushes manifest. |
| `get_job_progress` | `{ jobId: string }` | `JobProgressEvent` | Polls/reads current job metrics. |
| `get_jobs_history` | `void` | `DownloadJob[]` | Retrieves all historical jobs from SQLite. |
| `get_job_files` | `{ jobId: string }` | `JobFile[]` | Retrieves all files for a specific job. |
| `select_destination_folder`| `void` | `string \| null` | Native OS folder picker dialog. |
| `get_settings` | `void` | `AppSettings` | Reads persistent application configuration. |
| `save_settings` | `{ settings: AppSettings }` | `void` | Saves user preferences. |
| `verify_license` | `{ key: string }` | `LicenseState` | Validates license key and binds hardware. |
| `get_license_state` | `void` | `LicenseState` | Returns active license tier and quota. |
| `run_diagnostics` | `void` | `DiagnosticsReport` | Probes system, network, and disk health. |

### 4.2 Events (Backend -> Frontend via `emit`)

| Event Name | Payload | Description |
|---|---|---|
| `scan:progress` | `{ scanId, foldersScanned, filesFound, currentPath }` | Emitted during folder traversal. |
| `job:progress` | `JobProgressEvent` | Emitted every ~300ms with real transfer speeds, active workers, bytes. |
| `file:progress` | `{ jobId, fileId, bytesDownloaded, totalBytes, status }` | Emitted per active file chunk. |
| `file:completed`| `FileCompletedEvent` | Emitted when file finishes and passes verification. |
| `file:failed` | `FileFailedEvent` | Emitted when file fails permanently. |
| `job:completed` | `JobCompletedEvent` | Emitted when all files in job are processed. |

---

## 5. Desktop UI Architecture (React 18 / Vite / CSS)

### 5.1 Primary Navigation Views
1. **Dashboard**: High-level overview of recent activity, transfer stats, license badge, and quick-start action.
2. **New Download**: URL input, Scan button, recursive folder tree view with selection checkboxes, folder destination picker, and Download initiation.
3. **Active Downloads**: Live real-time dashboard displaying active streams, speed meter, ETA, pause/resume/cancel controls, and worker status.
4. **Completed**: Manifest of successfully downloaded and verified files with "Show in Finder / Explorer" actions.
5. **Download History**: Searchable, persistent record of past jobs stored in SQLite.
6. **Settings**: Concurrency controls (1–32), default destination directory, skip-existing toggle, format verification options, theme selection (Dark/Light).
7. **Diagnostics**: System health check, network latency probe to Google Drive endpoints, disk space check, and debug log viewer.

### 5.2 Design Aesthetics
- **Theme**: Premium Dark Mode by default with sleek Obsidian (`#090D16`), Navy Card (`#131B2E`), Border (`#1E293B`), Indigo Accent (`#6366F1`), and Emerald Status (`#10B981`).
- **Typography**: Modern font stack (`Inter`, system UI fallback) with strict typographic hierarchy.
- **Micro-Animations**: Smooth progress bar transitions, animated pulse dots for active streams, and crisp badge indicators.
- **Zero Placeholders**: Fully functioning controls with clear error/empty/loading states.

---

## 6. Security and Compliance Assurance

1. **Zero Google Login / OAuth**: Strictly unauthenticated operations.
2. **Access Control Integrity**: Only downloads resources that are public under Google's permissions ("Anyone with the link"). Private resources yield clear `INACCESSIBLE_HTTP_403` or `INACCESSIBLE_HTTP_404` errors.
3. **No ZIP Archive Fallback**: Always downloads individual files directly to disk preserving the remote directory structure.
4. **Safe Filesystem Access**: All paths verified strictly within the user-selected destination root.
5. **No Telemetry / Hidden Traffic**: No external requests other than the explicit user-directed Google Drive link and optional activation check.
