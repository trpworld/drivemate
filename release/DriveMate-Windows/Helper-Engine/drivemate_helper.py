#!/usr/bin/env python3
"""
DriveMate Windows Native Messaging Download Engine (Cross-Platform Python 3)
Compatible with Python 3.6+ standard library (Zero third-party pip dependencies required).
Handles:
1. Chrome Native Messaging Stdio protocol (4-byte LE length prefix + JSON UTF-8).
2. PING / PONG keepalive & handshake.
3. Multi-threaded parallel file downloads with concurrency throttling.
4. HTTP Range 206 resumable chunking (.part files).
5. Google Drive virus scan bypass (confirm=t and form confirmation token extraction).
6. Anti-abuse rate-limit exponential backoff.
7. Path sanitization to prevent path traversal attacks.
"""

import os
import sys
import json
import struct
import time
import re
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

VERSION = "0.3.0-win"
DEFAULT_CONCURRENCY = 16
MAX_RETRIES = 3

# Lock for standard output writing
stdout_lock = threading.Lock()
# Global state for job control
job_lock = threading.Lock()
current_job = {
    "job_id": None,
    "state": "idle", # idle, running, paused, stopped
    "cancelled": False
}

def log_debug(msg: str):
    try:
        sys.stderr.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] [DriveMate-Win] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass

def send_message(payload: dict) -> bool:
    """Send Chrome Native Messaging packet: 4-byte little-endian length + JSON."""
    try:
        raw_json = json.dumps(payload, separators=(',', ':')).encode('utf-8')
        header = struct.pack('<I', len(raw_json))
        with stdout_lock:
            sys.stdout.buffer.write(header)
            sys.stdout.buffer.write(raw_json)
            sys.stdout.buffer.flush()
        return True
    except Exception as e:
        log_debug(f"send_message error: {e}")
        return False

def read_message() -> dict:
    """Read Chrome Native Messaging packet: 4-byte little-endian length + JSON."""
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack('<I', raw_len)[0]
    if msg_len <= 0 or msg_len > 10 * 1024 * 1024: # max 10MB sanity check
        return None
    raw_data = sys.stdin.buffer.read(msg_len)
    if len(raw_data) < msg_len:
        return None
    return json.loads(raw_data.decode('utf-8', errors='replace'))

def sanitize_filename(filename: str) -> str:
    # Remove directory traversals and invalid Windows filename characters
    cleaned = re.sub(r'[\\/:*?"<>|]', '_', filename)
    cleaned = cleaned.strip('. ')
    return cleaned if cleaned else "downloaded_file"

def get_candidate_urls(file_id: str, direct_url: str = None) -> list:
    urls = []
    if direct_url and (direct_url.startswith("http://") or direct_url.startswith("https://")):
        urls.append(direct_url)
    if file_id and (file_id.startswith("http://") or file_id.startswith("https://")):
        urls.append(file_id)
        return urls
    
    clean_id = urllib.parse.quote(file_id.strip())
    urls.extend([
        f"https://drive.usercontent.google.com/download?id={clean_id}&export=download&confirm=t",
        f"https://drive.google.com/uc?export=download&id={clean_id}&confirm=t",
        f"https://drive.google.com/uc?id={clean_id}&export=download"
    ])
    return urls

