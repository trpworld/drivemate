#!/usr/bin/env python3
"""
Audit Script: Test Real Download Interruption & Resumption against Google Drive,
and test Integrity / Corruption detection.
"""
import os
import sys
import json
import time
import struct
import shutil
import hashlib
import tempfile
import subprocess
import urllib.request

WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HELPER_BIN = os.path.join(WORKSPACE_ROOT, "native-helper", ".build", "release", "DriveMateHelper")
SCRATCH_DIR = os.path.join(WORKSPACE_ROOT, "tests", "scratch", "audit_resume_test")

def send_msg(proc, payload_dict):
    body = json.dumps(payload_dict).encode("utf-8")
    header = struct.pack("<I", len(body))
    proc.stdin.write(header + body)
    proc.stdin.flush()

def read_until_action(proc, expected_actions, timeout=15.0):
    start = time.time()
    events = []
    while time.time() - start < timeout:
        header = proc.stdout.read(4)
        if not header:
            time.sleep(0.05)
            continue
        if len(header) < 4:
            break
        length = struct.unpack("<I", header)[0]
        payload = proc.stdout.read(length)
        msg = json.loads(payload.decode("utf-8"))
        events.append(msg)
        if msg.get("action") in expected_actions:
            return msg, events
    return None, events

def main():
    print("=" * 70)
    print("AUDITING REAL RESUME & INTEGRITY AGAINST LIVE GOOGLE DRIVE")
    print("=" * 70)
    
    if os.path.exists(SCRATCH_DIR):
        shutil.rmtree(SCRATCH_DIR)
    os.makedirs(SCRATCH_DIR, exist_ok=True)
    
    # Target live file: "this is a file.txt" (ID: 14xzOzvKjP0at07jfonV7qVrTKoctFijz)
    # Total size: 8222 bytes. Known MD5: 47ba7631ec25238e94e08f996fcb55be
    file_id = "14xzOzvKjP0at07jfonV7qVrTKoctFijz"
    file_name = "this is a file.txt"
    expected_size = 8222
    expected_md5 = "47ba7631ec25238e94e08f996fcb55be"
    
    # --- STEP 1: Fetch first 3000 bytes directly from Google Drive using Range header ---
    url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Range": "bytes=0-2999"
    })
    
    print(f"[*] Step 1: Pre-seeding interrupted partial download with 3,000 bytes...")
    with urllib.request.urlopen(req, timeout=15) as resp:
        status = resp.status
        cr = resp.headers.get("Content-Range")
        partial_data = resp.read()
        print(f"    Google Drive response: HTTP {status}, Content-Range: {cr}, Read: {len(partial_data)} bytes")
        assert len(partial_data) == 3000, f"Expected 3000 bytes, got {len(partial_data)}"
    
    # Write this partial file as 'this is a file.txt.part'
    part_path = os.path.join(SCRATCH_DIR, f"{file_name}.part")
    with open(part_path, "wb") as f:
        f.write(partial_data)
    
    assert os.path.getsize(part_path) == 3000
    print(f"    Created partial file: {part_path} (3,000 bytes)")
    
    # --- STEP 2: Launch DriveMate Native Helper to RESUME the download ---
    print(f"[*] Step 2: Spawning DriveMateHelper to resume download from byte 3,000...")
    proc = subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    file_item = {
        "id": file_id,
        "name": file_name,
        "relativePath": file_name,
        "expectedSize": expected_size,
        "md5Checksum": expected_md5
    }
    
    send_msg(proc, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": "job_audit_resume",
        "destinationPath": SCRATCH_DIR,
        "concurrency": 1,
        "files": [file_item]
    })
    
    complete_event, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=20.0)
    
    try:
        proc.stdin.close()
        proc.terminate()
        proc.wait(timeout=2)
    except:
        pass
    
    assert complete_event is not None, "Job did not complete within timeout"
    stats = complete_event.get("stats", {})
    print(f"    Helper response: JOB_COMPLETED. Stats: {stats}")
    assert stats.get("completedFiles") == 1, f"Expected 1 completed file, got {stats}"
    
    # --- STEP 3: Validate file on disk ---
    print(f"[*] Step 3: Validating resumed file on disk...")
    final_path = os.path.join(SCRATCH_DIR, file_name)
    assert os.path.isfile(final_path), f"File {final_path} does not exist!"
    assert not os.path.exists(part_path), f"Part file {part_path} was not cleaned up!"
    
    actual_size = os.path.getsize(final_path)
    print(f"    Actual size on disk: {actual_size} bytes (Expected: {expected_size} bytes)")
    assert actual_size == expected_size, f"Size mismatch! Got {actual_size}, expected {expected_size}"
    
    with open(final_path, "rb") as f:
        content = f.read()
        actual_md5 = hashlib.md5(content).hexdigest()
    
    print(f"    Actual MD5 on disk: {actual_md5}")
    print(f"    Expected MD5:       {expected_md5}")
    assert actual_md5 == expected_md5, f"MD5 mismatch! Got {actual_md5}, expected {expected_md5}"
    
    # Check text integrity
    assert content.startswith(b"Lorem ipsum dolor sit amet"), "File content corrupted!"
    print("    Content text integrity verified: matches original Lorem Ipsum text perfectly.")
    
    # --- STEP 4: Test Deliberately Corrupted Download Detection ---
    print(f"[*] Step 4: Testing deliberately corrupted download detection...")
    proc2 = subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    corrupt_scratch = os.path.join(WORKSPACE_ROOT, "tests", "scratch", "audit_corrupt_test")
    if os.path.exists(corrupt_scratch):
        shutil.rmtree(corrupt_scratch)
    os.makedirs(corrupt_scratch, exist_ok=True)
    
    # Provide wrong MD5 checksum
    bad_md5_item = {
        "id": file_id,
        "name": "corrupt_check.txt",
        "relativePath": "corrupt_check.txt",
        "expectedSize": expected_size,
        "md5Checksum": "ffffffffffffffffffffffffffffffff" # Deliberately wrong
    }
    
    send_msg(proc2, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": "job_audit_corrupt",
        "destinationPath": corrupt_scratch,
        "concurrency": 1,
        "files": [bad_md5_item]
    })
    
    corrupt_complete, c_events = read_until_action(proc2, ["JOB_COMPLETED"], timeout=15.0)
    try:
        proc2.stdin.close()
        proc2.terminate()
        proc2.wait(timeout=2)
    except:
        pass
    
    assert corrupt_complete is not None
    c_stats = corrupt_complete.get("stats", {})
    print(f"    Helper response on checksum mismatch: failedFiles={c_stats.get('failedFiles')}")
    assert c_stats.get("failedFiles") == 1, f"Expected 1 failed file, got {c_stats}"
    assert not os.path.exists(os.path.join(corrupt_scratch, "corrupt_check.txt")), "Corrupted file was finalized to destination!"
    print("    Corrupted file was correctly REJECTED and NOT finalized to destination.")
    
    print("\n" + "=" * 70)
    print("ALL REAL RESUME & INTEGRITY AUDIT CHECKS PASSED EMPIRICALLY!")
    print("=" * 70)

if __name__ == "__main__":
    main()
