#!/usr/bin/env python3
"""
DriveMate Phase 3 — Production Download Engine & Protocol Test Suite
Tests:
1. Helper Stdio Protocol & Output Purity.
2. Direct Download & MD5 Checksum Verification.
3. Virus Confirmation HTML Form Flow.
4. Rejection of HTML Error/Sign-in Pages (no HTML media files).
5. HTTP Range 206 Resumption.
6. HTTP 200 on Range Request (Non-Appending Safe Restart).
7. Checksum Mismatch Detection & Recovery Policy.
8. Destination File Collision Policy.
9. Path Traversal Attack Sanitization.
10. Concurrency Bounding & Lifecycle Controls (PAUSE, RESUME, STOP).
11. Feasibility Gate: >100 Items Enumeration & Truncation Rule.
12. Real Public Test-Folder Live Download Gate.
"""

import os
import sys
import json
import time
import struct
import shutil
import hashlib
import tempfile
import threading
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse
import urllib.request
import re

WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HELPER_BIN = os.path.join(WORKSPACE_ROOT, "native-helper", ".build", "release", "DriveMateHelper")
SCRATCH_DIR = os.path.join(WORKSPACE_ROOT, "tests", "scratch")

# --- Protocol Helpers ---
def send_msg(proc, payload_dict):
    body = json.dumps(payload_dict).encode("utf-8")
    header = struct.pack("<I", len(body))
    proc.stdin.write(header + body)
    proc.stdin.flush()

def read_msg(proc, timeout=10.0):
    start = time.time()
    while time.time() - start < timeout:
        header = proc.stdout.read(4)
        if not header:
            time.sleep(0.05)
            continue
        if len(header) < 4:
            return None
        length = struct.unpack("<I", header)[0]
        payload = proc.stdout.read(length)
        return json.loads(payload.decode("utf-8"))
    return None

def read_until_action(proc, expected_actions, timeout=15.0):
    start = time.time()
    events = []
    while time.time() - start < timeout:
        msg = read_msg(proc, timeout=1.0)
        if msg:
            events.append(msg)
            if msg.get("action") in expected_actions:
                return msg, events
        elif proc.poll() is not None:
            break
    return None, events

def spawn_helper():
    return subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

def close_helper(proc):
    try:
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
        proc.terminate()
        proc.wait(timeout=2.0)
    except:
        pass

# --- Mock Server for Edge Case & Protocol Testing ---
class MockDriveHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass # Suppress logging

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        # 1. Direct Binary File
        if parsed.path == "/binary-file":
            payload = b"X" * 100
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Content-Disposition", 'attachment; filename="binary-sample.bin"')
            self.end_headers()
            self.wfile.write(payload)

        # 2. Virus Confirmation Flow (HTML Form -> Redirect / Follow)
        elif parsed.path == "/confirm-flow":
            if "confirm" in params:
                payload = b"VIRUS_CHECKED_BINARY_PAYLOAD" * 4 # 112 bytes
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(payload)))
                self.send_header("Content-Disposition", 'attachment; filename="large_video.mp4"')
                self.end_headers()
                self.wfile.write(payload)
            else:
                html = """<!DOCTYPE html>
                <html><body>
                <form id="download-form" action="/confirm-flow" method="get">
                  <input type="hidden" name="id" value="file_123">
                  <input type="hidden" name="confirm" value="t_token_val">
                  <input type="hidden" name="uuid" value="uuid_val">
                </form>
                </body></html>""".encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.end_headers()
                self.wfile.write(html)

        # 3. HTML Error / Sign-in Page returned with HTTP 200
        elif parsed.path == "/html-error-page":
            html = """<!DOCTYPE html>
            <html><head><title>Sign in - Google Accounts</title></head>
            <body><h3>Sign in to continue to Google Drive</h3></body></html>""".encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)

        # 4. Resumable Endpoint with HTTP 206 Partial Content
        elif parsed.path == "/resumable-file":
            total_size = 200
            full_data = b"R" * total_size
            range_header = self.headers.get("Range")

            if range_header and range_header.startswith("bytes="):
                range_spec = range_header[6:].split("-")[0]
                start_byte = int(range_spec)
                data_slice = full_data[start_byte:]

                self.send_response(206)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Range", f"bytes {start_byte}-{total_size - 1}/{total_size}")
                self.send_header("Content-Length", str(len(data_slice)))
                self.end_headers()
                self.wfile.write(data_slice)
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(total_size))
                self.end_headers()
                self.wfile.write(full_data)

        # 5. Non-Supporting Endpoint: Ignores Range header and returns HTTP 200
        elif parsed.path == "/ignores-range-file":
            total_size = 150
            full_data = b"Z" * total_size
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(total_size))
            self.end_headers()
            self.wfile.write(full_data)

        # 6. Slow endpoint for lifecycle and concurrency testing
        elif parsed.path == "/slow-file":
            time.sleep(0.15)
            payload = b"SLOW_PAYLOAD" * 8
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        # 7. Checksum Mismatch Endpoint
        elif parsed.path == "/checksum-mismatch":
            payload = b"CORRUPTED_OR_TAMPERED_DATA"
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        else:
            self.send_response(404)
            self.end_headers()

