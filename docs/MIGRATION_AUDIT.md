# DriveMate Native — Repository Migration Audit

## Executive Summary
This document provides an exhaustive technical audit of the existing DriveMate codebase in preparation for migrating from a Chrome Extension + Native Messaging Helper architecture to a standalone desktop application for Windows and macOS utilizing **Tauri v2**, **Rust**, **React / TypeScript**, **Vite**, and **SQLite**.

---

## 1. Existing Architecture Analysis

### Current High-Level Architecture
```
┌────────────────────────────────────────────────────────┐
│                   Chrome Browser                       │
│  ┌─────────────────────────┐  ┌──────────────────────┐ │
│  │    Popup UI             │  │ Background Service   │ │
│  │ (HTML / popup.ts / CSS) │◄─┤ Worker (Manifest V3) │ │
│  └───────────┬─────────────┘  └──────────┬───────────┘ │
└──────────────┼───────────────────────────┼─────────────┘
               │ PROXY_FETCH               │ Native Messaging
               ▼                           ▼ (4-byte LE length + JSON)
┌─────────────────────────┐     ┌────────────────────────┐
│ Google Drive Public Web │     │ Native Download Helper │
│ (embeddedfolderview /   │     │ • macOS: Swift binary  │
│  usercontent / range)   │     │ • Win: Python/Batch    │
└─────────────────────────┘     └────────────────────────┘
```

### Key Subsystems Inspected:
1. **Manifest V3 Specification (`extension/manifest.json`)**:
   - Declares permissions: `nativeMessaging`, `storage`, `unlimitedStorage`, `alarms`, `activeTab`.
   - Host permissions: `https://drive.google.com/*`, `https://*.googleusercontent.com/*`, `https://docs.google.com/*`, `https://accounts.google.com/*`.
   - Native host connection target: `com.drivemate.helper`.

2. **Public Link Metadata Scanner (`extension/src/services/publicDriveScanner.ts`)**:
   - Zero-authentication scraper leveraging Google Drive's unauthenticated `/embeddedfolderview?id={folderId}` HTML endpoint.
   - Extracts folder titles, nested entries (`href` patterns for `/folders/{id}` and `/file/d/{id}`), and pagination tokens (`pageToken`, `start`).
   - Implements `EmbeddedFolderViewAdapter` with extensible `FolderEnumerationAdapter` interface.
   - Employs unauthenticated `HEAD` probes to discover exact file sizes, MIME types, and filenames where possible.
   - Categorizes items into `SUPPORTED`, `SKIPPED_WORKSPACE` (Docs/Sheets/Slides requiring auth export), `SKIPPED_SHORTCUT_CYCLE`, `SKIPPED_PERMISSION_DENIED`, or `ERROR`.
   - Emits explicit `CompletenessStatus`: `COMPLETE`, `INCOMPLETE_LISTING`, `INCOMPLETE_PERMISSION_DENIED`, `INCOMPLETE_NETWORK_ERROR`, or `CANCELLED`.

3. **Background Service Worker & State Coordinator (`extension/src/background.ts`)**:
   - Serves as the central job coordinator for Manifest V3 lifecycle.
   - Manages stdio connection to `com.drivemate.helper` via `chrome.runtime.connectNative`.
   - Reconciles file progress counters mathematically from the `activeFiles` map.
   - Implements keepalive alarm (`drivemate_keepalive` every 0.25 min) to prevent service worker termination.
   - Persists `activeJobState` to `chrome.storage.local` with debounced flushing (500ms).
   - Chunks initial job payloads to native helper (`BATCH_SIZE = 5000`) and dispatches remaining via `APPEND_FILES` messages to prevent 1MB Native Messaging buffer overflow.

