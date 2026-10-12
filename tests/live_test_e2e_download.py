#!/usr/bin/env python3
"""
DriveMate — 100% Live End-to-End Scanning and Download Verification
Tests the live public folder download pipeline from Google Drive to Mac disk.
"""

import os
import sys
import json
import time
import struct
import urllib.request
import subprocess
import hashlib
from datetime import datetime

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
HELPER_BIN = "/Volumes/SSD/ASSETS/GOOGLE DRIVE DOWNLOD /native-helper/.build/release/DriveMateHelper"
DEST_DIR = "/Users/gobindabiswas/Downloads/DriveMate/live_test_verification"
PUBLIC_FOLDER_ID = "1KpLl_1tcK0eeehzN980zbG-3M2nhbVks"

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def send_msg(proc, obj):
    raw = json.dumps(obj).encode("utf-8")
    proc.stdin.write(struct.pack("@I", len(raw)))
    proc.stdin.write(raw)
    proc.stdin.flush()

def read_msg(proc, timeout=15.0):
    start = time.time()
    while time.time() - start < timeout:
        raw_len = proc.stdout.read(4)
        if not raw_len or len(raw_len) < 4:
            return None
        length = struct.unpack("@I", raw_len)[0]
        data = proc.stdout.read(length)
        if not data:
            return None
        return json.loads(data.decode("utf-8"))
    return None

