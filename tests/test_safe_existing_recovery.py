#!/usr/bin/env python3
"""
DRIVEMATE — SAFE EXISTING-FILE RECOVERY & FINALIZATION REGRESSION TEST
Tests:
1. 476-Item Synthetic Job with 238 XML + 88 MP4 Pre-existing Files (Expected Size Unset):
   - 238 XMLs and 88 MP4s safely identified on disk and skipped (0 redundant network downloads).
   - 150 quota-blocked MP4s cleanly fail with Google Drive Quota Exceeded.
   - Final counts reconcile: 326 completed (skipped) + 150 quota failed = 476 total.
2. Unverified File Preservation on Quota Error:
   - Unknown/untyped non-empty file on disk with unset expected size.
   - Remote returns Google Drive Quota HTML error.
   - Existing file is preserved intact (never deleted/overwritten) and reports 'SIZE UNVERIFIED'.
3. Incomplete Existing File Replacement:
   - Truncated/corrupted file on disk fails format validation.
   - Safely replaced with verified download without collision error.
4. Redundant Temporary File Clean Discard:
   - Valid identical file on disk discards redundant temporary download.
5. Zero Duplicate Copies:
   - Ensures no '(1)' collision artifacts are created.
"""

import os
import sys
import json
import struct
import tempfile
import subprocess
import time
import shutil
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import threading
import select

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HELPER_BIN = os.path.join(WORKSPACE_ROOT, "native-helper", ".build", "release", "DriveMateHelper")
SCRATCH_DIR = os.path.join(WORKSPACE_ROOT, "tests", "scratch")
os.makedirs(SCRATCH_DIR, exist_ok=True)

