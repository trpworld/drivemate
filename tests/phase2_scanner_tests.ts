// DriveMate Phase 2 — Comprehensive Automated Unit & Mock Test Suite
// Executes against real TypeScript DriveScanner implementation using mock HTTP responses.

import { DriveScanner, type ScanOptions } from '../extension/src/services/driveScanner.ts';
import type { ScanResult, DriveApiListResponse, DriveApiFile } from '../extension/src/types/drive.ts';

const SECRET_TOKEN = "ya29.SECRET_OAUTH_TOKEN_DO_NOT_LEAK_123456789";

function createMockResponse(data: any, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" }
  });
}

async function runPhase2Tests() {
  console.log("=" .repeat(65));
  console.log("  DRIVEMATE PHASE 2: METADATA SCANNER & OAUTH TEST SUITE");
  console.log("=" .repeat(65));

  let passedCount = 0;
  let totalCount = 11; // 11 scanner tests + Phase 1 test = 12 total

  // TEST 1: Authentication Error Handling (401 Expired Token)
  console.log("\n[Test 1] Testing OAuth 401 token expiration handling...");
  const mockFetchAuthErr: typeof fetch = async () => {
    return createMockResponse({ error: { message: "Invalid Credentials", code: 401 } }, 401, "Unauthorized");
  };
  const scanner1 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_test",
    fetchFn: mockFetchAuthErr
  });
  scanner1.setRootFolderId("root_test");
  const result1 = await scanner1.scan();
  if (!result1.isComplete && result1.errors.some(e => e.errorCode === "AUTH_EXPIRED")) {
    console.log("  -> PASSED: Expired token flagged cleanly with AUTH_EXPIRED error.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Expected AUTH_EXPIRED error", result1);
  }

  // TEST 2: Successful Metadata Parsing
  console.log("\n[Test 2] Testing successful single-folder metadata parsing...");
  const mockFetchSuccess: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_test?")) {
      return createMockResponse({ id: "root_test", name: "Wedding_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    // Folder list
    return createMockResponse({
      files: [
        {
          id: "vid_1",
          name: "Highlight.mp4",
          mimeType: "video/mp4",
          size: "4294967296",
          md5Checksum: "abcdef123456",
          capabilities: { canDownload: true }
        }
      ]
    });
  };
  const scanner2 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_test",
    fetchFn: mockFetchSuccess
  });
  scanner2.setRootFolderId("root_test");
  const result2 = await scanner2.scan();
  if (result2.isComplete && result2.stats.supportedFilesCount === 1 && result2.stats.supportedFilesSizeBytes === 4294967296) {
    console.log("  -> PASSED: Correctly parsed single file metadata with 4GB size.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Expected 1 supported file with 4294967296 bytes", result2);
  }

  // TEST 3: Nested Folders Traversal
  console.log("\n[Test 3] Testing deep recursive nested folder traversal (3 levels)...");
  const mockFetchNested: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_nested?")) {
      return createMockResponse({ id: "root_nested", name: "Root", mimeType: "application/vnd.google-apps.folder" });
    }
    if (urlStr.includes("root_nested") && !urlStr.includes("files/root_nested?")) {
      return createMockResponse({
        files: [
          { id: "sub_1", name: "Camera_A", mimeType: "application/vnd.google-apps.folder" }
        ]
      });
    }
    if (urlStr.includes("sub_1")) {
      return createMockResponse({
        files: [
          { id: "sub_2", name: "4K_Raw", mimeType: "application/vnd.google-apps.folder" }
        ]
      });
    }
    if (urlStr.includes("sub_2")) {
      return createMockResponse({
        files: [
          { id: "clip_1", name: "Clip001.MOV", mimeType: "video/quicktime", size: "1000000", capabilities: { canDownload: true } }
        ]
      });
    }
    return createMockResponse({ files: [] });
  };
  const scanner3 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_nested",
    fetchFn: mockFetchNested
  });
  scanner3.setRootFolderId("root_nested");
  const result3 = await scanner3.scan();
  if (result3.isComplete && result3.stats.totalFoldersCount === 3 && result3.stats.supportedFilesCount === 1) {
    console.log("  -> PASSED: Successfully traversed 3 nested levels to find leaf media file.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Nested traversal failed", result3);
  }

  // TEST 4: Pagination Across Multiple Pages
  console.log("\n[Test 4] Testing pagination handling across multiple pages (nextPageToken)...");
  let pageRequestCount = 0;
  const mockFetchPagination: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_page?")) {
      return createMockResponse({ id: "root_page", name: "Paged_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    pageRequestCount++;
    if (!urlStr.includes("pageToken=token_page_2")) {
      return createMockResponse({
        nextPageToken: "token_page_2",
        files: [{ id: "f1", name: "File1.mp4", mimeType: "video/mp4", size: "100", capabilities: { canDownload: true } }]
      });
    } else {
      return createMockResponse({
        files: [{ id: "f2", name: "File2.mp4", mimeType: "video/mp4", size: "200", capabilities: { canDownload: true } }]
      });
    }
  };
  const scanner4 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_page",
    fetchFn: mockFetchPagination
  });
  scanner4.setRootFolderId("root_page");
  const result4 = await scanner4.scan();
  if (result4.isComplete && result4.stats.supportedFilesCount === 2 && pageRequestCount === 2) {
    console.log("  -> PASSED: Multi-page pagination resolved all items across pages.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Pagination test failed", result4, "Page count:", pageRequestCount);
  }

  // TEST 5: Missing File Size or Checksum
  console.log("\n[Test 5] Handling files with missing size and missing MD5 checksum...");
  const mockFetchMissingMeta: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_missing?")) {
      return createMockResponse({ id: "root_missing", name: "Missing_Meta", mimeType: "application/vnd.google-apps.folder" });
    }
    return createMockResponse({
      files: [
        { id: "f_no_meta", name: "Stream.m3u8", mimeType: "application/x-mpegURL", capabilities: { canDownload: true } }
      ]
    });
  };
  const scanner5 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_missing",
    fetchFn: mockFetchMissingMeta
  });
  scanner5.setRootFolderId("root_missing");
  const result5 = await scanner5.scan();
  const fileNode5 = result5.rootNode.children?.[0];
  if (result5.isComplete && fileNode5 && fileNode5.sizeBytes === undefined && fileNode5.md5Checksum === undefined && fileNode5.status === "SUPPORTED") {
    console.log("  -> PASSED: Safely preserved item without fabricating missing size or MD5.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Missing metadata test failed", result5);
  }

  // TEST 6: Google Workspace Documents Skipped
  console.log("\n[Test 6] Verifying Google Workspace documents are skipped with explicit reason...");
  const mockFetchWorkspace: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_ws?")) {
      return createMockResponse({ id: "root_ws", name: "WS_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    return createMockResponse({
      files: [
        { id: "doc1", name: "Script.gdoc", mimeType: "application/vnd.google-apps.document" },
        { id: "sheet1", name: "Budget.gsheet", mimeType: "application/vnd.google-apps.spreadsheet" },
        { id: "vid1", name: "Video.mp4", mimeType: "video/mp4", size: "500", capabilities: { canDownload: true } }
      ]
    });
  };
  const scanner6 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_ws",
    fetchFn: mockFetchWorkspace
  });
  scanner6.setRootFolderId("root_ws");
  const result6 = await scanner6.scan();
  const skippedNodes = result6.rootNode.children?.filter(c => c.status === "SKIPPED_WORKSPACE") || [];
  if (result6.isComplete && skippedNodes.length === 2 && result6.stats.supportedFilesCount === 1) {
    console.log("  -> PASSED: 2 Workspace files correctly skipped with explicit SKIPPED_WORKSPACE reason.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Workspace skip test failed", result6);
  }

  // TEST 7: Duplicate Filenames Disambiguated
  console.log("\n[Test 7] Testing duplicate filename collision resolution in same folder...");
  const mockFetchDuplicates: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_dups?")) {
      return createMockResponse({ id: "root_dups", name: "Dup_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    return createMockResponse({
      files: [
        { id: "f_dup_1", name: "Highlight.mp4", mimeType: "video/mp4", size: "100", capabilities: { canDownload: true } },
        { id: "f_dup_2", name: "Highlight.mp4", mimeType: "video/mp4", size: "200", capabilities: { canDownload: true } },
        { id: "f_dup_3", name: "Highlight.mp4", mimeType: "video/mp4", size: "300", capabilities: { canDownload: true } }
      ]
    });
  };
  const scanner7 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_dups",
    fetchFn: mockFetchDuplicates
  });
  scanner7.setRootFolderId("root_dups");
  const result7 = await scanner7.scan();
  const names = result7.rootNode.children?.map(c => c.name) || [];
  if (names.includes("Highlight.mp4") && names.includes("Highlight (1).mp4") && names.includes("Highlight (2).mp4")) {
    console.log("  -> PASSED: Duplicate names cleanly disambiguated to:", names);
    passedCount++;
  } else {
    console.error("  -> FAILED: Duplicate names not disambiguated properly:", names);
  }

  // TEST 8: Permission Denied Files (capabilities.canDownload == false)
  console.log("\n[Test 8] Testing files with restricted download capability (canDownload: false)...");
  const mockFetchNoDownload: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_perm?")) {
      return createMockResponse({ id: "root_perm", name: "Perm_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    return createMockResponse({
      files: [
        { id: "f_restricted", name: "Confidential.mp4", mimeType: "video/mp4", size: "100", capabilities: { canDownload: false } }
      ]
    });
  };
  const scanner8 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_perm",
    fetchFn: mockFetchNoDownload
  });
  scanner8.setRootFolderId("root_perm");
  const result8 = await scanner8.scan();
  const restrictedNode = result8.rootNode.children?.[0];
  if (restrictedNode?.status === "SKIPPED_PERMISSION_DENIED") {
    console.log("  -> PASSED: Restricted file flagged as SKIPPED_PERMISSION_DENIED.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Expected SKIPPED_PERMISSION_DENIED", restrictedNode);
  }

  // TEST 9: Transient Rate Limits (HTTP 429) & Backoff Recovery
  console.log("\n[Test 9] Testing transient rate limit (HTTP 429) backoff and recovery...");
  let rateLimitHits = 0;
  const mockFetchRateLimit: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_rate?")) {
      return createMockResponse({ id: "root_rate", name: "Rate_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    if (rateLimitHits < 2) {
      rateLimitHits++;
      return createMockResponse({ error: { message: "User Rate Limit Exceeded", code: 429 } }, 429, "Too Many Requests");
    }
    return createMockResponse({
      files: [
        { id: "f_rate_ok", name: "Recovered.mp4", mimeType: "video/mp4", size: "500", capabilities: { canDownload: true } }
      ]
    });
  };
  const scanner9 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_rate",
    fetchFn: mockFetchRateLimit
  });
  scanner9.setRootFolderId("root_rate");
  const result9 = await scanner9.scan();
  if (result9.isComplete && rateLimitHits === 2 && result9.stats.supportedFilesCount === 1) {
    console.log("  -> PASSED: Successfully backed off twice on HTTP 429 and recovered.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Rate limit recovery failed", result9, "Hits:", rateLimitHits);
  }

  // TEST 10: Incomplete / Partial Scan Distinction
  console.log("\n[Test 10] Testing partial scan state when network fails permanently...");
  const mockFetchHardFailure: typeof fetch = async (url) => {
    const urlStr = url.toString();
    if (urlStr.includes("files/root_fail?")) {
      return createMockResponse({ id: "root_fail", name: "Fail_Root", mimeType: "application/vnd.google-apps.folder" });
    }
    throw new Error("DNS lookup failed");
  };
  const scanner10 = new DriveScanner({
    authToken: SECRET_TOKEN,
    rootFolderId: "root_fail",
    fetchFn: mockFetchHardFailure
  });
  scanner10.setRootFolderId("root_fail");
  const result10 = await scanner10.scan();
  if (result10.isComplete === false && result10.errors.length > 0 && result10.errors[0].errorCode === "NETWORK_FAILURE") {
    console.log("  -> PASSED: Incomplete scan flagged as isComplete: false with recorded errors.");
    passedCount++;
  } else {
    console.error("  -> FAILED: Incomplete scan test failed", result10);
  }

  // TEST 11: Zero OAuth Token Leakage
  console.log("\n[Test 11] Verifying zero token leakage in JSON results and error logs...");
  const jsonExport = JSON.stringify(result1);
  const jsonExport2 = JSON.stringify(result2);
  const jsonExport3 = JSON.stringify(result10);
  if (!jsonExport.includes(SECRET_TOKEN) && !jsonExport2.includes(SECRET_TOKEN) && !jsonExport3.includes(SECRET_TOKEN)) {
    console.log("  -> PASSED: Strict assertion verified: No OAuth tokens leaked into any JSON exports.");
    passedCount++;
  } else {
    console.error("  -> SECURITY BREACH: Token leaked in JSON output!");
  }

  console.log("\n" + "=" .repeat(65));
  console.log(`  PHASE 2 SCANNER TESTS COMPLETED: ${passedCount}/${totalCount} PASSED`);
  console.log("=" .repeat(65));

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runPhase2Tests().catch(err => {
  console.error("Fatal error running Phase 2 test suite:", err);
  process.exit(1);
});