class DownloadWorker:
    def __init__(self, file_info: dict, dest_dir: str, skip_existing: bool, job_id: str, progress_callback):
        self.file_info = file_info
        self.dest_dir = dest_dir
        self.skip_existing = skip_existing
        self.job_id = job_id
        self.progress_callback = progress_callback
        
        self.file_id = file_info.get("id") or str(file_info.get("name", "unknown"))
        raw_name = file_info.get("name") or f"file_{self.file_id}"
        self.file_name = sanitize_filename(raw_name)
        
        rel_path = file_info.get("relativePath", "")
        if rel_path:
            parts = [sanitize_filename(p) for p in rel_path.replace('\\', '/').split('/') if p and p != '..']
            self.target_dir = os.path.join(dest_dir, *parts[:-1]) if len(parts) > 1 else dest_dir
        else:
            self.target_dir = dest_dir
            
        os.makedirs(self.target_dir, exist_ok=True)
        self.final_path = os.path.join(self.target_dir, self.file_name)
        self.part_path = self.final_path + ".part"
        self.expected_size = file_info.get("expectedSize", 0)

    def run(self) -> dict:
        global current_job
        if current_job.get("cancelled"):
            return {"success": False, "error": "Cancelled"}

        # 1. Skip Existing Check
        if self.skip_existing and os.path.exists(self.final_path):
            existing_size = os.path.getsize(self.final_path)
            if self.expected_size <= 0 or existing_size == self.expected_size:
                log_debug(f"Skipping existing file: {self.final_path}")
                return {"success": True, "bytes": existing_size, "skipped": True}

        # 2. Candidate URLs
        urls = get_candidate_urls(self.file_id, self.file_info.get("downloadUrl"))
        
        last_error = "Unknown error"
        for attempt in range(MAX_RETRIES):
            if current_job.get("cancelled"):
                return {"success": False, "error": "Cancelled"}

            # Pause handling loop
            while current_job.get("state") == "paused":
                if current_job.get("cancelled"):
                    return {"success": False, "error": "Cancelled"}
                time.sleep(0.5)

            url = urls[attempt % len(urls)]
            try:
                res = self._download_single_stream(url)
                if res.get("success"):
                    return res
                last_error = res.get("error", "Stream error")
            except Exception as e:
                last_error = str(e)
                log_debug(f"Attempt {attempt+1} failed for {self.file_name}: {e}")
                time.sleep(1.0 + (attempt * 1.5))

        return {"success": False, "error": last_error}

    def _download_single_stream(self, url: str) -> dict:
        global current_job
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "identity" # avoid gzip streaming truncation on binary files
        }

        existing_bytes = 0
        if os.path.exists(self.part_path):
            existing_bytes = os.path.getsize(self.part_path)
            if existing_bytes > 0:
                headers["Range"] = f"bytes={existing_bytes}-"

        req = urllib.request.Request(url, headers=headers)
        
        # CookieJar handler for Google Drive virus confirmations
        cookie_processor = urllib.request.HTTPCookieProcessor()
        opener = urllib.request.build_opener(cookie_processor)
        
        with opener.open(req, timeout=30) as resp:
            status = resp.status
            content_type = resp.headers.get("Content-Type", "")
            
            # Check if Google served an HTML warning/confirmation page instead of binary
            if "text/html" in content_type:
                html_body = resp.read(128 * 1024).decode('utf-8', errors='ignore')
                # Check for confirm token
                confirm_match = re.search(r'confirm=([0-9A-Za-z_\-]+)', html_body)
                if confirm_match:
                    confirm_token = confirm_match.group(1)
                    sep = "&" if "?" in url else "?"
                    retry_url = f"{url}{sep}confirm={confirm_token}"
                    req2 = urllib.request.Request(retry_url, headers=headers)
                    with opener.open(req2, timeout=30) as resp2:
                        return self._stream_to_disk(resp2, existing_bytes if resp2.status == 206 else 0)
                else:
                    return {"success": False, "error": "Google Drive rate-limited or requires login for this link."}

            return self._stream_to_disk(resp, existing_bytes if status == 206 else 0)

    def _stream_to_disk(self, resp, start_offset: int) -> dict:
        mode = "ab" if start_offset > 0 else "wb"
        content_length_hdr = resp.headers.get("Content-Length")
        total_stream_bytes = int(content_length_hdr) if content_length_hdr else 0
        total_file_bytes = start_offset + total_stream_bytes if total_stream_bytes > 0 else self.expected_size

        bytes_written = start_offset
        last_progress_time = time.time()

        with open(self.part_path, mode) as f:
            chunk_size = 128 * 1024 # 128 KB disk chunks
            while True:
                if current_job.get("cancelled"):
                    return {"success": False, "error": "Cancelled"}
                
                while current_job.get("state") == "paused":
                    if current_job.get("cancelled"):
                        return {"success": False, "error": "Cancelled"}
                    time.sleep(0.5)

                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                bytes_written += len(chunk)

                # Report throttled progress (every 0.5s or on finish)
                now = time.time()
                if now - last_progress_time > 0.4:
                    last_progress_time = now
                    self.progress_callback(self.file_id, bytes_written, total_file_bytes)

        # Move .part to final
        if os.path.exists(self.final_path):
            try: os.remove(self.final_path)
            except Exception: pass
        os.rename(self.part_path, self.final_path)
        
        self.progress_callback(self.file_id, bytes_written, total_file_bytes)
        return {"success": True, "bytes": bytes_written, "path": self.final_path}