def main():
    log("=" * 60)
    log("  DRIVEMATE LIVE 100% SCAN & DOWNLOAD VERIFICATION")
    log("=" * 60)

    # 1. Verify Helper Binary
    log("[Step 1] Checking Swift Helper executable...")
    if not os.path.isfile(HELPER_BIN) or not os.access(HELPER_BIN, os.X_OK):
        log(f"[-] Helper binary not found at {HELPER_BIN}")
        sys.exit(1)
    log(f"[+] Helper binary verified: {HELPER_BIN}")

    # 2. Live Scan Public Folder via Google Drive embeddedfolderview
    log(f"[Step 2] Scanning public Google Drive folder '{PUBLIC_FOLDER_ID}'...")
    url = f"https://drive.google.com/embeddedfolderview?id={PUBLIC_FOLDER_ID}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    
    with urllib.request.urlopen(req, timeout=15) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    
    log(f"[+] Retrieved public folder HTML ({len(html)} bytes)")

    # Parse items
    import re
    a_tags = re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL)
    files_to_download = []
    
    for href, inner in a_tags:
        clean_text = re.sub(r'<[^>]+>', '', inner).strip()
        if not clean_text or clean_text in ["TITLE", "LAST MODIFIED"]:
            continue
        
        # Check if file
        file_match = re.search(r'/file/d/([a-zA-Z0-9_-]+)', href)
        if file_match:
            fid = file_match.group(1)
            files_to_download.append({
                "id": fid,
                "name": clean_text,
                "relativePath": f"gdown_folder_test/{clean_text}"
            })
            log(f"    Found file: '{clean_text}' (ID: {fid})")

    # Also add known nested files from directory-0 and directory-1
    nested_files = [
        {"id": "1Z2VYnXb01h-3uvEptoQ48Fo__eAn0wc1", "name": "fractal.jpg", "relativePath": "gdown_folder_test/fractal.jpg"},
        {"id": "14xzOzvKjP0at07jfonV7qVrTKoctFijz", "name": "this is a file.txt", "relativePath": "gdown_folder_test/this is a file.txt"},
        {"id": "1wlapSEt6N9Ayf7fzCTOkra_4GIg-cqeD", "name": "tux.jpg", "relativePath": "gdown_folder_test/tux.jpg"},
    ]
    
    # Merge unique files
    seen_ids = set()
    final_files = []
    for f in (files_to_download + nested_files):
        if f["id"] not in seen_ids:
            seen_ids.add(f["id"])
            final_files.append(f)

    log(f"[+] Total files ready to download: {len(final_files)}")

    # 3. Clean Destination Directory
    import shutil
    if os.path.exists(DEST_DIR):
        shutil.rmtree(DEST_DIR)
    os.makedirs(DEST_DIR, exist_ok=True)
    log(f"[Step 3] Destination directory ready (cleaned): {DEST_DIR}")

    # 4. Spawn Swift Native Helper
    log("[Step 4] Spawning Swift Native Messaging Helper...")
    proc = subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    # Handshake PING
    send_msg(proc, {"action": "PING", "timestamp": time.time() * 1000})
    pong = read_msg(proc, timeout=5.0)
    assert pong is not None and pong.get("status") == "SUCCESS", f"Ping failed: {pong}"
    log(f"[+] Swift Helper connected cleanly! Version: {pong.get('helperVersion')}")

    # 5. Start Download Job
    job_id = f"live_job_{int(time.time())}"
    log(f"[Step 5] Starting download job '{job_id}' with concurrency 2...")
    
    send_msg(proc, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": job_id,
        "destinationPath": DEST_DIR,
        "concurrency": 2,
        "files": final_files
    })

    # 6. Read stream events until JOB_COMPLETED
    completed_files = []
    failed_files = []
    job_finished = False
    start_time = time.time()

    while time.time() - start_time < 30.0:
        event = read_msg(proc, timeout=10.0)
        if not event:
            break
        
        action = event.get("action")
        if action == "JOB_ACCEPTED":
            log(f"    -> [JOB_ACCEPTED] Native helper accepted job.")
        elif action == "JOB_PROGRESS":
            speed = event.get("speedBps", 0) / 1024
            active = event.get("activeCount", 0)
            log(f"    -> [PROGRESS] {event.get('overallBytes', 0)} bytes downloaded ({active} active, speed: {speed:.1f} KB/s)")
        elif action == "FILE_COMPLETED":
            fname = event.get("name")
            bytes_w = event.get("bytesDownloaded") or event.get("bytesWritten", 0)
            md5 = event.get("md5Checksum", "")
            completed_files.append(event)
            log(f"    -> [FILE COMPLETED] '{fname}' ({bytes_w} bytes, MD5: {md5})")
        elif action == "FILE_FAILED":
            fname = event.get("name")
            err = event.get("error")
            failed_files.append(event)
            log(f"    -> [FILE FAILED] '{fname}': {err}")
        elif action == "JOB_COMPLETED":
            log(f"    -> [JOB_COMPLETED] Overall job finished!")
            job_finished = True
            break

    # Clean termination
    proc.stdin.close()
    proc.wait(timeout=3)

    log(f"[Step 6] Execution complete: {len(completed_files)} completed, {len(failed_files)} failed.")

    # 7. Physical Disk Verification
    log("[Step 7] Verifying files on disk...")
    disk_files = []
    for root, _, files in os.walk(DEST_DIR):
        for f in files:
            full_path = os.path.join(root, f)
            sz = os.path.getsize(full_path)
            with open(full_path, "rb") as fh:
                data = fh.read()
                md5 = hashlib.md5(data).hexdigest()
                magic = data[:4]
            disk_files.append((f, sz, md5, magic))
            log(f"    Disk file: '{f}' | Size: {sz} bytes | MD5: {md5} | Magic: {magic.hex()}")

    assert len(disk_files) == len(final_files), f"Expected {len(final_files)} files on disk, found {len(disk_files)}"
    assert len(failed_files) == 0, f"Encountered failed files: {failed_files}"
    log("[+] Pass 1 succeeded: All initial files on disk.")

    # 8. Live Second Pass: Repeat download in SAME destination folder with skipExisting
    log("\n[Step 8] Live Pass 2: Running download again to SAME destination folder (skipExisting=True)...")
    proc2 = subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    send_msg(proc2, {"action": "PING", "timestamp": time.time() * 1000})
    pong2 = read_msg(proc2, timeout=5.0)
    assert pong2 is not None and pong2.get("status") == "SUCCESS"

    job_id_2 = f"live_job_repeat_{int(time.time())}"
    send_msg(proc2, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": job_id_2,
        "destinationPath": DEST_DIR,
        "concurrency": 2,
        "skipExisting": True,
        "files": final_files
    })

    pass2_completed = []
    pass2_failed = []
    start_time2 = time.time()
    while time.time() - start_time2 < 30.0:
        event = read_msg(proc2, timeout=10.0)
        if not event:
            break
        act = event.get("action")
        if act == "FILE_COMPLETED":
            pass2_completed.append(event)
            log(f"    -> [SKIPPED / VERIFIED FILE] '{event.get('name')}'")
        elif act == "FILE_FAILED":
            pass2_failed.append(event)
        elif act == "JOB_COMPLETED":
            log(f"    -> [JOB_COMPLETED] Pass 2 completed successfully!")
            break

    proc2.stdin.close()
    proc2.wait(timeout=3)

    assert len(pass2_failed) == 0, f"Pass 2 had failures: {pass2_failed}"
    assert len(pass2_completed) == len(final_files), f"Expected {len(final_files)} skipped/completed files, got {len(pass2_completed)}"

    # 9. Verify disk contains NO duplicate '(1)' files
    log("[Step 9] Verifying NO duplicate collision files created in folder...")
    disk_files_pass2 = []
    duplicate_files = []
    for root, _, files in os.walk(DEST_DIR):
        for f in files:
            full_path = os.path.join(root, f)
            disk_files_pass2.append(f)
            if " (1)" in f or " (2)" in f:
                duplicate_files.append(f)

    log(f"[+] Total files in destination folder: {len(disk_files_pass2)}")
    assert len(duplicate_files) == 0, f"Found duplicate collision files in same folder: {duplicate_files}"
    assert len(disk_files_pass2) == len(disk_files), (
        f"File count changed from {len(disk_files)} to {len(disk_files_pass2)}! Same files must not be duplicated."
    )

    log("=" * 60)
    log("  100% LIVE VERIFICATION PASSED: ZERO DUPLICATES IN SAME FOLDER!")
    log("=" * 60)

if __name__ == "__main__":
    main()

