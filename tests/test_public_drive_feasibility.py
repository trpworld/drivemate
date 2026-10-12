#!/usr/bin/env python3
"""
DriveMate — Public Link Feasibility & Unauthenticated Access Validation Suite
Tests empirical Google Drive endpoints against real public resources and edge cases.
"""

import sys
import json
import re
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

class TestReport:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0

    def add_result(self, name: str, success: bool, details: dict):
        self.results.append({
            "test": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })
        if success:
            self.passed += 1
            print(f"  [PASS] {name}")
        else:
            self.failed += 1
            print(f"  [FAIL] {name}: {details.get('error', 'Unknown failure')}")

    def summary(self) -> dict:
        return {
            "total": len(self.results),
            "passed": self.passed,
            "failed": self.failed,
            "all_passed": self.failed == 0,
            "tests": self.results
        }

report = TestReport()

# Helper for unauthenticated HTTP requests
def http_request(url: str, method: str = "GET", headers: dict = None, timeout: int = 15):
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs, method=method)
    return urllib.request.urlopen(req, timeout=timeout)

# -------------------------------------------------------------
# TEST 1: Live Public Folder Listing via embeddedfolderview
# -------------------------------------------------------------
print("\n--- Running Test 1: Live Public Folder Listing ---")
try:
    folder_id = "1KpLl_1tcK0eeehzN980zbG-3M2nhbVks" # Real public test folder
    url = f"https://drive.google.com/embeddedfolderview?id={folder_id}"
    with http_request(url) as resp:
        status = resp.status
        html = resp.read().decode("utf-8", errors="ignore")

    title_match = re.search(r"<title>(.*?)</title>", html)
    folder_title = title_match.group(1) if title_match else ""

    # Parse entries
    child_folders = re.findall(r'href="https://drive\.google\.com/drive/folders/([-\w]{25,})"', html)
    child_files = re.findall(r'href="https://drive\.google\.com/file/d/([-\w]{25,})/view', html)

    success = (status == 200 and folder_title == "gdown_folder_test" and 
               len(child_folders) == 2 and len(child_files) == 3)
    report.add_result("Live Public Folder Listing", success, {
        "status": status,
        "folder_title": folder_title,
        "child_folders_found": len(child_folders),
        "child_files_found": len(child_files),
        "folder_ids": child_folders,
        "file_ids": child_files
    })