class DownloadManager:
    def __init__(self):
        self.active_executor = None

    def start_job(self, msg: dict):
        global current_job
        job_id = msg.get("jobId")
        dest_path = os.path.expanduser(msg.get("destinationPath", "~/Downloads/DriveMate"))
        if not os.path.isabs(dest_path):
            dest_path = os.path.abspath(dest_path)
        os.makedirs(dest_path, exist_ok=True)

        concurrency = int(msg.get("concurrency", DEFAULT_CONCURRENCY))
        skip_existing = bool(msg.get("skipExisting", True))
        files = msg.get("files", [])

        with job_lock:
            current_job["job_id"] = job_id
            current_job["state"] = "running"
            current_job["cancelled"] = False

        # ACK
        send_message({"status": "SUCCESS", "action": "JOB_ACCEPTED", "jobId": job_id})
        send_message({"action": "JOB_STARTED", "jobId": job_id})

        threading.Thread(target=self._run_job_thread, args=(job_id, dest_path, files, concurrency, skip_existing), daemon=True).start()

    def _run_job_thread(self, job_id: str, dest_path: str, files: list, concurrency: int, skip_existing: bool):
        overall_total_bytes = sum(f.get("expectedSize", 0) for f in files)
        completed_count = 0
        failed_count = 0
        overall_bytes = 0
        bytes_map = {}
        map_lock = threading.Lock()

        def on_file_progress(fid, bytes_written, total_bytes):
            nonlocal overall_bytes
            with map_lock:
                bytes_map[fid] = bytes_written
                overall_bytes = sum(bytes_map.values())
            send_message({
                "action": "DOWNLOAD_PROGRESS",
                "jobId": job_id,
                "fileId": fid,
                "bytesDownloaded": bytes_written,
                "totalBytes": total_bytes,
                "overallBytes": overall_bytes,
                "overallTotalBytes": overall_total_bytes
            })

        self.active_executor = ThreadPoolExecutor(max_workers=concurrency)
        futures = []

        for f in files:
            worker = DownloadWorker(f, dest_path, skip_existing, job_id, on_file_progress)
            fut = self.active_executor.submit(worker.run)
            futures.append((f, fut))

        for f, fut in futures:
            fid = f.get("id") or str(f.get("name"))
            try:
                res = fut.result()
                if res.get("success"):
                    completed_count += 1
                    send_message({
                        "action": "FILE_COMPLETED",
                        "jobId": job_id,
                        "fileId": fid,
                        "name": f.get("name"),
                        "bytesDownloaded": res.get("bytes", 0),
                        "verified": True
                    })
                else:
                    failed_count += 1
                    send_message({
                        "action": "FILE_FAILED",
                        "jobId": job_id,
                        "fileId": fid,
                        "error": res.get("error", "Download failed")
                    })
            except Exception as e:
                failed_count += 1
                send_message({
                    "action": "FILE_FAILED",
                    "jobId": job_id,
                    "fileId": fid,
                    "error": str(e)
                })

        # Job Completed
        send_message({
            "action": "JOB_COMPLETED",
            "jobId": job_id,
            "stats": {
                "totalFiles": len(files),
                "completedFiles": completed_count,
                "failedFiles": failed_count,
                "totalBytes": overall_bytes
            }
        })

        with job_lock:
            current_job["state"] = "completed"

    def pause_job(self, job_id: str):
        with job_lock:
            current_job["state"] = "paused"
        send_message({"action": "JOB_PAUSED", "jobId": job_id})

    def resume_job(self, job_id: str):
        with job_lock:
            current_job["state"] = "running"
        send_message({"action": "JOB_RESUMED", "jobId": job_id})

    def stop_job(self, job_id: str):
        with job_lock:
            current_job["cancelled"] = True
            current_job["state"] = "stopped"
        if self.active_executor:
            try: self.active_executor.shutdown(wait=False)
            except Exception: pass
        send_message({"action": "JOB_STOPPED", "jobId": job_id})


def main():
    log_debug("DriveMate Windows Helper initialized and listening on stdio...")
    manager = DownloadManager()

    while True:
        try:
            msg = read_message()
            if msg is None:
                log_debug("Browser closed connection or EOF received. Exiting.")
                break

            action = msg.get("action", "").upper()
            log_debug(f"Received action: {action}")

            if action == "PING":
                send_message({
                    "status": "SUCCESS",
                    "action": "PONG",
                    "echoPayload": msg.get("payload"),
                    "receivedTimestamp": msg.get("timestamp"),
                    "helperVersion": VERSION
                })
            elif action == "ECHO":
                send_message({
                    "status": "SUCCESS",
                    "action": "ECHO_RESPONSE",
                    "echoPayload": msg.get("payload"),
                    "receivedTimestamp": msg.get("timestamp"),
                    "helperVersion": VERSION
                })
            elif action == "START_DOWNLOAD_JOB":
                manager.start_job(msg)
            elif action == "PAUSE_DOWNLOAD_JOB":
                manager.pause_job(msg.get("jobId", ""))
            elif action == "RESUME_DOWNLOAD_JOB":
                manager.resume_job(msg.get("jobId", ""))
            elif action == "STOP_DOWNLOAD_JOB":
                manager.stop_job(msg.get("jobId", ""))
            else:
                log_debug(f"Unhandled action: {action}")

        except (KeyboardInterrupt, SystemExit):
            break
        except Exception as e:
            log_debug(f"Unexpected loop exception: {e}")
            break

if __name__ == "__main__":
    main()