4. **Native Helper Engines**:
   - **macOS Swift Host (`native-helper/Sources/DriveMateHelper/DownloadEngine.swift`)**:
     - Manages multi-threaded downloads (default 16, max 32 streams) via Grand Central Dispatch.
     - Implements adaptive anti-abuse rate-limit circuit breaker:
       * On HTTP 429/403/503: Multiplicative step-down of concurrency (minimum 4), 2.5s cooldown delay, and silent tail re-queueing (up to 5 passes) before permanent failure.
       * On smooth transfers: Additive recovery step-up of concurrency after 6 consecutive successes.
       * Pacing delay: 150ms gentle offset between concurrent stream starts.
     - Directly streams to disk using `.part` temporary files with `Range: bytes={start}-` support.
     - On `206 Partial Content`: appends to partial file.
     - On `200 OK` when Range requested: restarts safely instead of appending corrupted full body.
     - Reconciles and writes to an on-disk manifest (`CompletionManifest.plist`).
     - Structural file integrity validation (`FileFormatValidator.swift`): parses container headers for ISO Base Media (MP4/MOV `ftyp`/`moov`/`mdat`), JPEG SOI/EOI, PNG magic/IEND, ZIP End-of-Central-Directory, XML, and JSON.
   - **Windows Host (`scripts/drivemate_helper_windows.py`)**:
     - Standard Python 3 implementation with Chrome Native Messaging stdio framing.
     - `ThreadPoolExecutor` (16 workers), `Range: bytes={existing}-`, virus bypass token extraction (`confirm=...`).

5. **Licensing & Device Lock Engine (`extension/src/services/licenseService.ts` / `scripts/generate_license.py`)**:
   - Offline zero-server cryptographic verification:
     * Format: `DM-PRO-XXXX-XXXX-YYYY-YYYY` (8 hex payload + 8 hex SHA-256 signature salted with `DriveMate-Pro-2026-SuperSecretMasterSalt-9941`).
     * Developer bypass VIP keys: `DMPROLIFETIMEVIP`, `DRIVEMATEPRO2026`.
   - Central device binding & anti-sharing lock:
     * Syncs with Google Apps Script Web App ledger.
     * Enforces hardware binding (`stored.deviceId === currentDeviceId`), rejecting cross-machine profile cloning.
   - Daily quota enforcement: 10 GB limit for Free tier; unlimited for Lifetime Pro.

---

## 2. Existing Features and Their Entry Points

| Feature | Entry Point / File | Implementation Details |
|---|---|---|
| **Public Link Parsing** | `PublicDriveScanner.parseTarget()` | Regex parsing of folder IDs, file IDs, `open?id=`, and Google Doc links. |
| **Recursive Public Folder Scan** | `PublicDriveScanner.scan()` | HTML scraping of `/embeddedfolderview`, pagination following, depth traversal. |
| **Download Initiation** | `popup.ts:btnStartDownload.click()` | Dispatches `START_DOWNLOAD_JOB` to background service worker. |
| **Download Execution & Concurrency** | `DownloadEngine.swift:startJob()` / `drivemate_helper_windows.py` | Native thread pool (16-32 workers), 150ms pacing, chunked Range streaming. |
| **Rate Limit / Abuse Mitigation** | `DownloadEngine.swift:handleWorkerCompletion()` | Circuit breaker, multiplicative step-down, 2.5s cooldown, 5-pass tail re-queue. |
| **Resume & Range Handling** | `DownloadWorker.swift` / `drivemate_helper_windows.py` | Range header validation, `.part` appending on 206, safe restart on 200, atomic rename. |
| **File Verification** | `FileFormatValidator.swift` / MD5 hashing | Container validation (MP4/JPEG/PNG/ZIP/XML/JSON) and MD5 checksum comparison. |
| **Hardware Binding & Licensing** | `LicenseService.ts` / `generate_license.py` | Salted SHA-256 HMAC offline verification + device ID binding. |
| **Popup UI & Progress Tracking** | `popup.ts` / `popup.html` | Tab switching, tree rendering, speed meter, ETA, active workers, file list. |
| **Host Diagnostic Check** | `background.ts:TEST_NATIVE_CONNECTION` | Stdio ping probe measuring round-trip latency and handshake verification. |

---

## 3. Component Reusability Matrix