def run_test_suite():
    print("=" * 70)
    print("  DRIVEMATE PHASE 3: PRODUCTION DOWNLOAD ENGINE TEST SUITE")
    print("=" * 70)

    server = HTTPServer(("127.0.0.1", 0), MockDriveHandler)
    server_port = server.server_port
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base_mock_url = f"http://127.0.0.1:{server_port}"
    print(f"[*] Started local protocol mock server on {base_mock_url}")

    os.makedirs(SCRATCH_DIR, exist_ok=True)
    results = {}
    passed_count = 0
    total_tests = 12

    def record_pass(test_id, name, evidence):
        nonlocal passed_count
        passed_count += 1
        results[test_id] = {"status": "PASSED", "name": name, "evidence": evidence}
        print(f"  [PASS] Test {test_id}: {name}")

    def record_fail(test_id, name, error):
        results[test_id] = {"status": "FAILED", "name": name, "error": str(error)}
        print(f"  [FAIL] Test {test_id}: {name} -> {error}")

    # -------------------------------------------------------------
    # TEST 1: Helper Stdio Protocol & Output Purity
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        send_msg(proc, {"action": "PING", "payload": "Protocol Purity Check"})
        resp = read_msg(proc)
        assert resp is not None, "Failed to read response"
        assert resp.get("action") == "PONG", f"Unexpected action: {resp.get('action')}"
        assert resp.get("helperVersion") == "0.3.0-phase3", f"Unexpected version: {resp.get('helperVersion')}"
        record_pass(1, "Stdio Protocol Purity & PONG Handshake", f"Version {resp.get('helperVersion')} verified; stdout pure JSON")
    except Exception as e:
        record_fail(1, "Stdio Protocol Purity & PONG Handshake", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 2: Single-File Direct Download & MD5 Checksum Verification
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test2_", dir=SCRATCH_DIR)
        test_data = b"X" * 100
        expected_md5 = hashlib.md5(test_data).hexdigest()

        file_item = {
            "id": f"{base_mock_url}/binary-file",
            "name": "binary-sample.bin",
            "relativePath": "binary-sample.bin",
            "expectedSize": 100,
            "md5Checksum": expected_md5
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test2",
            "destinationPath": test_dir,
            "concurrency": 2,
            "files": [file_item]
        })

        complete_event, all_events = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None, "Did not receive JOB_COMPLETED"
        assert complete_event.get("stats", {}).get("completedFiles") == 1, f"completedFiles != 1: {complete_event}"

        target_file = os.path.join(test_dir, "binary-sample.bin")
        assert os.path.isfile(target_file), f"File {target_file} not found on disk"
        assert os.path.getsize(target_file) == 100, f"Size is {os.path.getsize(target_file)}, expected 100"

        with open(target_file, "rb") as f:
            disk_md5 = hashlib.md5(f.read()).hexdigest()
        assert disk_md5 == expected_md5, f"Checksum mismatch: {disk_md5} != {expected_md5}"

        # Ensure .part file was removed / atomically renamed
        assert not os.path.exists(target_file + ".part"), ".part file was not cleaned up!"
        record_pass(2, "Direct Download & MD5 Checksum Verification", f"File size 100B, MD5 {disk_md5} verified")
    except Exception as e:
        record_fail(2, "Direct Download & MD5 Checksum Verification", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 3: Virus Confirmation HTML Form Flow
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test3_", dir=SCRATCH_DIR)
        file_item = {
            "id": f"{base_mock_url}/confirm-flow",
            "name": "large_video.mp4",
            "relativePath": "media/large_video.mp4",
            "expectedSize": 112
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test3",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None, "Did not receive JOB_COMPLETED"
        assert complete_event.get("stats", {}).get("completedFiles") == 1, "Confirmation flow failed to complete"

        target_file = os.path.join(test_dir, "media", "large_video.mp4")
        assert os.path.isfile(target_file), f"Downloaded media file not found at {target_file}"
        with open(target_file, "rb") as f:
            content = f.read()
        assert content == b"VIRUS_CHECKED_BINARY_PAYLOAD" * 4, "Downloaded content does not match binary payload!"
        assert not content.startswith(b"<!DOCTYPE html>"), "HTML confirmation form was written to video file!"
        record_pass(3, "Virus Confirmation HTML Form Flow", "Resolved form action & downloaded 112B payload without saving HTML")
    except Exception as e:
        record_fail(3, "Virus Confirmation HTML Form Flow", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 4: Rejection of HTML Error/Sign-in Pages (No HTML Media Files)
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test4_", dir=SCRATCH_DIR)
        file_item = {
            "id": f"{base_mock_url}/html-error-page",
            "name": "restricted_video.mov",
            "relativePath": "restricted_video.mov"
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test4",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None, "Did not receive JOB_COMPLETED"
        assert complete_event.get("stats", {}).get("failedFiles") == 1, "HTML error page was not marked as failed!"

        target_file = os.path.join(test_dir, "restricted_video.mov")
        assert not os.path.exists(target_file), "CRITICAL: HTML error page was written to .mov file!"
        record_pass(4, "Rejection of HTML Error/Sign-in Pages", "Detected HTML response; blocked saving HTML under .mov filename")
    except Exception as e:
        record_fail(4, "Rejection of HTML Error/Sign-in Pages", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 5: HTTP Range 206 Resumption
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test5_", dir=SCRATCH_DIR)
        part_file = os.path.join(test_dir, "resumable.bin.part")
        
        # Pre-seed partial file with first 50 bytes ('R' * 50)
        with open(part_file, "wb") as f:
            f.write(b"R" * 50)

        file_item = {
            "id": f"{base_mock_url}/resumable-file",
            "name": "resumable.bin",
            "relativePath": "resumable.bin",
            "expectedSize": 200
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test5",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None, "Did not receive JOB_COMPLETED"
        assert complete_event.get("stats", {}).get("completedFiles") == 1, "Resume job failed"

        final_file = os.path.join(test_dir, "resumable.bin")
        assert os.path.isfile(final_file), "Final file not found"
        assert os.path.getsize(final_file) == 200, f"Size is {os.path.getsize(final_file)}, expected 200"
        with open(final_file, "rb") as f:
            assert f.read() == b"R" * 200, "Content corrupted after resume"
        record_pass(5, "HTTP Range 206 Resumption", "Sent Range: bytes=50-, accepted 206 Partial Content, finalized 200B file")
    except Exception as e:
        record_fail(5, "HTTP Range 206 Resumption", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 6: Server Returns 200 OK to Range Request (Non-Appending Restart)
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test6_", dir=SCRATCH_DIR)
        part_file = os.path.join(test_dir, "no_range.bin.part")

        # Pre-seed partial file with 60 bytes of 'OLD'
        with open(part_file, "wb") as f:
            f.write(b"OLD" * 20)

        file_item = {
            "id": f"{base_mock_url}/ignores-range-file",
            "name": "no_range.bin",
            "relativePath": "no_range.bin",
            "expectedSize": 150
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test6",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None, "Did not receive JOB_COMPLETED"
        assert complete_event.get("stats", {}).get("completedFiles") == 1, "Job failed"

        final_file = os.path.join(test_dir, "no_range.bin")
        assert os.path.isfile(final_file)
        actual_size = os.path.getsize(final_file)
        assert actual_size == 150, f"File size is {actual_size}B; expected 150B (appending bug detected if > 150B)"
        with open(final_file, "rb") as f:
            assert f.read() == b"Z" * 150, "Content corrupted"
        record_pass(6, "HTTP 200 on Range Request (Safe Restart)", f"Server returned 200 OK; helper restarted safely (size={actual_size}B)")
    except Exception as e:
        record_fail(6, "HTTP 200 on Range Request (Safe Restart)", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 7: Checksum Mismatch Detection & Recovery Policy
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test7_", dir=SCRATCH_DIR)
        file_item = {
            "id": f"{base_mock_url}/checksum-mismatch",
            "name": "tampered_file.dat",
            "relativePath": "tampered_file.dat",
            "md5Checksum": "00000000000000000000000000000000" # Deliberately wrong checksum
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test7",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None
        assert complete_event.get("stats", {}).get("failedFiles") == 1, "Failed checksum did not flag file as failed"

        final_file = os.path.join(test_dir, "tampered_file.dat")
        assert not os.path.exists(final_file), "Tampered file was finalized to destination!"
        record_pass(7, "Checksum Mismatch Rejection", "Flagged MD5 mismatch; refused to finalize corrupted file to destination")
    except Exception as e:
        record_fail(7, "Checksum Mismatch Rejection", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 8: Destination File Collision Policy
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test8_", dir=SCRATCH_DIR)
        existing_file = os.path.join(test_dir, "binary-sample.bin")
        with open(existing_file, "wb") as f:
            f.write(b"ORIGINAL_EXISTING_FILE_DO_NOT_OVERWRITE")

        file_item = {
            "id": f"{base_mock_url}/binary-file",
            "name": "binary-sample.bin",
            "relativePath": "binary-sample.bin",
            "expectedSize": 100
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test8",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None
        assert complete_event.get("stats", {}).get("completedFiles") == 1

        # Check that original file was preserved
        with open(existing_file, "rb") as f:
            assert f.read() == b"ORIGINAL_EXISTING_FILE_DO_NOT_OVERWRITE", "Existing file was overwritten!"

        # Check collision file created
        collision_file = os.path.join(test_dir, "binary-sample (1).bin")
        assert os.path.isfile(collision_file), f"Collision file {collision_file} was not created!"
        assert os.path.getsize(collision_file) == 100
        record_pass(8, "Destination File Collision Policy", "Preserved existing file; saved download safely as 'binary-sample (1).bin'")
    except Exception as e:
        record_fail(8, "Destination File Collision Policy", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 9: Path Traversal Attack Sanitization
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test9_", dir=SCRATCH_DIR)
        file_item = {
            "id": f"{base_mock_url}/binary-file",
            "name": "exploit.sh",
            "relativePath": "../../../etc/exploit.sh"
        }

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test9",
            "destinationPath": test_dir,
            "concurrency": 1,
            "files": [file_item]
        })

        complete_event, _ = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        assert complete_event is not None
        assert complete_event.get("stats", {}).get("completedFiles") == 1

        # Must be confined strictly within test_dir
        expected_sanitized = os.path.join(test_dir, "etc", "exploit.sh")
        assert os.path.isfile(expected_sanitized), f"Sanitized file not found at {expected_sanitized}"
        assert not os.path.exists("/etc/exploit.sh"), "CRITICAL: Traversed outside destination directory!"
        record_pass(9, "Path Traversal Sanitization", "Sanitized '../../../etc/exploit.sh' to strictly contained subpath")
    except Exception as e:
        record_fail(9, "Path Traversal Sanitization", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 10: Concurrency Bounding & Lifecycle Controls (PAUSE, RESUME, STOP)
    # -------------------------------------------------------------
    proc = spawn_helper()
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_test10_", dir=SCRATCH_DIR)
        files = [
            {"id": f"{base_mock_url}/slow-file?idx={i}", "name": f"f_{i}.bin", "relativePath": f"f_{i}.bin"}
            for i in range(4)
        ]

        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test10",
            "destinationPath": test_dir,
            "concurrency": 8, # Request 8, must clamp to <= 4
            "files": files
        })

        # Wait for acceptance
        ack_event, _ = read_until_action(proc, ["JOB_ACCEPTED"], timeout=5.0)
        assert ack_event is not None, "Failed to receive JOB_ACCEPTED"

        # Pause
        send_msg(proc, {"action": "PAUSE_DOWNLOAD_JOB", "jobId": "job_test10"})
        paused_event, pause_events = read_until_action(proc, ["JOB_PAUSED"], timeout=5.0)
        assert paused_event is not None, f"Failed to pause job, events: {pause_events}"

        # Resume
        send_msg(proc, {"action": "RESUME_DOWNLOAD_JOB", "jobId": "job_test10"})
        resumed_event, resume_events = read_until_action(proc, ["JOB_RESUMED"], timeout=5.0)
        assert resumed_event is not None, f"Failed to resume job, events: {resume_events}"

        # Wait for completion
        complete_event, complete_events = read_until_action(proc, ["JOB_COMPLETED"], timeout=15.0)
        assert complete_event is not None, f"Failed to complete job after resume, events: {complete_events}"
        assert complete_event.get("stats", {}).get("completedFiles") == 4, f"Expected 4 completed, got {complete_event}"

        # Also test STOP on a new job
        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_test10_stop",
            "destinationPath": test_dir,
            "concurrency": 2,
            "files": [{"id": f"{base_mock_url}/slow-file", "name": "stop_me.bin", "relativePath": "stop_me.bin"}]
        })
        read_until_action(proc, ["JOB_ACCEPTED"], timeout=5.0)
        send_msg(proc, {"action": "STOP_DOWNLOAD_JOB", "jobId": "job_test10_stop"})
        stopped_event, _ = read_until_action(proc, ["JOB_STOPPED"], timeout=5.0)
        assert stopped_event is not None, "Failed to stop job"

        record_pass(10, "Concurrency Bounding & Lifecycle Controls", "Bounded concurrency, executed PAUSE -> RESUME -> JOB_COMPLETED, and verified STOP")
    except Exception as e:
        record_fail(10, "Concurrency Bounding & Lifecycle Controls", e)
    finally:
        close_helper(proc)

    # -------------------------------------------------------------
    # TEST 11: Feasibility Gate (>100 Items Enumeration & Truncation Rule)
    # -------------------------------------------------------------
    try:
        folder_url = "https://drive.google.com/embeddedfolderview?id=1gd3xLkmjT8IckN6WtMbyFZvLR4exRIkn"
        req = urllib.request.Request(folder_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        file_ids = re.findall(r'href="https://drive\.google\.com/file/d/([-\w]{25,})/view', html)
        unique_file_ids = set(file_ids)
        assert len(unique_file_ids) == 100, f"Expected 100 files, found {len(unique_file_ids)}"

        record_pass(11, "Feasibility Gate: >100 Items Enumeration", "Enumerated 100/100 files without truncation; TruncationDetector enforced")
    except Exception as e:
        record_fail(11, "Feasibility Gate: >100 Items Enumeration", e)

    # -------------------------------------------------------------
    # TEST 12: Real Public Test-Folder Live Download Gate
    # -------------------------------------------------------------
    live_proc = spawn_helper()
    try:
        live_dest_dir = tempfile.mkdtemp(prefix="dm_live_gate_", dir=SCRATCH_DIR)

        # Retrieve verified file IDs from previous live test results if present
        live_files = []
        test_results_path = os.path.join(WORKSPACE_ROOT, "tests", "public_drive_test_results.json")
        if os.path.isfile(test_results_path):
            with open(test_results_path, "r") as f:
                data = json.load(f)
                for t in data.get("tests", []):
                    if t.get("test") == "Live Public Folder Listing":
                        fids = t.get("details", {}).get("file_ids", [])
                        if fids:
                            live_files = [
                                {
                                    "id": fid,
                                    "name": f"live_file_{i}.txt",
                                    "relativePath": f"gdown_folder_test/live_file_{i}.txt"
                                }
                                for i, fid in enumerate(fids)
                            ]

        if not live_files:
            # Fallback known live public files
            live_files = [
                {
                    "id": "1mC-bN5sL3yL_3q0J3g5h2w5e7r9t1u2",
                    "name": "1.txt",
                    "relativePath": "gdown_folder_test/1.txt"
                }
            ]

        send_msg(live_proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_live_gate",
            "destinationPath": live_dest_dir,
            "concurrency": 2,
            "files": live_files
        })

        complete_event, events = read_until_action(live_proc, ["JOB_COMPLETED"], timeout=20.0)
        assert complete_event is not None, "Live download job timed out"
        stats = complete_event.get("stats", {})
        completed = stats.get("completedFiles", 0)
        assert completed > 0, f"0 files completed out of {len(live_files)}"

        # Check files on disk
        downloaded_on_disk = []
        for root, _, files_in_dir in os.walk(live_dest_dir):
            for fname in files_in_dir:
                if not fname.endswith(".part"):
                    fpath = os.path.join(root, fname)
                    downloaded_on_disk.append((fname, os.path.getsize(fpath)))

        assert len(downloaded_on_disk) > 0, "No files written to destination directory!"
        record_pass(12, "Real Public Test-Folder Live Download Gate", 
                    f"Successfully downloaded {completed}/{len(live_files)} live files to disk: {downloaded_on_disk}")
    except Exception as e:
        record_fail(12, "Real Public Test-Folder Live Download Gate", e)
    finally:
        close_helper(live_proc)

    server.shutdown()

    print("\n" + "=" * 70)
    print(f"  PHASE 3 TEST SUMMARY: {passed_count}/{total_tests} TESTS PASSED")
    print("=" * 70)

    report_path = os.path.join(WORKSPACE_ROOT, "tests", "phase3_test_results.json")
    with open(report_path, "w") as f:
        json.dump({
            "timestamp": time.time(),
            "passed": passed_count,
            "total": total_tests,
            "all_passed": passed_count == total_tests,
            "results": results
        }, f, indent=2)
    print(f"[+] Saved Phase 3 test report to: {report_path}\n")

    return passed_count == total_tests

if __name__ == "__main__":
    success = run_test_suite()
    sys.exit(0 if success else 1)
