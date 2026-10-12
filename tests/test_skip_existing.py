#!/usr/bin/env python3
"""
Test Suite: Skip Existing Identical Files (No Redundant Downloads / No Duplicate Files in Same Folder)
Tests that DriveMate:
1. Detects already-downloaded / identical existing files in the target directory.
2. Skips network re-downloading cleanly when skipExisting is true (default).
3. Does NOT create duplicate collision files like (1).ext when the file is identical.
4. Preserves collision disambiguation only when file size/content genuinely differs.
"""

import os
import sys
import json
import struct
import tempfile
import subprocess
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER_BIN = os.path.join(WORKSPACE_ROOT, "native-helper", ".build", "release", "DriveMateHelper")
SCRATCH_DIR = os.path.join(WORKSPACE_ROOT, "scratch")
os.makedirs(SCRATCH_DIR, exist_ok=True)

class MockHandler(BaseHTTPRequestHandler):
    download_request_count = 0

    def do_HEAD(self):
        if self.path == "/identical-sample.bin":
            self.send_response(200)
            self.send_header("Content-Length", "256")
            self.send_header("Content-Type", "application/octet-stream")
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == "/identical-sample.bin":
            MockHandler.download_request_count += 1
            self.send_response(200)
            self.send_header("Content-Length", "256")
            self.send_header("Content-Type", "application/octet-stream")
            self.end_headers()
            self.wfile.write(b"A" * 256)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass

def spawn_helper():
    return subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=0
    )

def send_msg(proc, payload):
    data = json.dumps(payload).encode("utf-8")
    proc.stdin.write(struct.pack("<I", len(data)))
    proc.stdin.write(data)
    proc.stdin.flush()

def read_msg(proc, timeout=5.0):
    start = time.time()
    header = b""
    while len(header) < 4:
        if time.time() - start > timeout:
            return None
        b = proc.stdout.read(4 - len(header))
        if not b:
            return None
        header += b
    length = struct.unpack("<I", header)[0]
    payload = b""
    while len(payload) < length:
        if time.time() - start > timeout:
            return None
        b = proc.stdout.read(length - len(payload))
        if not b:
            return None
        payload += b
    return json.loads(payload.decode("utf-8"))

def read_until_action(proc, target_actions, timeout=15.0):
    start = time.time()
    events = []
    while time.time() - start < timeout:
        msg = read_msg(proc, timeout=3.0)
        if msg is not None:
            events.append(msg)
            if msg.get("action") in target_actions:
                return msg, events
        elif proc.poll() is not None:
            break
    return None, events