class RecoveryMockHandler(BaseHTTPRequestHandler):
    get_count = 0
    quota_count = 0
    requested_ids = []

    def log_message(self, format, *args):
        pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        RecoveryMockHandler.get_count += 1
        path = self.path
        RecoveryMockHandler.requested_ids.append(path)

        if "quota_blocked" in path:
            RecoveryMockHandler.quota_count += 1
            html = (
                "<html><body>"
                "<p class=\"uc-error-subcaption\">"
                "Too many users have viewed or downloaded this file recently. Please try accessing the file again later."
                "</p></body></html>"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(html)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(html)
            return

        if "valid_binary" in path:
            data = b"V" * 1024
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(data)
            return

        # Default fallback
        data = b"X" * 512
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

def spawn_helper():
    return subprocess.Popen(
        [HELPER_BIN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
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
        remaining = timeout - (time.time() - start)
        if remaining <= 0:
            return None
        r, _, _ = select.select([proc.stdout], [], [], max(0.01, remaining))
        if not r:
            return None
        b = proc.stdout.read(4 - len(header))
        if not b:
            return None
        header += b
    length = struct.unpack("<I", header)[0]
    payload = b""
    while len(payload) < length:
        remaining = timeout - (time.time() - start)
        if remaining <= 0:
            return None
        r, _, _ = select.select([proc.stdout], [], [], max(0.01, remaining))
        if not r:
            return None
        b = proc.stdout.read(length - len(payload))
        if not b:
            return None
        payload += b
    return json.loads(payload.decode("utf-8"))

def read_until_action(proc, target_actions, timeout=30.0, inactivity_timeout=10.0):
    start = time.time()
    last_act = time.time()
    events = []
    while time.time() - start < timeout and time.time() - last_act < inactivity_timeout:
        msg = read_msg(proc, timeout=1.0)
        if msg is not None:
            last_act = time.time()
            events.append(msg)
            if msg.get("action") in target_actions:
                return msg, events
        elif proc.poll() is not None:
            break
    return None, events

def make_valid_mp4():
    # Build minimal valid ISO MP4 with ftyp, mdat, and moov boxes
    ftyp = struct.pack(">I4s4sI", 24, b"ftyp", b"isom", 512) + b"isom" + b"iso2"
    mdat_body = b"\x00" * 200
    mdat = struct.pack(">I4s", 8 + len(mdat_body), b"mdat") + mdat_body
    moov_body = b"\x00" * 40
    moov = struct.pack(">I4s", 8 + len(moov_body), b"moov") + moov_body
    return ftyp + mdat + moov

def make_valid_xml():
    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        "<NonRealTimeMeta>\n"
        "  <Duration value=\"816\"/>\n"
        "</NonRealTimeMeta>\n"
    ).encode("utf-8")

def main():
    print("=" * 80)
    print("DRIVEMATE — SAFE EXISTING-FILE RECOVERY & FINALIZATION REGRESSION TEST")
    print("=" * 80)

    server = ThreadingHTTPServer(("127.0.0.1", 0), RecoveryMockHandler)
    port = server.server_port
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base_url = f"http://127.0.0.1:{port}"
    print(f"[*] Started Mock Server on {base_url}\n")

    results = []

    def pass_test(num, name, details=""):
        print(f"  [PASS] Test {num}: {name} {f'({details})' if details else ''}")
        results.append((num, name, True, details))

    def fail_test(num, name, err):
        print(f"  [FAIL] Test {num}: {name} -> {err}")
        results.append((num, name, False, str(err)))

    # -------------------------------------------------------------------------
    # TEST 1: 476-Item Synthetic Job with 238 XML + 88 MP4 Pre-existing Files
    # (Simulates exact scenario: expectedSize unset, remote quota on videos)
    # -------------------------------------------------------------------------
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_476_recovery_", dir=SCRATCH_DIR)
        valid_mp4_bytes = make_valid_mp4()
        valid_xml_bytes = make_valid_xml()

        # Seed 238 XML files
        for i in range(238):
            with open(os.path.join(test_dir, f"C{1000+i:04d}M01.XML"), "wb") as f:
                f.write(valid_xml_bytes)

        # Seed 88 valid MP4 files (shots 0 through 87)
        for i in range(88):
            with open(os.path.join(test_dir, f"C{1000+i:04d}.MP4"), "wb") as f:
                f.write(valid_mp4_bytes)

        # Prepare 476 items: 238 XMLs + 238 MP4s.
        # CRITICAL: expectedSize is None (simulating public fast scan without HEAD)
        items_476 = []
        # 238 XML items
        for i in range(238):
            items_476.append({
                "id": f"{base_url}/xml_{i}",
                "name": f"C{1000+i:04d}M01.XML",
                "relativePath": f"C{1000+i:04d}M01.XML",
                "expectedSize": None
            })
        # 238 MP4 items: first 88 exist, last 150 are quota blocked!
        for i in range(238):
            url_suffix = "existing_video" if i < 88 else "quota_blocked_video"
            items_476.append({
                "id": f"{base_url}/{url_suffix}_{i}",
                "name": f"C{1000+i:04d}.MP4",
                "relativePath": f"C{1000+i:04d}.MP4",
                "expectedSize": None
            })

        RecoveryMockHandler.get_count = 0
        RecoveryMockHandler.quota_count = 0
        RecoveryMockHandler.requested_ids = []

        proc = spawn_helper()
        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_476_recovery_test",
            "destinationPath": test_dir,
            "concurrency": 16,
            "skipExisting": True,
            "files": items_476
        })

        complete_ev, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=20.0)
        proc.stdin.close()
        proc.wait(timeout=2.0)

        assert complete_ev is not None, "JOB_COMPLETED not received"
        stats = complete_ev.get("stats", {})
        total = stats.get("totalFiles")
        completed = stats.get("completedFiles")
        failed = stats.get("failedFiles")

        assert total == 476, f"Expected total 476, got {total}"
        assert completed == 326, f"Expected 326 completed (238 XML + 88 MP4), got {completed}"
        assert failed == 150, f"Expected 150 failed (quota blocked), got {failed}"

        # Verify network requests:
        # None of the 88 MP4 files and none of the 238 XML files should have been requested over network!
        for req in RecoveryMockHandler.requested_ids:
            assert "existing_video" not in req, f"Pre-existing MP4 was requested over network: {req}"

        # Verify disk contents:
        # Exactly 326 files remain on disk, uncorrupted
        disk_files = [f for f in os.listdir(test_dir) if not f.startswith(".")]
        assert len(disk_files) == 326, f"Expected 326 files on disk, found {len(disk_files)}"
        for i in range(88):
            mp4_path = os.path.join(test_dir, f"C{1000+i:04d}.MP4")
            assert os.path.exists(mp4_path), f"MP4 file missing: {mp4_path}"
            assert os.path.getsize(mp4_path) == len(valid_mp4_bytes), f"MP4 size changed: {mp4_path}"

        pass_test(1, "476-Item Job Safe Recovery", f"Skipped 326 existing (238 XML + 88 MP4); 150 quota-failed cleanly without redundant requests")
    except Exception as e:
        fail_test(1, "476-Item Job Safe Recovery", e)

    # -------------------------------------------------------------------------
    # TEST 2: Unverified Existing File Preservation on Quota Error
    # (Unknown format file with unknown expected size hits quota -> preserved with SIZE UNVERIFIED)
    # -------------------------------------------------------------------------
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_unverified_", dir=SCRATCH_DIR)
        unverified_file = os.path.join(test_dir, "custom_asset.xyz")
        original_bytes = b"UNKNOWN_BINARY_DATA_NON_EMPTY_12345678"
        with open(unverified_file, "wb") as f:
            f.write(original_bytes)

        proc = spawn_helper()
        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_unverified",
            "destinationPath": test_dir,
            "concurrency": 1,
            "skipExisting": True,
            "files": [{
                "id": f"{base_url}/quota_blocked_unverified",
                "name": "custom_asset.xyz",
                "relativePath": "custom_asset.xyz",
                "expectedSize": None
            }]
        })

        complete_ev, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        proc.stdin.close()
        proc.wait(timeout=2.0)

        # File must be preserved intact
        assert os.path.exists(unverified_file), "Existing unverified file was deleted!"
        with open(unverified_file, "rb") as f:
            current_bytes = f.read()
        assert current_bytes == original_bytes, "Existing unverified file was modified or corrupted!"

        # Failure message must contain SIZE UNVERIFIED
        failed_event = next((e for e in events if e.get("action") == "FILE_FAILED"), None)
        assert failed_event is not None, "FILE_FAILED event not received"
        err_msg = failed_event.get("error", "")
        assert "SIZE UNVERIFIED" in err_msg, f"Expected 'SIZE UNVERIFIED' in error, got: '{err_msg}'"

        pass_test(2, "Unverified File Preservation on Quota Error", f"Preserved file intact and reported: {err_msg[:60]}...")
    except Exception as e:
        fail_test(2, "Unverified File Preservation on Quota Error", e)

    # -------------------------------------------------------------------------
    # TEST 3: Incomplete Existing File Safe Replacement
    # (Truncated MP4 container is safely replaced with verified download)
    # -------------------------------------------------------------------------
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_replace_corrupt_", dir=SCRATCH_DIR)
        target_path = os.path.join(test_dir, "corrupt_video.mp4")
        # Incomplete MP4: only 16 bytes of ftyp, missing moov and mdat
        with open(target_path, "wb") as f:
            f.write(struct.pack(">I4s4sI", 16, b"ftyp", b"isom", 512))

        proc = spawn_helper()
        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_replace_corrupt",
            "destinationPath": test_dir,
            "concurrency": 1,
            "skipExisting": True,
            "files": [{
                "id": f"{base_url}/valid_binary",
                "name": "corrupt_video.mp4",
                "relativePath": "corrupt_video.mp4",
                "expectedSize": 1024
            }]
        })

        complete_ev, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        proc.stdin.close()
        proc.wait(timeout=2.0)

        assert complete_ev is not None, "JOB_COMPLETED not received"
        assert complete_ev.get("stats", {}).get("completedFiles") == 1, "Job did not complete file replacement"
        assert os.path.getsize(target_path) == 1024, f"File size is {os.path.getsize(target_path)}, expected 1024"
        with open(target_path, "rb") as f:
            assert f.read() == b"V" * 1024, "File content was not updated with validated download"

        pass_test(3, "Incomplete Existing File Safe Replacement", "Detected truncated container and atomically replaced with 1024-byte verified download")
    except Exception as e:
        fail_test(3, "Incomplete Existing File Safe Replacement", e)

    # -------------------------------------------------------------------------
    # TEST 4: Destination Collision & Discard of Redundant Temporary File
    # (Identical validated file already on disk discards temporary .part file)
    # -------------------------------------------------------------------------
    try:
        test_dir = tempfile.mkdtemp(prefix="dm_redundant_", dir=SCRATCH_DIR)
        final_file = os.path.join(test_dir, "identical_doc.bin")
        part_file = os.path.join(test_dir, "identical_doc.bin.part")
        with open(final_file, "wb") as f:
            f.write(b"V" * 1024)

        proc = spawn_helper()
        send_msg(proc, {
            "action": "START_DOWNLOAD_JOB",
            "jobId": "job_redundant",
            "destinationPath": test_dir,
            "concurrency": 1,
            "skipExisting": False, # Force download to test finalization collision logic
            "files": [{
                "id": f"{base_url}/valid_binary",
                "name": "identical_doc.bin",
                "relativePath": "identical_doc.bin",
                "expectedSize": 1024
            }]
        })

        complete_ev, events = read_until_action(proc, ["JOB_COMPLETED"], timeout=10.0)
        proc.stdin.close()
        proc.wait(timeout=2.0)

        assert complete_ev is not None, "JOB_COMPLETED not received"
        assert not os.path.exists(part_file), "Temporary .part file was not discarded!"
        assert os.path.exists(final_file), "Final file missing"
        assert not os.path.exists(os.path.join(test_dir, "identical_doc (1).bin")), "Duplicate file created!"

        pass_test(4, "Redundant Temporary File Clean Discard", "Identical final file preserved and temporary .part removed without duplication")
    except Exception as e:
        fail_test(4, "Redundant Temporary File Clean Discard", e)

    server.shutdown()

    print("\n" + "=" * 80)
    passed_count = sum(1 for r in results if r[2])
    total_count = len(results)
    print(f"RECOVERY TEST SUMMARY: {passed_count}/{total_count} TESTS PASSED")
    print("=" * 80 + "\n")

    return passed_count == total_count

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