### A. Reusable Without Architectural Change (Frontend / Logic)
- **Domain Models & Interfaces (`extension/src/types/drive.ts`)**:
  - `DriveApiFile`, `ScanNode`, `ScanResult`, `DownloadFileItem`, `FileDownloadStatus`, `JobProgressEvent`, `LicenseState`.
  - Can be migrated directly to React TypeScript models.
- **Cryptographic License Verification Algorithm (`scripts/generate_license.py` / `LicenseService.ts`)**:
  - The salted SHA-256 algorithm (`MASTER_SALT`) is portable directly to Rust (`sha2` crate) and TypeScript.
- **Public URL Parsing Regexes (`publicDriveScanner.ts:parseTarget`)**:
  - Exact regex rules for folder IDs, file IDs, docs, and open links.
- **Format Validation Signatures (`FileFormatValidator.swift`)**:
  - ISO BMFF (`ftyp`/`moov`/`mdat`), JPEG SOI/EOI, PNG magic/IEND, ZIP EOCD can be transcribed directly to a pure Rust verification module.

### B. Components Requiring Adaptation
- **Public Folder Scanner (`publicDriveScanner.ts`)**:
  - Currently runs in browser JS with fetch / background proxy.
  - Can either run in frontend TypeScript (via Tauri HTTP plugin) or preferably in native Rust (`reqwest` + `scraper` / regex) for maximum speed, zero CORS restrictions, and direct streaming memory management.
- **UI Components (`popup.ts`, `popup.html`, `popup.css`)**:
  - Currently written in vanilla DOM manipulation.
  - Needs porting to modern React / Vite components with clean hooks (`useDownloadJob`, `useDriveScanner`, `useLicense`).

### C. Components That Genuinely Need Replacement
- **Native Messaging Stdio Layer (`background.ts` ↔ Swift/Python Host)**:
  - Completely replaced by **Tauri v2 IPC (`invoke()` / `emit()`)**. Direct function calls replace JSON-over-stdio pipes.
- **Chrome Storage (`chrome.storage.local`) & Memory Keepalives**:
  - Replaced by a persistent **SQLite Database** (`rusqlite` or `sqlx`) storing jobs, files, settings, and recovery logs.
- **Manifest V3 Service Worker Lifecycle**:
  - Replaced by long-running **Rust native Tokio background tasks**; no service worker suspensions, no artificial alarms needed.

---

## 4. Existing Test Results Summary

Audited existing automated test suites:
1. `tests/test_license_and_quota.py`: **100% PASSED** (Crypto validation, VIP keys, daily limit boundaries).
2. `tests/test_device_binding.py`: **100% PASSED** (Hardware lock, device limit enforcement, leak blocking).
3. `tests/test_safe_existing_recovery.py`: Verified 476-item synthetic job, skip-existing logic, incomplete file replacement, format validation.
4. `tests/test_anti_abuse_rate_limit.py`: Verified circuit breaker, rate limit backoff, and tail re-queueing.
5. `tests/audit_resume_and_integrity.py`: Verified Google Drive HTTP Range resumption from partial `.part` files.

---

