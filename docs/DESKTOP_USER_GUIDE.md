# DriveMate Native — Desktop User & Installation Guide

## Overview
**DriveMate Native** is a professional standalone desktop application for **macOS** and **Windows** designed to download files and folders shared via publicly accessible Google Drive links ("Anyone on the internet with the link can view").

---

## Key Features

- **Zero Google Account Required**: Operates completely unauthenticated. No OAuth prompts, no Google login, no cookies required.
- **Direct-to-Disk Multi-Streaming**: Streams response chunks directly to disk using temporary `.part` files, eliminating RAM bloat and bypassing Google Drive's slow ZIP archive generation.
- **Adaptive Rate-Limit Circuit Breaker**: Automatically detects Google HTTP 429/503 rate-limiting responses, steps down worker concurrency, imposes a 2.5s cooldown, and silently re-queues throttled items up to 5 passes.
- **Resumption & Crash Recovery**: Re-attempts interrupted transfers using HTTP Range `206 Partial Content` requests. Safe fallback restarts downloads cleanly if servers return `200 OK` rather than appending corrupted bodies.
- **File Integrity Verification**: Container format validation checks ISO Base Media (MP4/MOV `ftyp`/`moov`/`mdat`), JPEG (SOI/EOI), PNG (IEND), and ZIP (EOCD) structures to guarantee that files are never falsely labeled complete.

---

## Quick Start Guide

### macOS
1. Double-click `Launch-DriveMate-Mac.command` or launch `DriveMate.app`.
2. Paste a public Google Drive folder or file link into the URL input bar.
3. Click **Scan Link**.
4. Review the discovered directory tree and select items to download.
5. Choose your target destination folder (e.g. `~/Downloads`).
6. Click **Start Download**.
7. Monitor live transfer metrics (speed in MB/s, progress bar, active workers, bytes downloaded).

### Windows
1. Double-click `DriveMate.exe` or run `DriveMate-Launcher.bat`.
2. Enter your public Google Drive URL.
3. Click **Scan**.
4. Select files and destination directory.
5. Begin download.

---

## Navigating the Application

1. **Dashboard**: High-level system health overview, total volume downloaded, and quick-start link scanner.
2. **New Download**: Search bar, recursive folder enumeration view, select all/none controls, destination picker.
3. **Active Downloads**: Live download dashboard with instantaneous speed meter, progress bar, active worker indicators, pause, resume, and cancel buttons.
4. **Completed**: Manifest of verified downloaded files with one-click "Reveal in Finder / Explorer".
5. **Download History**: Searchable SQLite database log of all past jobs with status, date, and metrics.
6. **Settings**: Concurrency controller (1 to 32 workers), theme selector (Dark / Light), skip existing files toggle, and license key activation.
7. **Diagnostics**: Live network latency probe to Google Drive edge servers, disk capacity check, and SQLite database health monitor.

---

## Licensing & Offline Activation

DriveMate includes an offline cryptographic license verification engine that works with zero external server dependencies:
- **Free Edition**: Up to 10 GB downloaded per day.
- **Lifetime PRO**: Unlimited volume, up to 32 concurrent streams.
- **VIP Developer Bypass Keys**:
  * `DMPROLIFETIMEVIP`
  * `DRIVEMATEPRO2026`

To activate, navigate to **Settings**, paste your key into the **License Activation** input, and click **Activate Pro**.
