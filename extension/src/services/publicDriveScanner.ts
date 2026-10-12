// DriveMate — Unauthenticated Public Link Metadata Scanner
// Strictly read-only metadata traversal. Zero Google login. Zero OAuth.
// Supports ONLY public Google Drive resources shared as "Anyone on the internet with the link".

import type {
  ScanError,
  ScanNode,
  ScanResult,
  CompletenessStatus,
  DownloadFileItem
} from '../types/drive';

export interface PublicScanOptions {
  targetUrlOrId: string;
  expectedFilesCount?: number;
  signal?: AbortSignal;
  onProgress?: (info: { foldersScanned: number; filesFound: number; currentPath: string }) => void;
  fetchFn?: typeof fetch;
  enrichMetadata?: boolean; // Whether to perform lightweight HEAD requests for exact byte sizes
}

export interface ParsedTarget {
  id: string;
  isFolder: boolean;
  isDoc: boolean;
  docKind?: string;
}

export interface EnumeratedFolder {
  folderName: string;
  entries: Array<{ id: string; name: string; type: "folder" | "file" | "doc"; mimeType: string }>;
  isTruncated: boolean;
  truncationReason?: string;
}

/**
 * Replaceable adapter interface for folder enumeration
 */
export interface FolderEnumerationAdapter {
  enumerateFolder(folderId: string, signal?: AbortSignal): Promise<EnumeratedFolder>;
}

/**
 * Primary adapter: Embedded Folder View
 * Parses Google Drive's unauthenticated /embeddedfolderview HTML response.
 */
export class EmbeddedFolderViewAdapter implements FolderEnumerationAdapter {
  private fetchFn: typeof fetch;

  constructor(fetchFn: typeof fetch) {
    this.fetchFn = fetchFn;
  }