## 5. Migration Risk Assessment

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Google Drive HTML Endpoint Changes** | High | Low/Medium | Abstract HTML parsing behind an adapter trait in Rust; validate complete closing tags before declaring complete scan. |
| **Cross-Platform Filesystem Differences** | High | High | Enforce strict sanitization of path traversal (`..`, `\`, `/`, Windows reserved characters `:*?"<>|`); use atomic rename (`tempfile` + rename). |
| **Large Folder Listing Memory Footprint** | Medium | Medium | Stream scan results directly into SQLite database; do not keep 100,000 files in React memory state. Use virtualized list in UI. |
| **Network Throttling / Rate Limits** | High | High | Port the proven adaptive circuit breaker from `DownloadEngine.swift` into the Rust download scheduler (concurrency step-down, 2.5s cooldown, tail re-queue). |
| **macOS Code Signing & Gatekeeper** | High | Medium | Configure proper Info.plist, bundle identifier, entitlements, and build release `.app` and `.dmg`. |

---

## 6. Staged Implementation Plan (Phases 1 to 11)

- **Phase 1: Repository Audit & Feature Inventory** *(Completed in this document)*.
- **Phase 2: Architecture & Migration Design**:
  - Define Tauri v2 IPC command schemas, SQLite database schema, Rust module boundaries, and React component tree.
- **Phase 3: Tauri Desktop Shell & Foundation**:
  - Initialize Tauri v2 + React + Vite + TypeScript project structure.
  - Setup SQLite database with migrations.
- **Phase 4: Public Link Parser & Scanner in Rust/TypeScript**:
  - Port URL parser, folder crawler, pagination follower, and completeness status reporter.
- **Phase 5: Streaming Download Engine in Rust**:
  - Implement async streaming downloader with `reqwest`, `tokio`, Range 206 support, virus warning bypass token resolution, and `.part` handling.
- **Phase 6: Queue Scheduler, Persistence & Crash Recovery**:
  - Port adaptive circuit breaker, bounded concurrency (16-32), tail re-queuing, and SQLite state persistence.
- **Phase 7: Desktop UI & Dashboard**:
  - Build React workspace: Dashboard, New Download, Active Downloads, Completed, History, Settings, Diagnostics.
- **Phase 8: File Integrity Verification & Diagnostics**:
  - Port container validation (MP4/PNG/JPEG/ZIP/XML/JSON), checksum verification, and network diagnostics.
- **Phase 9: Comprehensive Regression & Stress Testing**:
  - Run synthetic tests for resume, 476-item recovery, corrupted file replacement, and rate-limit backoff.
- **Phase 10: Multi-Platform Release Builds**:
  - Build Windows x64 installer (`.exe`/`.msi`) and macOS Apple Silicon ARM64 bundle (`.app`/`.dmg`).
- **Phase 11: Release Documentation & Verification**:
  - Final audit, installation manuals, release notes, and acceptance checklist sign-off.

---

## 7. Tiered Licensing Architecture (6-Month vs 1-Year Multi-Device)

DriveMate implements an automated, anti-piracy licensing ledger powered by Google Apps Script, Google Sheets, Rust native licensing core, and Chrome Extension:

### 1. Tier Specifications
| Plan Tier | Price | Duration | Allowed Devices | Key Prefix | Features |
|---|---|---|---|---|---|
| **6-Month Pro** | ₹100 | 180 Days (6 Months) | **1 Device** | `DM-6M-` | Personal single-device license with unlimited high-speed downloads |
| **1-Year Team Pro** | ₹500 | 365 Days (1 Year) | **Up to 5 Devices** | `DM-1Y-` | Shared license key valid on up to 5 Mac/Windows computers simultaneously |
| **VIP Developer** | Free | 3,650 Days (10 Years) | 10 Devices | `DMPROLIFETIMEVIP` | Internal developer test bypass key |
| **Free Tier** | Free | Lifetime | 1 Device | None | 10 GB/day download limit; quota enforced before streaming |

### 2. Anti-Piracy & Expiration Enforcement
1. **Cryptographic Integrity**:
   - Keys are generated with 8-character hex payloads and 8-character SHA-256 signatures salted with `MASTER_SALT`.
   - Keys are cryptographically verified both offline and online across Rust, TypeScript, and Google Apps Script.
2. **Device Slot Lock**:
   - Each computer computes a unique, non-spoofable hardware ID (`DM-MAC-{UUID}` on macOS via `IOPlatformExpertDevice`, `DM-WIN-{UUID}` on Windows via `wmic csproduct`).
   - The central ledger tracks active device slots in the `Activations` sheet.
   - For 6-Month plans, attempts to activate on a 2nd computer are blocked (`DEVICE_LIMIT_EXCEEDED`).
   - For 1-Year plans, up to 5 distinct computers can register under the single key. Attempting a 6th computer is blocked.
3. **Automated Expiry**:
   - Activation dates and calculated expiry dates (`now + 180 days` or `now + 365 days`) are recorded atomically.
   - On expiration, the central ledger demotes the key status to `EXPIRED` and clients revert to the Free tier (10 GB daily quota).