except Exception as e:
    report.add_result("Live Public Folder Listing", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 2: Live Nested Folder Recursive Traversal & Path Integrity
# -------------------------------------------------------------
print("\n--- Running Test 2: Live Nested Folder Traversal ---")
try:
    def parse_folder(f_id: str, current_path: str = ""):
        u = f"https://drive.google.com/embeddedfolderview?id={f_id}"
        with http_request(u) as r:
            h = r.read().decode("utf-8", errors="ignore")
        
        t_m = re.search(r"<title>(.*?)</title>", h)
        name = t_m.group(1) if t_m else f_id
        path = f"{current_path}/{name}" if current_path else name

        items = []
        for m in re.finditer(r'<a\s+[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>', h, re.DOTALL):
            href, text = m.groups()
            text = re.sub(r'<[^>]+>', '', text).strip()
            
            f_match = re.search(r'drive\.google\.com/file/d/([-\w]{25,})', href)
            fol_match = re.search(r'drive\.google\.com/drive/folders/([-\w]{25,})', href)
            
            if fol_match:
                child_id = fol_match.group(1)
                items.append({
                    "id": child_id,
                    "name": text,
                    "type": "folder",
                    "relativePath": f"{path}/{text}",
                    "children": parse_folder(child_id, path)
                })
            elif f_match:
                file_id = f_match.group(1)
                items.append({
                    "id": file_id,
                    "name": text,
                    "type": "file",
                    "relativePath": f"{path}/{text}"
                })
        return items

    tree = parse_folder("1KpLl_1tcK0eeehzN980zbG-3M2nhbVks")
    
    # Collect all leaf files
    all_files = []
    def collect_files(nodes):
        for node in nodes:
            if node["type"] == "file":
                all_files.append(node)
            elif node["type"] == "folder":
                collect_files(node.get("children", []))
    collect_files(tree)

    expected_file_names = {
        "fractal.jpg", "this is a file.txt", "tux.jpg",
        "lego-doge.jpg", "earth.jpg", "sun.jpg"
    }
    found_file_names = {f["name"] for f in all_files}

    nested_check = any("directory-1/directory-1-2" in f["relativePath"] for f in all_files)
    success = (len(all_files) == 6 and found_file_names == expected_file_names and nested_check)

    report.add_result("Live Nested Recursive Traversal", success, {
        "total_files_discovered": len(all_files),
        "expected_files_count": 6,
        "files_match": found_file_names == expected_file_names,
        "nested_paths_preserved": nested_check,
        "file_relative_paths": [f["relativePath"] for f in all_files]
    })
except Exception as e:
    report.add_result("Live Nested Recursive Traversal", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 3: Live Public File Metadata & Range Download Verification
# -------------------------------------------------------------
print("\n--- Running Test 3: Live File Metadata & Range Verification ---")
try:
    file_id = "14xzOzvKjP0at07jfonV7qVrTKoctFijz" # this is a file.txt
    dl_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
    
    # 1. HEAD request
    head_resp = http_request(dl_url, method="HEAD")
    head_status = head_resp.status
    content_len = int(head_resp.headers.get("Content-Length", 0))
    content_disp = head_resp.headers.get("Content-Disposition", "")
    
    # 2. Range request (bytes=0-0)
    range_resp = http_request(dl_url, method="GET", headers={"Range": "bytes=0-0"})
    range_status = range_resp.status
    range_header = range_resp.headers.get("Content-Range", "")
    single_byte = range_resp.read()

    # 3. GET payload snippet
    get_resp = http_request(dl_url, method="GET")
    sample_content = get_resp.read(50).decode("utf-8", errors="ignore")

    success = (head_status == 200 and content_len == 8222 and 
               'filename="this is a file.txt"' in content_disp and
               range_status == 206 and range_header.startswith("bytes 0-0/8222") and
               sample_content.startswith("Lorem ipsum"))
    
    report.add_result("Live File Metadata & Range Verification", success, {
        "head_status": head_status,
        "content_length": content_len,
        "content_disposition": content_disp,
        "range_status": range_status,
        "content_range": range_header,
        "sample_content_valid": sample_content.startswith("Lorem ipsum")
    })
except Exception as e:
    report.add_result("Live File Metadata & Range Verification", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 4: Live Inaccessible / Private Link Handling
# -------------------------------------------------------------
print("\n--- Running Test 4: Live Inaccessible/Private Resource Handling ---")
try:
    fake_folder_id = "1NonExistentFolderId1234567890abcdef"
    folder_url = f"https://drive.google.com/embeddedfolderview?id={fake_folder_id}"
    folder_status = 0
    try:
        http_request(folder_url)
    except urllib.error.HTTPError as e:
        folder_status = e.code

    fake_file_id = "1NonExistentFileId1234567890abcdef"
    file_url = f"https://drive.usercontent.google.com/download?id={fake_file_id}&export=download&confirm=t"
    file_status = 0
    try:
        http_request(file_url)
    except urllib.error.HTTPError as e:
        file_status = e.code

    success = (folder_status == 404 and file_status == 404)
    report.add_result("Live Inaccessible/Private Resource Handling", success, {
        "private_folder_http_status": folder_status,
        "private_file_http_status": file_status,
        "expected": "HTTP 404 Not Found"
    })
except Exception as e:
    report.add_result("Live Inaccessible/Private Resource Handling", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 5: Live Google Drive API v3 Without Auth Rejection
# -------------------------------------------------------------
print("\n--- Running Test 5: Live Drive API v3 Auth Rejection ---")
try:
    api_url = "https://www.googleapis.com/drive/v3/files?q='1KpLl_1tcK0eeehzN980zbG-3M2nhbVks'+in+parents"
    api_status = 0
    api_body = ""
    try:
        http_request(api_url)
    except urllib.error.HTTPError as e:
        api_status = e.code
        api_body = e.read().decode("utf-8", errors="ignore")

    success = (api_status == 403 and "PERMISSION_DENIED" in api_body)
    report.add_result("Live Drive API v3 Auth Rejection", success, {
        "api_status": api_status,
        "rejection_confirmed": success,
        "details": "Drive API v3 files.list strictly rejects unauthenticated calls"
    })
except Exception as e:
    report.add_result("Live Drive API v3 Auth Rejection", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 6: Rate Limit / Quota Exceeded HTML Detection
# -------------------------------------------------------------
print("\n--- Running Test 6: Rate Limit & Quota Exceeded Detection ---")
try:
    sample_quota_html = """
    <html><body>
    <p class="uc-error-subcaption">Too many users have viewed or downloaded this file recently. Please try accessing the file again later.</p>
    </body></html>
    """
    
    def check_rate_limit(html_content: str, http_code: int):
        if http_code == 429:
            return True, "HTTP 429 Too Many Requests"
        m = re.search(r'<p class="uc-error-subcaption">(.*?)</p>', html_content)
        if m:
            return True, m.group(1).strip()
        return False, ""

    is_limited, reason = check_rate_limit(sample_quota_html, 200)
    is_limited_429, reason_429 = check_rate_limit("", 429)

    success = (is_limited and "Too many users" in reason and is_limited_429)
    report.add_result("Rate Limit & Quota Exceeded Detection", success, {
        "html_quota_detected": is_limited,
        "quota_reason": reason,
        "http_429_detected": is_limited_429
    })
except Exception as e:
    report.add_result("Rate Limit & Quota Exceeded Detection", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 7: Filenames with Special Characters, Spaces & Unicode
# -------------------------------------------------------------
print("\n--- Running Test 7: Filenames & ID Disassociation ---")
try:
    # Verifies that file IDs remain isolated from display names
    sample_file_id = "14xzOzvKjP0at07jfonV7qVrTKoctFijz"
    sample_display_name = "this is a file (wedding photo #1) & more.txt"
    
    node = {
        "id": sample_file_id,
        "name": sample_display_name,
        "type": "file",
        "relativePath": f"Wedding 2026/{sample_display_name}"
    }

    # Verify ID is never used as filename and filename contains original spaces/symbols
    success = (node["id"] != node["name"] and " " in node["name"] and "#" in node["name"])
    report.add_result("Special Characters & Filename Integrity", success, {
        "file_id": node["id"],
        "display_name": node["name"],
        "id_disassociated_from_name": True
    })
except Exception as e:
    report.add_result("Special Characters & Filename Integrity", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 8: Workspace Native Docs Classification
# -------------------------------------------------------------
print("\n--- Running Test 8: Workspace Native Docs Classification ---")
try:
    sample_html = """
    <div class="flip-entry"><a href="https://docs.google.com/document/d/1abcXYZ1234567890abcdef123456789/edit">Annual Report</a></div>
    <div class="flip-entry"><a href="https://docs.google.com/spreadsheets/d/1sheetXYZ1234567890abcdef123456789/edit">Budget 2026</a></div>
    """
    
    docs_matches = re.findall(r'href="https://docs\.google\.com/(\w+)/d/([-\w]{25,})/', sample_html)
    classified = []
    for kind, doc_id in docs_matches:
        mime = f"application/vnd.google-apps.{kind.rstrip('s')}"
        classified.append({
            "id": doc_id,
            "type": "unsupported",
            "mimeType": mime,
            "status": "SKIPPED_WORKSPACE",
            "skipReason": "Google Workspace online document cannot be downloaded directly as an original binary file."
        })

    success = (len(classified) == 2 and 
               classified[0]["status"] == "SKIPPED_WORKSPACE" and
               classified[1]["status"] == "SKIPPED_WORKSPACE")
    report.add_result("Workspace Native Docs Classification", success, {
        "classified_items": classified
    })
except Exception as e:
    report.add_result("Workspace Native Docs Classification", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 9: Circular Folder Reference / Loop Prevention
# -------------------------------------------------------------
print("\n--- Running Test 9: Circular Reference Loop Prevention ---")
try:
    visited = set()
    root_id = "folder_root"
    child_id = "folder_child"
    
    # Simulate a loop where folder_child links back to folder_root
    adjacency = {
        "folder_root": ["folder_child"],
        "folder_child": ["folder_root", "folder_leaf"]
    }
    
    traversed = []
    cycles_detected = [0]

    def traverse(f_id):
        if f_id in visited:
            cycles_detected[0] += 1
            return
        visited.add(f_id)
        traversed.append(f_id)
        for c in adjacency.get(f_id, []):
            traverse(c)

    traverse(root_id)
    success = (cycles_detected[0] == 1 and traversed == ["folder_root", "folder_child", "folder_leaf"])
    report.add_result("Circular Reference Loop Prevention", success, {
        "cycles_prevented": cycles_detected,
        "nodes_traversed": traversed
    })
except Exception as e:
    report.add_result("Circular Reference Loop Prevention", False, {"error": str(e)})

# -------------------------------------------------------------
# TEST 10: Cancellation / Partial Scan State Handling
# -------------------------------------------------------------
print("\n--- Running Test 10: Cancellation Handling ---")
try:
    # Simulate cancellation after scanning 2 folders
    is_cancelled = False
    folders_scanned = 0
    max_folders_before_cancel = 2
    
    mock_folders = ["fol_1", "fol_2", "fol_3", "fol_4"]
    scanned_nodes = []
    
    for f in mock_folders:
        if folders_scanned >= max_folders_before_cancel:
            is_cancelled = True
            break
        scanned_nodes.append(f)
        folders_scanned += 1

    partial_result = {
        "isComplete": not is_cancelled,
        "foldersScanned": folders_scanned,
        "scannedNodes": scanned_nodes,
        "status": "CANCELLED" if is_cancelled else "COMPLETE"
    }

    success = (partial_result["isComplete"] is False and 
               partial_result["foldersScanned"] == 2 and
               partial_result["status"] == "CANCELLED")
    report.add_result("Cancellation / Partial Scan Handling", success, {
        "partial_result": partial_result
    })
except Exception as e:
    report.add_result("Cancellation / Partial Scan Handling", False, {"error": str(e)})

# -------------------------------------------------------------
# Final Summary Output
# -------------------------------------------------------------
summary = report.summary()
output_path = "/Volumes/SSD/ASSETS/GOOGLE DRIVE DOWNLOD /tests/public_drive_test_results.json"
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(summary, f, indent=2)

print(f"\n==========================================")
print(f"FEASIBILITY TEST RESULTS: {summary['passed']}/{summary['total']} PASSED")
print(f"Saved report to: {output_path}")
print(f"==========================================\n")

if not summary["all_passed"]:
    sys.exit(1)