  private async fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
    let resp: Response | null = null;
    const reqHeaders: Record<string, string> = {};
    if (typeof navigator === "undefined" || !navigator.userAgent) {
      reqHeaders["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    }

    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      try {
        const bgResp = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ action: "PROXY_FETCH", url }, (r) => {
            if (chrome.runtime.lastError) {
              resolve(null);
            } else {
              resolve(r);
            }
          });
        });
        if (bgResp) {
          if (bgResp.requiresLogin) {
            throw new Error("INACCESSIBLE_HTTP_401");
          }
          if (bgResp.status === 404 || bgResp.status === 403) {
            throw new Error(`INACCESSIBLE_HTTP_${bgResp.status}`);
          }
          if (bgResp.text !== undefined && (bgResp.ok || bgResp.status === 200)) {
            resp = new Response(bgResp.text, {
              status: bgResp.status || 200,
              headers: bgResp.headers
            });
          }
        }
      } catch (e: any) {
        if (e.message?.startsWith("INACCESSIBLE_HTTP_")) {
          throw e;
        }
      }
    }

    if (!resp) {
      resp = await this.fetchFn(url, {
        method: "GET",
        headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
        signal
      });
    }

    if (resp.status === 404 || resp.status === 403) {
      throw new Error(`INACCESSIBLE_HTTP_${resp.status}`);
    }

    if (!resp.ok) {
      throw new Error(`Google Drive returned HTTP status ${resp.status}`);
    }

    return await resp.text();
  }

  public async enumerateFolder(folderId: string, signal?: AbortSignal): Promise<EnumeratedFolder> {
    const initialUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`;
    let currentUrl: string | null = initialUrl;
    const allEntries: Array<{ id: string; name: string; type: "folder" | "file" | "doc"; mimeType: string }> = [];
    const seenIds = new Set<string>();
    const seenPageUrls = new Set<string>();
    let folderName = folderId;
    let isTruncated = false;
    let truncationReason: string | undefined = undefined;
    let pagesCount = 0;
    const maxPages = 10000;

    while (currentUrl && pagesCount < maxPages) {
      if (signal?.aborted) throw new Error("Scan was cancelled by user.");
      seenPageUrls.add(currentUrl);
      pagesCount++;

      const html = await this.fetchHtml(currentUrl, signal);

      // 1. Check for complete HTML structure (detect truncated or interrupted network downloads)
      const hasHtmlEnd = /<\/body>|<\/html>/i.test(html);
      if (!hasHtmlEnd && html.length > 0) {
        isTruncated = true;
        truncationReason = "HTML response terminated prematurely (missing closing tags).";
        break;
      }

      // 2. Extract Title from initial page
      if (pagesCount === 1) {
        const titleMatch = html.match(/<title>(.*?)<\/title>/);
        if (titleMatch && titleMatch[1]) {
          folderName = titleMatch[1].trim();
        }
      }

      // 3. Parse entries from current page
      const pageEntries = this.parseEntriesFromHtml(html);
      for (const entry of pageEntries) {
        if (!seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          allEntries.push(entry);
        }
      }

      // 4. Detect listing truncation indicators:
      if (html.includes("flip-entries") && !html.includes("</div></div></body>")) {
        if (!isTruncated && !html.endsWith("</html>") && !html.endsWith("</body>")) {
          isTruncated = true;
          truncationReason = "Folder entries container was not closed cleanly.";
          break;
        }
      }

      // 5. Follow pagination if present
      const nextUrl = this.extractNextPageUrl(html, folderId);
      if (nextUrl && nextUrl !== currentUrl) {
        if (seenPageUrls.has(nextUrl)) {
          isTruncated = true;
          truncationReason = "Circular pagination reference detected and safely halted.";
          break;
        }
        currentUrl = nextUrl;
      } else {
        // If there's an explicit indicator of more items that cannot be accessed
        if (html.includes("flip-entry-view-more") || html.includes("more-items") || html.includes("class=\"view-more\"")) {
          isTruncated = true;
          truncationReason = "Google Drive unauthenticated view has additional items that cannot be accessed without sign-in.";
        }
        break;
      }
    }

    if (currentUrl && pagesCount >= maxPages && !isTruncated) {
      isTruncated = true;
      truncationReason = `Folder listing reached maximum supported page traversal limit (${maxPages} pages). Additional pages were not scanned.`;
    }

    return {
      folderName,
      entries: allEntries,
      isTruncated,
      truncationReason
    };
  }

  private extractNextPageUrl(html: string, folderId: string): string | null {
    // 1. Look for href with pageToken, start, or continue in embeddedfolderview
    const pageTokenMatch = html.match(/href=["'](\/embeddedfolderview\?[^"']*(?:pageToken|start|page|continue)=[^"']*)["']/i);
    if (pageTokenMatch && pageTokenMatch[1]) {
      const path = pageTokenMatch[1].replace(/&amp;/g, "&");
      return path.startsWith("http") ? path : `https://drive.google.com${path}`;
    }

    // 2. Look for data-next-page-token or data-page-token attribute
    const tokenAttrMatch = html.match(/data-(?:next-)?page-token=["']([^"']+)["']/i);
    if (tokenAttrMatch && tokenAttrMatch[1]) {
      return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}&pageToken=${encodeURIComponent(tokenAttrMatch[1])}`;
    }

    // 3. Look for form input with name="pageToken" or name="start"
    const inputMatch = html.match(/<input\s+[^>]*name=["'](?:pageToken|start)["'][^>]*value=["']([^"']+)["']/i);
    if (inputMatch && inputMatch[1]) {
      return `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}&pageToken=${encodeURIComponent(inputMatch[1])}`;
    }

    return null;
  }

  private parseEntriesFromHtml(html: string): Array<{ id: string; name: string; type: "folder" | "file" | "doc"; mimeType: string }> {
    const results: Array<{ id: string; name: string; type: "folder" | "file" | "doc"; mimeType: string }> = [];
    const seenIds = new Set<string>();

    // Match <a> tags
    const aRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis;
    let match: RegExpExecArray | null;

    while ((match = aRegex.exec(html)) !== null) {
      const href = match[1];
      const innerHtml = match[2];
      const rawText = innerHtml.replace(/<[^>]+>/g, "").trim();

      // Folder check: /drive/folders/{id}
      const folderMatch = href.match(/(?:https?:\/\/drive\.google\.com)?\/(?:drive\/(?:u\/\d+\/)?)?folders\/([-\w]+)/);
      if (folderMatch) {
        const id = folderMatch[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          results.push({
            id,
            name: rawText || id,
            type: "folder",
            mimeType: "application/vnd.google-apps.folder"
          });
        }
        continue;
      }

      // File check: /file/d/{id}/view
      const fileMatch = href.match(/(?:https?:\/\/drive\.google\.com)?\/file\/d\/([-\w]+)/);
      if (fileMatch) {
        const id = fileMatch[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          results.push({
            id,
            name: rawText || id,
            type: "file",
            mimeType: "application/octet-stream"
          });
        }
        continue;
      }

      // Google Docs check: docs.google.com/{kind}/d/{id}/
      const docMatch = href.match(/(?:https?:\/\/docs\.google\.com)?\/([a-z]+)\/d\/([-\w]+)/);
      if (docMatch) {
        const id = docMatch[2];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const kind = docMatch[1].replace(/s$/, "");
          results.push({
            id,
            name: rawText || id,
            type: "doc",
            mimeType: `application/vnd.google-apps.${kind}`
          });
        }
        continue;
      }
    }

    return results;
  }
}

export class PublicDriveScanner {
  private targetInput: string;
  private expectedFilesCount?: number;
  private signal?: AbortSignal;
  private onProgress?: (info: { foldersScanned: number; filesFound: number; currentPath: string }) => void;
  private fetchFn: typeof fetch;
  private enrichMetadata: boolean;
  private adapter: FolderEnumerationAdapter;

  private visitedFolderIds = new Set<string>();
  private errors: ScanError[] = [];
  private totalFolders = 0;
  private supportedFiles = 0;
  private supportedSizeBytes = 0;
  private skippedFiles = 0;
  private hasTruncation = false;
  private truncationDetails: string[] = [];
  private hasPermissionDenied = false;
  private hasNetworkError = false;

  constructor(options: PublicScanOptions, adapter?: FolderEnumerationAdapter) {
    this.targetInput = options.targetUrlOrId.trim();
    this.expectedFilesCount = options.expectedFilesCount;
    this.signal = options.signal;
    this.onProgress = options.onProgress;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
    this.enrichMetadata = options.enrichMetadata !== false;
    this.adapter = adapter || new EmbeddedFolderViewAdapter(this.fetchFn);
  }

  /**
   * Parse arbitrary Google Drive URL or raw ID into target metadata
   */
  public static parseTarget(input: string): ParsedTarget {
    const raw = input.trim();

    // 1. Check for folder URL
    const folderMatch = raw.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?)?folders\/([-\w]{25,})/);
    if (folderMatch) {
      return { id: folderMatch[1], isFolder: true, isDoc: false };
    }

    // 2. Check for file URL
    const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([-\w]{25,})/);
    if (fileMatch) {
      return { id: fileMatch[1], isFolder: false, isDoc: false };
    }

    // 3. Check for open?id= URL
    const openMatch = raw.match(/drive\.google\.com\/open\?id=([-\w]{25,})/);
    if (openMatch) {
      return { id: openMatch[1], isFolder: false, isDoc: false };
    }

    // 4. Check for Google Docs / Sheets / Slides URL
    const docMatch = raw.match(/docs\.google\.com\/(\w+)\/d\/([-\w]{25,})/);
    if (docMatch) {
      return { id: docMatch[2], isFolder: false, isDoc: true, docKind: docMatch[1] };
    }

    // 5. Check if input is an alphanumeric ID (at least 5 characters)
    const rawIdMatch = raw.match(/^([-\w]{5,})$/);
    if (rawIdMatch) {
      // Default assume folder if raw ID, will verify on first fetch
      return { id: rawIdMatch[1], isFolder: true, isDoc: false };
    }

    throw new Error(`Invalid Google Drive link or ID: "${input}". Please provide a valid public Google Drive link.`);
  }

  /**
   * Collect all downloadable leaf files from a completed ScanNode tree
   */
  public static collectDownloadableFiles(rootNode: ScanNode): DownloadFileItem[] {
    return collectDownloadableFiles(rootNode);
  }

  public async scan(): Promise<ScanResult> {
    const startedAt = new Date().toISOString();
    const scanId = `scan_${Date.now()}`;

    this.visitedFolderIds.clear();
    this.errors = [];
    this.totalFolders = 0;
    this.supportedFiles = 0;
    this.supportedSizeBytes = 0;
    this.skippedFiles = 0;
    this.hasTruncation = false;
    this.truncationDetails = [];
    this.hasPermissionDenied = false;
    this.hasNetworkError = false;

    const target = PublicDriveScanner.parseTarget(this.targetInput);

    if (target.isDoc) {
      // Google Workspace Document
      const rootNode: ScanNode = {
        id: target.id,
        name: `Google ${target.docKind || 'Workspace Document'}`,
        type: 'unsupported',
        mimeType: `application/vnd.google-apps.${target.docKind || 'document'}`,
        canDownload: false,
        status: 'SKIPPED_WORKSPACE',
        skipReason: 'Google Workspace online document cannot be downloaded directly as an original binary file without authentication/conversion.',
        relativePath: ''
      };
      this.skippedFiles = 1;
      return this.buildResult(scanId, target.id, rootNode.name, startedAt, rootNode);
    }

    if (!target.isFolder) {
      // Single public file link
      const singleFileNode = await this.inspectSingleFile(target.id, "");
      const rootNode: ScanNode = {
        id: "root_single_file",
        name: singleFileNode.name,
        type: "folder",
        mimeType: "application/vnd.google-apps.folder",
        canDownload: singleFileNode.canDownload,
        status: singleFileNode.status,
        relativePath: "",
        children: [singleFileNode]
      };
      this.totalFolders = 1;
      return this.buildResult(scanId, target.id, singleFileNode.name, startedAt, rootNode);
    }

    // Recursive Folder Scan
    const rootNode = await this.scanFolderRecursive(target.id, "");

    return this.buildResult(scanId, target.id, rootNode.name, startedAt, rootNode);
  }

  private async scanFolderRecursive(folderId: string, currentPath: string): Promise<ScanNode> {
    if (this.signal?.aborted) {
      throw new Error("Scan was cancelled by user.");
    }

    if (this.visitedFolderIds.has(folderId)) {
      return {
        id: folderId,
        name: "[Cycle Reference]",
        type: "shortcut",
        mimeType: "application/vnd.google-apps.shortcut",
        canDownload: false,
        status: "SKIPPED_SHORTCUT_CYCLE",
        skipReason: "Circular folder reference detected and avoided.",
        relativePath: currentPath
      };
    }

    this.visitedFolderIds.add(folderId);
    this.totalFolders += 1;

    let enumerated: EnumeratedFolder;
    try {
      enumerated = await this.adapter.enumerateFolder(folderId, this.signal);
    } catch (err: any) {
      if (this.signal?.aborted) throw err;

      if (err.message && (err.message.startsWith("INACCESSIBLE_HTTP_") || err.message.includes("Failed to fetch"))) {
        this.hasPermissionDenied = true;
        const code = err.message.startsWith("INACCESSIBLE_HTTP_")
          ? err.message.replace("INACCESSIBLE_HTTP_", "")
          : "403/404";
        this.errors.push({
          folderId,
          message: `Folder is inaccessible (${code}). It is private, restricted, or requires Google sign-in.`,
          errorCode: "INACCESSIBLE_RESOURCE",
          retryable: false
        });
        return {
          id: folderId,
          name: `Inaccessible Folder (${folderId})`,
          type: "folder",
          mimeType: "application/vnd.google-apps.folder",
          canDownload: false,
          status: "SKIPPED_PERMISSION_DENIED",
          skipReason: `Resource returned HTTP ${code} (private or requires login).`,
          relativePath: currentPath,
          children: []
        };
      }
      return {
        id: folderId,
        name: `Unreachable Folder (${folderId})`,
        type: "folder",
        mimeType: "application/vnd.google-apps.folder",
        canDownload: false,
        status: "ERROR",
        skipReason: err.message,
        relativePath: currentPath,
        children: []
      };
    }

    if (enumerated.isTruncated) {
      this.hasTruncation = true;
      this.truncationDetails.push(`Folder "${enumerated.folderName}" (${folderId}): ${enumerated.truncationReason || "Truncated listing"}`);
    }

    const folderName = enumerated.folderName;
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    if (this.onProgress) {
      this.onProgress({
        foldersScanned: this.totalFolders,
        filesFound: this.supportedFiles,
        currentPath: folderPath
      });
    }

    const folderNode: ScanNode = {
      id: folderId,
      name: folderName,
      type: "folder",
      mimeType: "application/vnd.google-apps.folder",
      canDownload: true,
      status: "SUPPORTED",
      relativePath: currentPath,
      children: []
    };

    for (const entry of enumerated.entries) {
      if (this.signal?.aborted) break;

      if (entry.type === "folder") {
        const subFolderNode = await this.scanFolderRecursive(entry.id, folderPath);
        folderNode.children?.push(subFolderNode);
      } else if (entry.type === "doc") {
        this.skippedFiles += 1;
        folderNode.children?.push({
          id: entry.id,
          name: entry.name,
          type: "unsupported",
          mimeType: entry.mimeType,
          canDownload: false,
          status: "SKIPPED_WORKSPACE",
          skipReason: "Google Workspace online document cannot be downloaded directly as an original binary file.",
          relativePath: `${folderPath}/${entry.name}`
        });
      } else {
        // Normal file
        let fileNode: ScanNode;
        if (this.enrichMetadata) {
          fileNode = await this.inspectSingleFile(entry.id, folderPath, entry.name);
        } else {
          this.supportedFiles += 1;
          fileNode = {
            id: entry.id,
            name: entry.name,
            type: "file",
            mimeType: entry.mimeType || "application/octet-stream",
            canDownload: true,
            status: "SUPPORTED",
            relativePath: `${folderPath}/${entry.name}`
          };
        }
        folderNode.children?.push(fileNode);

        if (this.onProgress) {
          this.onProgress({
            foldersScanned: this.totalFolders,
            filesFound: this.supportedFiles,
            currentPath: folderPath
          });
        }
      }
    }

    return folderNode;
  }

  /**
   * Performs an unauthenticated HEAD probe to retrieve exact file size and filename
   */
  private async inspectSingleFile(fileId: string, parentPath: string, hintName?: string): Promise<ScanNode> {
    const dlUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
    let displayName = hintName || fileId;
    let sizeBytes = 0;
    let mimeType = "application/octet-stream";
    let isAccessible = true;

    try {
      let headResp: Response | null = null;
      const reqHeaders: Record<string, string> = {};
      if (typeof navigator === "undefined" || !navigator.userAgent) {
        reqHeaders["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      }

      try {
        headResp = await this.fetchFn(dlUrl, {
          method: "HEAD",
          headers: Object.keys(reqHeaders).length > 0 ? reqHeaders : undefined,
          signal: this.signal
        });
      } catch (err: any) {
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          const bgResp = await new Promise<any>((resolve) => {
            chrome.runtime.sendMessage({ action: "PROXY_FETCH", url: dlUrl, method: "HEAD" }, resolve);
          });
          if (bgResp && bgResp.status) {
            headResp = new Response(null, {
              status: bgResp.status,
              headers: bgResp.headers
            });
          }
        }
      }

      if (headResp) {
        if (headResp.status === 404 || headResp.status === 403) {
          isAccessible = false;
        } else if (headResp.ok) {
          const cl = headResp.headers.get("content-length");
          if (cl) sizeBytes = parseInt(cl, 10) || 0;

          const ct = headResp.headers.get("content-type");
          if (ct) mimeType = ct;

          const cd = headResp.headers.get("content-disposition");
          if (cd) {
            const fnMatch = cd.match(/filename=["']?([^"';]+)["']?/i);
            if (fnMatch && fnMatch[1]) {
              displayName = fnMatch[1].trim();
            }
          }
        }
      }
    } catch {
      // In case HEAD request fails, fallback gracefully to hintName
    }

    const relPath = parentPath ? `${parentPath}/${displayName}` : displayName;

    if (!isAccessible) {
      this.skippedFiles += 1;
      return {
        id: fileId,
        name: displayName,
        type: "file",
        mimeType,
        canDownload: false,
        status: "SKIPPED_PERMISSION_DENIED",
        skipReason: "File is private or requires Google login.",
        relativePath: relPath
      };
    }

    this.supportedFiles += 1;
    this.supportedSizeBytes += sizeBytes;

    return {
      id: fileId,
      name: displayName,
      type: "file",
      mimeType,
      sizeBytes,
      canDownload: true,
      status: "SUPPORTED",
      relativePath: relPath
    };
  }

  private buildResult(
    scanId: string,
    rootFolderId: string,
    rootFolderName: string,
    startedAt: string,
    rootNode: ScanNode
  ): ScanResult {
    let isComplete = true;
    let completenessStatus: CompletenessStatus = 'COMPLETE';
    let completenessReason: string | undefined = undefined;

    if (this.signal?.aborted) {
      isComplete = false;
      completenessStatus = 'CANCELLED';
      completenessReason = 'Scan was cancelled by user.';
    } else if (this.expectedFilesCount !== undefined && this.expectedFilesCount > 0 && this.supportedFiles !== this.expectedFilesCount) {
      isComplete = false;
      completenessStatus = 'INCOMPLETE_LISTING';
      completenessReason = `Discovered ${this.supportedFiles} supported files, but expected exactly ${this.expectedFilesCount} files. Scanning could not confirm all expected files; download blocked for safety.`;
    } else if (this.hasTruncation) {
      isComplete = false;
      completenessStatus = 'INCOMPLETE_LISTING';
      completenessReason = `Folder listing was truncated or reached unauthenticated enumeration limits (${this.truncationDetails.join('; ')}). To prevent partial downloads, full recursive download is blocked.`;
    } else if (this.hasPermissionDenied) {
      isComplete = false;
      completenessStatus = 'INCOMPLETE_PERMISSION_DENIED';
      completenessReason = 'This Google Drive folder is private or requires sign-in. DriveMate is in Public Link Mode (zero login). To download this folder, open it in Google Drive -> Share -> change General access to "Anyone with the link" (Viewer).';
    } else if (this.hasNetworkError || this.errors.length > 0) {
      isComplete = false;
      completenessStatus = 'INCOMPLETE_NETWORK_ERROR';
      completenessReason = `Errors encountered during traversal: ${this.errors.map(e => e.message).join('; ')}`;
    }

    return {
      scanId,
      rootFolderId,
      rootFolderName,
      startedAt,
      completedAt: new Date().toISOString(),
      isComplete,
      completenessStatus,
      completenessReason,
      stats: {
        totalFoldersCount: this.totalFolders,
        supportedFilesCount: this.supportedFiles,
        supportedFilesSizeBytes: this.supportedSizeBytes,
        skippedFilesCount: this.skippedFiles,
        errorsCount: this.errors.length
      },
      errors: this.errors,
      rootNode
    };
  }
}

/**
 * Traverses a ScanNode hierarchy and extracts all downloadable file items deterministically.
 * Disambiguates same-name files from different source file IDs so no files are dropped,
 * while preventing duplicate entries for identical file IDs.
 */
export function collectDownloadableFiles(node: ScanNode): Array<{
  id: string;
  name: string;
  relativePath: string;
  expectedSize?: number;
  md5Checksum?: string;
  mimeType?: string;
}> {
  const allLeafFiles: ScanNode[] = [];

  function walk(n: ScanNode) {
    if (n.type === 'file' && n.canDownload && n.status === 'SUPPORTED') {
      allLeafFiles.push(n);
    }
    if (n.children && n.children.length > 0) {
      // Sort children deterministically by id to ensure identical ordering across repeated scans
      const sortedChildren = [...n.children].sort((a, b) => a.id.localeCompare(b.id));
      for (const child of sortedChildren) {
        walk(child);
      }
    }
  }

  walk(node);

  const result: Array<{
    id: string;
    name: string;
    relativePath: string;
    expectedSize?: number;
    md5Checksum?: string;
    mimeType?: string;
  }> = [];

  const usedPaths = new Map<string, string>(); // lowercase relativePath -> fileId
  const fileIdToDisambiguatedPath = new Map<string, string>();

  for (const item of allLeafFiles) {
    if (fileIdToDisambiguatedPath.has(item.id)) {
      // Duplicate reference in tree for the exact same file ID: do not create duplicate download
      continue;
    }

    let relPath = item.relativePath;
    let pathKey = relPath.toLowerCase();

    if (usedPaths.has(pathKey) && usedPaths.get(pathKey) !== item.id) {
      // Genuine filename collision: different source file ID with same relative path!
      const lastSlash = relPath.lastIndexOf('/');
      const dir = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
      const baseFilename = lastSlash >= 0 ? relPath.slice(lastSlash + 1) : relPath;

      const dotIndex = baseFilename.lastIndexOf('.');
      const nameWithoutExt = dotIndex > 0 ? baseFilename.slice(0, dotIndex) : baseFilename;
      const ext = dotIndex > 0 ? baseFilename.slice(dotIndex) : '';

      let counter = 1;
      let candidateRelPath = dir ? `${dir}/${nameWithoutExt} (${counter})${ext}` : `${nameWithoutExt} (${counter})${ext}`;
      let candidateKey = candidateRelPath.toLowerCase();

      while (usedPaths.has(candidateKey) && usedPaths.get(candidateKey) !== item.id) {
        counter += 1;
        candidateRelPath = dir ? `${dir}/${nameWithoutExt} (${counter})${ext}` : `${nameWithoutExt} (${counter})${ext}`;
        candidateKey = candidateRelPath.toLowerCase();
      }

      relPath = candidateRelPath;
      pathKey = candidateKey;
    }

    usedPaths.set(pathKey, item.id);
    fileIdToDisambiguatedPath.set(item.id, relPath);

    result.push({
      id: item.id,
      name: relPath.includes('/') ? relPath.slice(relPath.lastIndexOf('/') + 1) : relPath,
      relativePath: relPath,
      expectedSize: item.sizeBytes,
      md5Checksum: item.md5Checksum,
      mimeType: item.mimeType,
    });
  }

  return result;
}

