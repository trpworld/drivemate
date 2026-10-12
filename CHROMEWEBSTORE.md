# Chrome Web Store Listing — DriveMate

> Last Updated: 2026-10-12
> Version: 0.3.0
> Extension ID (Fixed Key): `nhnlodcpjfepoegoemhhmhckmjgalnha`

---

## Store Listing Metadata

**Extension Name** [REQUIRED]
DriveMate — High-Speed Public Drive Downloader

**Short Description** [REQUIRED]
<!-- Max 132 characters. Shown in search results and category tiles. -->
Scan public Google Drive folders, count footages and photos, and download files at maximum speed with zero login required.

**Detailed Description** [REQUIRED]
<!-- Max 16,000 characters. Structured for maximum user clarity and review approval. -->
DriveMate is a high-performance productivity tool designed to inspect, count, and download files from public Google Drive links at maximum speed — without requiring any Google account login or OAuth credentials.

Whether you are downloading raw wedding footages, photography albums, video assets, client deliveries, or public datasets, DriveMate makes the process fast, effortless, and organized.

KEY FEATURES

• Zero Google Login Required
Download directly from any public "Anyone with the link" Google Drive folder without entering your Google credentials or granting third-party account permissions.

• Instant Folder Pre-Scan & Media Breakdown
As soon as you paste a folder link, DriveMate inspects the directory structure and counts all files by category:
- Footages & Videos (MP4, MOV, MKV, AVI, ProRes)
- Photos & RAW Images (JPG, PNG, CR3, ARW, DNG, HEIC)
- Audio Tracks (WAV, MP3, AAC)
- Documents & Archives (PDF, ZIP)

• Pre-Download File Inspector
Preview the complete list of files and subfolder hierarchy before you start downloading, so you always know what you are receiving.

• Turbo Multi-Stream Speed Boost
Maximize your line saturation using up to 16 to 32 parallel download streams via the local companion helper engine for blazing-fast gigabit transfers.

• Resume & Duplicate Skipping
Avoid wasting time or bandwidth re-downloading files you already have. DriveMate automatically detects existing files and verifies checksums.

• Direct Local Folder Downloads
Preserves exact nested folder structures directly on your local storage drive without dealing with zip extractions or browser memory crashes.

HOW TO USE

1. Copy any public Google Drive folder link ("Anyone with the link" viewer access).
2. Open DriveMate and paste the link into the URL field.
3. DriveMate immediately scans the folder and presents a clear count of all videos, photos, and files.
4. Select your local destination folder and stream count.
5. Click "START DOWNLOAD" to initiate high-speed downloading.

PRIVACY & SAFETY

DriveMate values your security. All scanning is read-only and unauthenticated. No personal information, passwords, Google account data, or browsing histories are ever collected, tracked, or transmitted off your machine. Downloaded files are saved strictly to your local storage drive.

COMPANION HELPER NOTE

DriveMate utilizes an optional local native companion helper (DriveMateHelper) to bypass browser memory constraints and enable multi-stream disk writing. The helper is open-source, lightweight, and operates strictly over standard stdio communication.

SUPPORT & FEEDBACK

For questions, feature requests, or troubleshooting assistance:
Email: support@drivemate.app
GitHub: https://github.com/gobindabiswas/drivemate

---

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Scans public Google Drive links to categorize media files and downloads them at high speed without requiring Google account authentication.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
| :--- | :--- | :--- | :--- |
| Store Icon [REQUIRED] | 128 × 128 PNG | ✅ Ready | `extension/icons/icon-128.png` |
| Master Icon [RECOMMENDED] | 512 × 512 PNG | ✅ Ready | `extension/icons/icon-512.png` |
| Screenshot 1 [REQUIRED] | 1280 × 800 PNG | 🟡 To Capture | `screenshots/01_pre_download_scan_breakdown.png` |
| Screenshot 2 [RECOMMENDED] | 1280 × 800 PNG | 🟡 To Capture | `screenshots/02_active_turbo_download_progress.png` |
| Screenshot 3 [RECOMMENDED] | 1280 × 800 PNG | 🟡 To Capture | `screenshots/03_completion_and_file_verification.png` |
| Small Promo Tile [RECOMMENDED] | 440 × 280 PNG | 🟡 Optional | `promo/small_promo_tile.png` |
| Marquee Promo Tile | 1400 × 560 PNG | 🟡 Optional | `promo/marquee_promo_tile.png` |

---

## Permissions Justification

| Permission | Type | User-Facing Justification |
| :--- | :--- | :--- |
| `nativeMessaging` | permissions | Communicates with the local DriveMate macOS companion helper over stdio to enable high-speed multi-threaded disk writing and large file downloads. |
| `activeTab` | permissions | Detects active public Google Drive folder links in the user's currently focused tab when the user clicks the extension. |
| `storage` | permissions | Stores user preferences (such as preferred local download folder path, concurrency level, and skip duplicates setting) and saves persistent job states across popup closures. |
| `unlimitedStorage` | permissions | Ensures cached directory metadata for large public Drive folders containing thousands of files can be retained in local extension storage without quota exhaustion. |
| `alarms` | permissions | Periodically checks active background download progress and prevents service worker idle termination during long-running batch download jobs. |
| `https://drive.google.com/*` | host_permissions | Fetches unauthenticated directory structure HTML for public Google Drive folders shared with "Anyone with the link". |
| `https://*.googleusercontent.com/*` | host_permissions | Probes file size headers and initiates unauthenticated direct downloads for public Google Drive files. |
| `https://docs.google.com/*` | host_permissions | Identifies Google Workspace documents within public folders to properly categorize and notify the user. |
| `https://accounts.google.com/*` | host_permissions | Detects whether a shared link redirects to a login gate, informing the user if a folder is private rather than publicly accessible. |

---

## Privacy & Data Use Disclosure

**Does the extension collect user data?** No

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with 3rd Parties? |
| :--- | :--- | :--- | :--- | :--- |
| Personally identifiable info | No | No | N/A | No |
| Authentication / Passwords | No | No | Zero login required | No |
| Financial info | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history / Activity | No | No | Scans only explicit user-pasted Drive links | No |
| Website content | No | No | Local downloading only | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy URL

**Live URL**: `https://gobindabiswas.github.io/drivemate/privacy` (or hosted GitHub Gist / Notion page)
**Reference Document**: [PRIVACY.md](file:///Volumes/SSD/ASSETS/GOOGLE%20DRIVE%20DOWNLOD%20/PRIVACY.md)

---

## Distribution Settings

- **Visibility**: Public
- **Regions**: All regions
- **Maturity**: All ages

---

## Version History

| Version | Date | Summary of Changes | Status |
| :--- | :--- | :--- | :--- |
| `0.3.0` | 2026-10-12 | Initial public release candidate: pre-download media classification (Footages, Photos, Audio, Docs), instant count on link paste, multi-stream turbo download engine, and official 3D neon branding. | Draft / Ready for Submission |
