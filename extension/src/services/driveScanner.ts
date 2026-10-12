// DriveMate Phase 2 — Recursive Google Drive Folder Metadata Scanner
// Strictly read-only metadata traversal. Zero file downloads.

import type {
  DriveApiFile,
  DriveApiListResponse,
  ScanError,
  ScanNode,
  ScanResult
} from '../types/drive.ts';

export interface ScanOptions {
  authToken: string;
  rootFolderId: string;
  rootFolderName?: string;
  signal?: AbortSignal;
  onProgress?: (info: { foldersScanned: number; filesFound: number; currentPath: string }) => void;
  fetchFn?: typeof fetch; // Injectable for unit testing
}

export class DriveScanner {
  private authToken: string;
  private signal?: AbortSignal;
  private onProgress?: (info: { foldersScanned: number; filesFound: number; currentPath: string }) => void;
  private fetchFn: typeof fetch;

  private visitedFolderIds = new Set<string>();
  private errors: ScanError[] = [];
  private totalFolders = 0;
  private supportedFiles = 0;
  private supportedSizeBytes = 0;
  private skippedFiles = 0;
  private isScanComplete = true;

  constructor(options: ScanOptions) {
    this.authToken = options.authToken;
    this.signal = options.signal;
    this.onProgress = options.onProgress;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  public async scan(): Promise<ScanResult> {
    const startedAt = new Date().toISOString();
    const scanId = `scan_${Date.now()}`;
    const rootFolderId = this.extractFolderId(this.optionsRootId());

    this.visitedFolderIds.clear();
    this.errors = [];
    this.totalFolders = 0;
    this.supportedFiles = 0;
    this.supportedSizeBytes = 0;
    this.skippedFiles = 0;
    this.isScanComplete = true;

    // Step 1: Retrieve root folder metadata
    let rootName = "Google Drive Folder";
    try {
      const rootMeta = await this.fetchFileMetadata(rootFolderId);
      if (rootMeta && rootMeta.name) {
        rootName = rootMeta.name;
      }
    } catch (err: any) {
      this.errors.push({
        folderId: rootFolderId,
        message: `Failed to fetch root folder metadata: ${err.message || String(err)}`,
        errorCode: "ROOT_FETCH_ERROR"
      });
      this.isScanComplete = false;
    }

    const rootNode: ScanNode = {
      id: rootFolderId,
      name: rootName,
      type: 'folder',
      mimeType: 'application/vnd.google-apps.folder',
      canDownload: true,
      status: 'SUPPORTED',
      relativePath: '',
      children: []
    };

    this.totalFolders = 1;
    this.visitedFolderIds.add(rootFolderId);

    // Step 2: Recursively traverse folder hierarchy
    try {
      await this.traverseFolder(rootNode);
    } catch (err: any) {
      if (this.signal?.aborted) {
        this.isScanComplete = false;
        this.errors.push({
          folderId: rootFolderId,
          message: "Scan was cancelled by user.",
          errorCode: "SCAN_CANCELLED"
        });
      } else {
        this.isScanComplete = false;
        this.errors.push({
          folderId: rootFolderId,
          message: `Fatal error during traversal: ${err.message || String(err)}`,
          errorCode: "TRAVERSAL_ABORTED"
        });
      }
    }

    const completedAt = new Date().toISOString();

    return {
      scanId,
      rootFolderId,
      rootFolderName: rootName,
      startedAt,
      completedAt,
      isComplete: this.isScanComplete && !this.signal?.aborted,
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

  private optionsRootId(): string {
    return (this as any)._rootFolderId || "";
  }

  public setRootFolderId(id: string) {
    (this as any)._rootFolderId = id;
  }

  /**
   * Recursively traverses a folder node and populates its children.
   */
  private async traverseFolder(folderNode: ScanNode): Promise<void> {
    if (this.signal?.aborted) return;

    this.onProgress?.({
      foldersScanned: this.totalFolders,
      filesFound: this.supportedFiles + this.skippedFiles,
      currentPath: folderNode.relativePath || folderNode.name
    });

    let pageToken: string | undefined = undefined;
    const childrenMap = new Map<string, ScanNode>(); // Disambiguate duplicate names

    do {
      if (this.signal?.aborted) return;

      const pageResult = await this.listFolderPage(folderNode.id, pageToken);
      if (!pageResult) {
        this.isScanComplete = false;
        break;
      }

      for (const item of pageResult.files || []) {
        if (item.trashed) continue;

        const resolvedNode = this.classifyItem(item, folderNode.relativePath);
        
        // Handle duplicate names within the same folder
        const uniqueName = this.disambiguateName(resolvedNode.name, childrenMap);
        resolvedNode.name = uniqueName;
        childrenMap.set(uniqueName, resolvedNode);

        if (resolvedNode.type === 'folder') {
          // Detect circular references
          if (this.visitedFolderIds.has(resolvedNode.id)) {
            resolvedNode.status = 'SKIPPED_SHORTCUT_CYCLE';
            resolvedNode.skipReason = 'Circular folder reference detected.';
            this.skippedFiles++;
          } else {
            this.totalFolders++;
            this.visitedFolderIds.add(resolvedNode.id);
            resolvedNode.children = [];
            await this.traverseFolder(resolvedNode);
          }
        } else if (resolvedNode.status === 'SUPPORTED') {
          this.supportedFiles++;
          this.supportedSizeBytes += resolvedNode.sizeBytes || 0;
        } else {
          this.skippedFiles++;
        }
      }

      pageToken = pageResult.nextPageToken;
    } while (pageToken);

    folderNode.children = Array.from(childrenMap.values());
  }

  /**
   * Fetches a single page of items inside a folder with retries & backoff.
   */
  private async listFolderPage(
    folderId: string,
    pageToken?: string
  ): Promise<DriveApiListResponse | null> {
    const baseUrl = 'https://www.googleapis.com/drive/v3/files';
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,size,md5Checksum,modifiedTime,capabilities(canDownload),shortcutDetails,trashed)',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });

    if (pageToken) {
      params.append('pageToken', pageToken);
    }

    const url = `${baseUrl}?${params.toString()}`;
    return this.executeWithRetry<DriveApiListResponse>(url, folderId);
  }

  /**
   * Fetches metadata for a single file/folder.
   */
  private async fetchFileMetadata(fileId: string): Promise<DriveApiFile | null> {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,capabilities(canDownload)&supportsAllDrives=true`;
    return this.executeWithRetry<DriveApiFile>(url, fileId);
  }

  /**
   * Bounded HTTP request executor with exponential backoff on 429/500/503.
   */
  private async executeWithRetry<T>(url: string, contextId: string): Promise<T | null> {
    const maxRetries = 4;
    let attempt = 0;

    while (attempt < maxRetries) {
      if (this.signal?.aborted) {
        throw new Error("Aborted by user");
      }

      try {
        const response = await this.fetchFn(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            Accept: 'application/json'
          },
          signal: this.signal
        });

        if (response.ok) {
          const json = await response.json();
          return json as T;
        }

        const status = response.status;
        const errorText = await response.text();

        // 401: Token expired
        if (status === 401) {
          this.errors.push({
            folderId: contextId,
            message: "Authentication token expired during scan.",
            errorCode: "AUTH_EXPIRED",
            retryable: false
          });
          this.isScanComplete = false;
          return null;
        }

        // 403: Rate limit OR Permission Denied
        if (status === 403) {
          if (errorText.includes("userRateLimitExceeded") || errorText.includes("rateLimitExceeded")) {
            // Transient rate limit -> Retry with backoff
            attempt++;
            const backoffMs = Math.min(16000, Math.pow(2, attempt) * 1000 + Math.random() * 500);
            await this.sleep(backoffMs);
            continue;
          } else {
            // Hard permission denied
            this.errors.push({
              folderId: contextId,
              message: `Permission denied for item ${contextId}: ${errorText}`,
              errorCode: "PERMISSION_DENIED",
              retryable: false
            });
            this.isScanComplete = false;
            return null;
          }
        }

        // 429 or 500/503: Transient server error
        if (status === 429 || status >= 500) {
          attempt++;
          const backoffMs = Math.min(16000, Math.pow(2, attempt) * 1000 + Math.random() * 500);
          await this.sleep(backoffMs);
          continue;
        }

        // Other non-retryable 4xx
        this.errors.push({
          folderId: contextId,
          message: `API HTTP ${status} error: ${errorText}`,
          errorCode: `HTTP_${status}`,
          retryable: false
        });
        this.isScanComplete = false;
        return null;
      } catch (err: any) {
        if (err.name === 'AbortError' || this.signal?.aborted) {
          throw err;
        }
        attempt++;
        if (attempt >= maxRetries) {
          this.errors.push({
            folderId: contextId,
            message: `Network failure after ${maxRetries} attempts: ${err.message || String(err)}`,
            errorCode: "NETWORK_FAILURE",
            retryable: true
          });
          this.isScanComplete = false;
          return null;
        }
        const backoffMs = Math.min(16000, Math.pow(2, attempt) * 1000 + Math.random() * 500);
        await this.sleep(backoffMs);
      }
    }

    return null;
  }

  /**
   * Classifies an item according to Phase 2 rules.
   */
  private classifyItem(item: DriveApiFile, parentRelativePath: string): ScanNode {
    const rawName = item.name || `unnamed_${item.id}`;
    const sanitizedName = rawName.replace(/[\/\0]/g, '_').trim() || `item_${item.id}`;
    const relativePath = parentRelativePath ? `${parentRelativePath}/${sanitizedName}` : sanitizedName;
    const canDownload = item.capabilities?.canDownload ?? true;

    // 1. Folder
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      return {
        id: item.id,
        name: sanitizedName,
        type: 'folder',
        mimeType: item.mimeType,
        canDownload,
        status: canDownload ? 'SUPPORTED' : 'SKIPPED_PERMISSION_DENIED',
        skipReason: canDownload ? undefined : 'Download access restricted by administrator.',
        relativePath
      };
    }

    // 2. Shortcut
    if (item.mimeType === 'application/vnd.google-apps.shortcut') {
      const targetMime = item.shortcutDetails?.targetMimeType;
      const isFolderShortcut = targetMime === 'application/vnd.google-apps.folder';
      const targetId = item.shortcutDetails?.targetId || item.id;

      return {
        id: targetId,
        name: sanitizedName,
        type: isFolderShortcut ? 'folder' : 'shortcut',
        mimeType: item.mimeType,
        canDownload,
        status: 'SUPPORTED',
        relativePath
      };
    }

    // 3. Google Workspace Proprietary Documents
    if (item.mimeType.startsWith('application/vnd.google-apps.')) {
      return {
        id: item.id,
        name: sanitizedName,
        type: 'unsupported',
        mimeType: item.mimeType,
        canDownload: false,
        status: 'SKIPPED_WORKSPACE',
        skipReason: 'Google Workspace document (export required; skipped in Phase 2).',
        relativePath
      };
    }

    // 4. Download Restricted (IRM / View-Only)
    if (!canDownload) {
      return {
        id: item.id,
        name: sanitizedName,
        type: 'file',
        mimeType: item.mimeType,
        canDownload: false,
        status: 'SKIPPED_PERMISSION_DENIED',
        skipReason: 'File owner or organization restricted downloading (view-only).',
        relativePath
      };
    }

    // 5. Standard Binary Media File
    const sizeBytes = item.size ? parseInt(item.size, 10) : undefined;
    return {
      id: item.id,
      name: sanitizedName,
      type: 'file',
      mimeType: item.mimeType,
      sizeBytes,
      md5Checksum: item.md5Checksum,
      modifiedTime: item.modifiedTime,
      canDownload: true,
      status: 'SUPPORTED',
      relativePath
    };
  }

  private disambiguateName(name: string, existing: Map<string, ScanNode>): string {
    if (!existing.has(name)) return name;

    const dotIndex = name.lastIndexOf('.');
    const base = dotIndex > 0 ? name.substring(0, dotIndex) : name;
    const ext = dotIndex > 0 ? name.substring(dotIndex) : '';

    let counter = 1;
    let candidate = `${base} (${counter})${ext}`;
    while (existing.has(candidate)) {
      counter++;
      candidate = `${base} (${counter})${ext}`;
    }
    return candidate;
  }

  private extractFolderId(input: string): string {
    const trimmed = input.trim();
    // Matches drive.google.com/drive/folders/{id} or drive.google.com/drive/u/0/folders/{id}
    const urlMatch = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
    // Matches raw folder ID
    return trimmed;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