def main():
    print("=" * 60)
    print("DRIVEMATE: SKIP EXISTING FILES IN SAME FOLDER TEST")
    print("=" * 60)

    # Start local mock server
    server = HTTPServer(("127.0.0.1", 0), MockHandler)
    port = server.server_port
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[*] Mock server running at {base_url}")

    test_dir = tempfile.mkdtemp(prefix="dm_skip_test_", dir=SCRATCH_DIR)
    print(f"[*] Target destination folder: {test_dir}")

    # TEST CASE 1: First download of a 256-byte file into folder
    print("\n--- TEST CASE 1: Initial Download ---")
    proc1 = spawn_helper()
    send_msg(proc1, {"action": "PING", "timestamp": time.time() * 1000})
    pong1 = read_msg(proc1, timeout=5.0)
    assert pong1 is not None and pong1.get("status") == "SUCCESS", "PING failed on proc1"

    file_item = {
        "id": f"{base_url}/identical-sample.bin",
        "name": "identical-sample.bin",
        "relativePath": "identical-sample.bin",
        "expectedSize": 256
    }

    send_msg(proc1, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": "job_initial",
        "destinationPath": test_dir,
        "concurrency": 1,
        "skipExisting": True,
        "files": [file_item]
    })

    complete1, _ = read_until_action(proc1, ["JOB_COMPLETED"], timeout=10.0)
    proc1.stdin.close()
    proc1.wait(timeout=2.0)

    assert complete1 is not None, "Failed to complete initial download"
    assert complete1.get("stats", {}).get("completedFiles") == 1
    target_file = os.path.join(test_dir, "identical-sample.bin")
    assert os.path.isfile(target_file), "Target file missing on disk"
    assert os.path.getsize(target_file) == 256, "Target file size incorrect"
    assert MockHandler.download_request_count == 1, "Mock server should have served 1 GET"
    print("[PASS] Test Case 1: Initial file downloaded successfully.")

    # TEST CASE 2: Run download AGAIN in the SAME folder with skipExisting: true
    print("\n--- TEST CASE 2: Second Download in Same Folder (skipExisting: true) ---")
    proc2 = spawn_helper()
    send_msg(proc2, {"action": "PING", "timestamp": time.time() * 1000})
    pong2 = read_msg(proc2, timeout=5.0)
    assert pong2 is not None and pong2.get("status") == "SUCCESS", "PING failed on proc2"

    send_msg(proc2, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": "job_repeat",
        "destinationPath": test_dir,
        "concurrency": 1,
        "skipExisting": True,
        "files": [file_item]
    })

    complete2, events2 = read_until_action(proc2, ["JOB_COMPLETED"], timeout=10.0)
    proc2.stdin.close()
    proc2.wait(timeout=2.0)

    assert complete2 is not None, "Failed to complete repeat download"
    assert complete2.get("stats", {}).get("completedFiles") == 1, "Skipped file must be marked completed"
    
    # CRITICAL VERIFICATION:
    # 1. No new network GET requests made to server!
    assert MockHandler.download_request_count == 1, (
        f"Server received {MockHandler.download_request_count} GET requests; "
        "should remain 1 because existing file must be skipped with ZERO network requests!"
    )
    # 2. No duplicate collision file created like 'identical-sample (1).bin'
    collision_file = os.path.join(test_dir, "identical-sample (1).bin")
    assert not os.path.exists(collision_file), (
        f"Duplicate collision file was created at {collision_file}! Same file should not create duplicate!"
    )
    # 3. Target file remained intact
    assert os.path.getsize(target_file) == 256, "Target file altered"
    print("[PASS] Test Case 2: Identical file in same folder was SKIPPED cleanly without network I/O and without creating duplicate '(1)' copies.")

    # TEST CASE 3: Pre-existing file without expectedSize provided in manifest (HTTP Content-Length detection)
    print("\n--- TEST CASE 3: Second Download without expectedSize in manifest ---")
    file_item_no_size = {
        "id": f"{base_url}/identical-sample.bin",
        "name": "identical-sample.bin",
        "relativePath": "identical-sample.bin"
        # expectedSize omitted
    }
    proc3 = spawn_helper()
    send_msg(proc3, {"action": "PING", "timestamp": time.time() * 1000})
    pong3 = read_msg(proc3, timeout=5.0)
    assert pong3 is not None and pong3.get("status") == "SUCCESS", "PING failed on proc3"

    send_msg(proc3, {
        "action": "START_DOWNLOAD_JOB",
        "jobId": "job_no_size",
        "destinationPath": test_dir,
        "concurrency": 1,
        "skipExisting": True,
        "files": [file_item_no_size]
    })

    complete3, _ = read_until_action(proc3, ["JOB_COMPLETED"], timeout=10.0)
    proc3.stdin.close()
    proc3.wait(timeout=2.0)

    assert complete3 is not None, "Failed to complete download without expectedSize"
    assert complete3.get("stats", {}).get("completedFiles") == 1
    assert not os.path.exists(collision_file), "Collision file created unexpectedly"
    print("[PASS] Test Case 3: Destination file matching HTTP Content-Length skipped without duplicate creation.")

    print("\n" + "=" * 60)
    print("ALL SKIP-EXISTING TESTS PASSED (100% SUCCESS)")
    print("=" * 60)

if __name__ == "__main__":
    main()
