// DriveMate — TypeScript Unit & Integration Tests for PublicDriveScanner
import { PublicDriveScanner } from '../extension/src/services/publicDriveScanner.ts';

interface TestStats {
  passed: number;
  failed: number;
}

const stats: TestStats = { passed: 0, failed: 0 };

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  [PASS] ${msg}`);
    stats.passed += 1;
  } else {
    console.error(`  [FAIL] ${msg}`);
    stats.failed += 1;
  }
}

async function runTests() {
  console.log('\n--- Running PublicDriveScanner TypeScript Tests ---');

  // Test 1: URL Parsing - Folders
  const folderUrls = [
    'https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks',
    'https://drive.google.com/drive/u/0/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks?usp=sharing',
    '1KpLl_1tcK0eeehzN980zbG-3M2nhbVks'
  ];
  for (const u of folderUrls) {
    const res = PublicDriveScanner.parseTarget(u);
    assert(res.id === '1KpLl_1tcK0eeehzN980zbG-3M2nhbVks' && res.isFolder, `Parsed folder URL: ${u}`);
  }

  // Test 2: URL Parsing - Files
  const fileUrls = [
    'https://drive.google.com/file/d/14xzOzvKjP0at07jfonV7qVrTKoctFijz/view?usp=sharing',
    'https://drive.google.com/open?id=14xzOzvKjP0at07jfonV7qVrTKoctFijz'
  ];
  for (const u of fileUrls) {
    const res = PublicDriveScanner.parseTarget(u);
    assert(res.id === '14xzOzvKjP0at07jfonV7qVrTKoctFijz' && !res.isFolder && !res.isDoc, `Parsed file URL: ${u}`);
  }

  // Test 3: URL Parsing - Docs
  const docUrl = 'https://docs.google.com/document/d/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks/edit';
  const docRes = PublicDriveScanner.parseTarget(docUrl);
  assert(docRes.isDoc && docRes.docKind === 'document', 'Parsed Google Doc URL');

  // Test 4: URL Parsing - Invalid input
  let threw = false;
  try {
    PublicDriveScanner.parseTarget('https://example.com/not-drive');
  } catch {
    threw = true;
  }
  assert(threw, 'Rejects non-Google-Drive URL');

  // Test 5: Mock Recursive Folder Traversal
  const mockFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString();

    if (urlStr.includes('embeddedfolderview?id=root_folder')) {
      const html = `
        <!DOCTYPE html><html><body>
        <title>Project Root</title>
        <div class="flip-entry"><a href="https://drive.google.com/drive/folders/sub_folder_1">Subfolder Alpha</a></div>
        <div class="flip-entry"><a href="https://drive.google.com/file/d/file_1/view">document.pdf</a></div>
        <div class="flip-entry"><a href="https://docs.google.com/document/d/doc_1/edit">Meeting Notes</a></div>
        </body></html>
      `;
      return new Response(html, { status: 200 });
    }

    if (urlStr.includes('embeddedfolderview?id=sub_folder_1')) {
      const html = `
        <!DOCTYPE html><html><body>
        <title>Subfolder Alpha</title>
        <div class="flip-entry"><a href="https://drive.google.com/file/d/file_2/view">image.png</a></div>
        </body></html>
      `;
      return new Response(html, { status: 200 });
    }

    if (init?.method === 'HEAD') {
      if (urlStr.includes('file_1')) {
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': '204800',
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="document.pdf"'
          }
        });
      }
      if (urlStr.includes('file_2')) {
        return new Response(null, {
          status: 200,
          headers: {
            'content-length': '102400',
            'content-type': 'image/png',
            'content-disposition': 'attachment; filename="image.png"'
          }
        });
      }
    }

    return new Response(null, { status: 404 });
  };

  const scanner = new PublicDriveScanner({
    targetUrlOrId: 'root_folder',
    fetchFn: mockFetch,
    enrichMetadata: true
  });

  const result = await scanner.scan();
  assert(result.isComplete, 'Mock scan marked complete');
  assert(result.completenessStatus === 'COMPLETE', 'Completeness status is COMPLETE');
  assert(result.stats.totalFoldersCount === 2, `Total folders count: ${result.stats.totalFoldersCount} (expected 2)`);
  assert(result.stats.supportedFilesCount === 2, `Supported files count: ${result.stats.supportedFilesCount} (expected 2)`);
  assert(result.stats.supportedFilesSizeBytes === 307200, `Total bytes: ${result.stats.supportedFilesSizeBytes} (expected 307200)`);
  assert(result.stats.skippedFilesCount === 1, `Skipped workspace doc count: ${result.stats.skippedFilesCount} (expected 1)`);

  // Test 5b: collectDownloadableFiles
  const downloadable = PublicDriveScanner.collectDownloadableFiles(result.rootNode);
  assert(downloadable.length === 2, `Collected 2 downloadable files: ${downloadable.length}`);
  const relPaths = new Set(downloadable.map(d => d.relativePath));
  assert(relPaths.has('Project Root/document.pdf'), 'Relative path 1 preserved: Project Root/document.pdf');
  assert(relPaths.has('Project Root/Subfolder Alpha/image.png'), 'Relative path 2 preserved: Project Root/Subfolder Alpha/image.png');

  // Test 5c: Truncated Listing Detection Blocks Completeness
  const truncatedFetch: typeof fetch = async (): Promise<Response> => {
    // Deliberately truncated HTML missing </body> and </html>
    const truncatedHtml = `<title>Truncated</title><div class="flip-entry"><a href="https://drive.google.com/file/d/f1/view">file1.mp4</a></div>`;
    return new Response(truncatedHtml, { status: 200 });
  };
  const truncScanner = new PublicDriveScanner({
    targetUrlOrId: 'trunc_folder',
    fetchFn: truncatedFetch,
    enrichMetadata: false
  });
  const truncResult = await truncScanner.scan();
  assert(!truncResult.isComplete, 'Truncated scan is marked NOT complete');
  assert(truncResult.completenessStatus === 'INCOMPLETE_LISTING', `Truncated status is INCOMPLETE_LISTING (was ${truncResult.completenessStatus})`);
  assert(truncResult.completenessReason !== undefined, 'Completeness reason is provided');

  // Test 6: Inaccessible Folder (404 / Private)
  const inaccessibleFetch: typeof fetch = async (): Promise<Response> => {
    return new Response('Not Found', { status: 404 });
  };

  const privateScanner = new PublicDriveScanner({
    targetUrlOrId: 'private_folder_1234567890abcdef',
    fetchFn: inaccessibleFetch
  });
  const privateResult = await privateScanner.scan();
  assert(privateResult.rootNode.status === 'SKIPPED_PERMISSION_DENIED', 'Private folder identified as SKIPPED_PERMISSION_DENIED');
  assert(privateResult.errors.length === 1, 'Inaccessible folder logged in errors');
  assert(!privateResult.isComplete, 'Inaccessible scan is marked incomplete');

  // Test 7: Circular Folder Reference Avoidance
  const cycleFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes('embeddedfolderview?id=cycle_a')) {
      return new Response('<!DOCTYPE html><html><body><title>A</title><a href="https://drive.google.com/drive/folders/cycle_b">B</a></body></html>', { status: 200 });
    }
    if (urlStr.includes('embeddedfolderview?id=cycle_b')) {
      return new Response('<!DOCTYPE html><html><body><title>B</title><a href="https://drive.google.com/drive/folders/cycle_a">A</a></body></html>', { status: 200 });
    }
    return new Response(null, { status: 404 });
  };

  const cycleScanner = new PublicDriveScanner({
    targetUrlOrId: 'cycle_a',
    fetchFn: cycleFetch,
    enrichMetadata: false
  });
  const cycleResult = await cycleScanner.scan();
  assert(cycleResult.stats.totalFoldersCount === 2, 'Circular reference halted without infinite recursion');

  // Test 7b: Multi-Page Pagination via nextPageToken
  const pagedFetch: typeof fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const urlStr = input.toString();
    if (urlStr.includes('pageToken=token_page_2')) {
      const page2Html = `<!DOCTYPE html><html><body><title>Paged</title><div class="flip-entry"><a href="https://drive.google.com/file/d/p2_file/view">page2_file.dat</a></div></body></html>`;
      return new Response(page2Html, { status: 200 });
    }
    const page1Html = `<!DOCTYPE html><html><body><title>Paged</title><div class="flip-entry"><a href="https://drive.google.com/file/d/p1_file/view">page1_file.dat</a></div><a href="/embeddedfolderview?id=paged_root&amp;pageToken=token_page_2">Next Page</a></body></html>`;
    return new Response(page1Html, { status: 200 });
  };
  const pagedScanner = new PublicDriveScanner({
    targetUrlOrId: 'paged_root',
    fetchFn: pagedFetch,
    enrichMetadata: false
  });
  const pagedResult = await pagedScanner.scan();
  assert(pagedResult.isComplete, 'Multi-page pagination scan marked complete');
  assert(pagedResult.stats.supportedFilesCount === 2, `Multi-page resolved 2 files across pages (got ${pagedResult.stats.supportedFilesCount})`);

  // Test 8: Cancellation via AbortSignal
  const abortController = new AbortController();
  abortController.abort();
  const cancelScanner = new PublicDriveScanner({
    targetUrlOrId: 'root_folder',
    fetchFn: mockFetch,
    signal: abortController.signal
  });
  let cancelCaught = false;
  try {
    await cancelScanner.scan();
  } catch {
    cancelCaught = true;
  }
  assert(cancelCaught, 'Scan aborted immediately when signal triggered');

  // Test 9: Live Public Folder Traversal (Real Network)
  try {
    console.log('  Testing live public Drive folder with PublicDriveScanner...');
    const liveScanner = new PublicDriveScanner({
      targetUrlOrId: 'https://drive.google.com/drive/folders/1KpLl_1tcK0eeehzN980zbG-3M2nhbVks',
      enrichMetadata: true
    });
    const liveRes = await liveScanner.scan();
    if (liveRes.isComplete && liveRes.stats.supportedFilesCount > 0) {
      assert(liveRes.isComplete, 'Live scan completed successfully');
      assert(liveRes.rootFolderName === 'gdown_folder_test', `Live root folder name: "${liveRes.rootFolderName}"`);
      assert(liveRes.stats.supportedFilesCount === 6, `Live files found: ${liveRes.stats.supportedFilesCount} (expected 6)`);
      assert(liveRes.stats.supportedFilesSizeBytes > 0, `Live total size > 0: ${liveRes.stats.supportedFilesSizeBytes} bytes`);
    } else {
      console.log(`  [INFO] Live Google Drive network blocked or offline in current environment (${liveRes.rootFolderName}). Skipping live network assertions.`);
    }
  } catch (err: any) {
    console.log(`  [INFO] Live network test skipped or errored: ${err.message}`);
  }

  console.log(`\n==========================================`);
  console.log(`TYPESCRIPT UNIT TESTS: ${stats.passed}/${stats.passed + stats.failed} PASSED`);
  console.log(`==========================================\n`);

  if (stats.failed > 0) {
    process.exit(1);
  }
}

runTests();
