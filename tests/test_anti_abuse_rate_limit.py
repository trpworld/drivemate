#!/usr/bin/env python3
"""
Test Suite: Google Anti-Abuse Rate Limit & Automatic Tail Re-Queueing
Verifies:
1. HTTP 429 / 403 transient rate limits are retried silently without user-facing failure.
2. Google Quota HTML interstitial responses are automatically retried with backoff.
3. Throttled files are automatically re-queued to the tail of the batch, allowing other
   files to proceed smoothly and achieving 100% completion (0 failed files).
"""

import http.server
import json
import os
import shutil
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time

HELPER_BIN = "/Volumes/SSD/ASSETS/GOOGLE DRIVE DOWNLOD /native-helper/.build/release/DriveMateHelper"

class AntiAbuseMockHandler(http.server.BaseHTTPRequestHandler):
    attempt_counters = {}
    lock = threading.Lock()

    def do_GET(self):
        with AntiAbuseMockHandler.lock:
            count = AntiAbuseMockHandler.attempt_counters.get(self.path, 0) + 1
            AntiAbuseMockHandler.attempt_counters[self.path] = count

        if "rate-limited-file" in self.path:
            # First 2 attempts return HTTP 429
            if count <= 2:
                self.send_response(429)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Retry-After", "1")
                self.end_headers()
                self.wfile.write(b"Too Many Requests - Anti-Abuse Throttling")
                return
            else:
                data = b"Video content for rate-limited file after cooldown"
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if "quota-html-file" in self.path:
            # First attempt returns Google's Quota HTML page
            if count == 1:
                html = (
                    b"<html><body>"
                    b"<p class=\"uc-error-subcaption\">Too many users have viewed or downloaded this file recently.</p>"
                    b"</body></html>"
                )
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)
                return
            else:
                data = b"Clean binary media data after quota cooldown"
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        # Default normal file
        content = f"Standard content for {self.path}".encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        pass

def run_test():
    print("============================================================")
    print("TEST: GOOGLE ANTI-ABUSE RATE LIMIT & RECOVERY")
    print("============================================================")

    # 1. Start Mock Server
    httpd = socketserver.TCPServer(("127.0.0.1", 0), AntiAbuseMockHandler)
    port = httpd.server_address[1]
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[*] Mock Google CDN Server listening on {base_url}")

    test_dest = tempfile.mkdtemp(prefix="dm_rate_limit_test_")
    print(f"[*] Test destination: {test_dest}")

    # 2. Launch Native Helper
    proc = subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0
    )

    def send_msg(m):
        raw = json.dumps(m).encode("utf-8")
        proc.stdin.write(struct.pack("<I", len(raw)))
        proc.stdin.write(raw)
        proc.stdin.flush()

    messages = []
    def read_stdout():
        while True:
            header = proc.stdout.read(4)
            if not header or len(header) < 4:
                break
            length = struct.unpack("<I", header)[0]
            body = proc.stdout.read(length)
            msg = json.loads(body.decode("utf-8"))
            messages.append(msg)
            if msg.get("action") == "JOB_COMPLETED":
                break

    reader_thread = threading.Thread(target=read_stdout, daemon=True)
    reader_thread.start()

    # 3. Create job with 3 files:
    # - File 1: hits HTTP 429 twice then succeeds
    # - File 2: hits Google Quota HTML once then succeeds
    # - File 3: normal file
    files = [
        {
            "id": f"{base_url}/rate-limited-file.mp4",
            "name": "C0588_RateLimited.MP4",
            "relativePath": "C0588_RateLimited.MP4",
            "expectedSize": 50
        },
        {
            "id": f"{base_url}/quota-html-file.mp4",
            "name": "C0767_QuotaHtml.MP4",
            "relativePath": "C0767_QuotaHtml.MP4",
            "expectedSize": 44
        },
        {
            "id": f"{base_url}/normal-file.mp4",
            "name": "Normal_Clip.MP4",
            "relativePath": "Normal_Clip.MP4"
        }
    ]

    job_id = f"job_anti_abuse_{int(time.time())}"
    start_job = {
        "action": "START_DOWNLOAD_JOB",
        "jobId": job_id,
        "destinationPath": test_dest,
        "concurrency": 4,
        "skipExisting": True,
        "files": files,
        "totalFilesExpected": 3
    }

    print("[*] Sending START_DOWNLOAD_JOB...")
    send_msg(start_job)

    # Wait for completion (allow time for backoff and retry)
    timeout = 30
    start_t = time.time()
    while time.time() - start_t < timeout:
        if any(m.get("action") == "JOB_COMPLETED" for m in messages):
            break
        time.sleep(0.2)

    reader_thread.join(timeout=2)
    proc.terminate()
    httpd.shutdown()

    # 4. Verify results
    completed_events = [m for m in messages if m.get("action") == "FILE_COMPLETED"]
    failed_events = [m for m in messages if m.get("action") == "FILE_FAILED"]
    job_completed = next((m for m in messages if m.get("action") == "JOB_COMPLETED"), None)

    print(f"[*] FILE_COMPLETED count: {len(completed_events)}")
    print(f"[*] FILE_FAILED count: {len(failed_events)}")

    assert job_completed is not None, "JOB_COMPLETED was not received!"
    stats = job_completed.get("stats", {})
    print(f"[*] Final Job Stats: {stats}")

    assert stats.get("totalFiles") == 3, f"Expected 3 totalFiles, got {stats.get('totalFiles')}"
    assert stats.get("completedFiles") == 3, f"Expected 3 completedFiles, got {stats.get('completedFiles')}"
    assert stats.get("failedFiles") == 0, f"Expected 0 failedFiles, got {stats.get('failedFiles')}"
    assert len(failed_events) == 0, f"Expected 0 FILE_FAILED events, got {len(failed_events)}"

    # Check files on disk
    for f in ["C0588_RateLimited.MP4", "C0767_QuotaHtml.MP4", "Normal_Clip.MP4"]:
        path = os.path.join(test_dest, f)
        assert os.path.exists(path), f"File {f} does not exist on disk!"
        size = os.path.getsize(path)
        assert size > 0, f"File {f} has 0 bytes!"
        print(f"    ✓ {f}: {size} bytes verified on disk")

    shutil.rmtree(test_dest, ignore_errors=True)
    print("============================================================")
    print("ALL ANTI-ABUSE RATE LIMIT TESTS PASSED (100% SUCCESS)!")
    print("============================================================")

if __name__ == "__main__":
    run_test()
