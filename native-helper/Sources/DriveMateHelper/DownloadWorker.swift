import Foundation
import CryptoKit

#if canImport(Darwin)
import Darwin
#endif

public final class DownloadWorker: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    public let item: DownloadFileItem
    public let destinationRoot: URL
    public let skipExisting: Bool
    public let onProgress: @Sendable (Int64, Int64) -> Void
    public let onComplete: @Sendable (Result<FileCompletedEvent, Error>) -> Void
    
    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var fileHandle: FileHandle?
    private var partFileURL: URL
    private var finalFileURL: URL
    
    private var bytesDownloaded: Int64 = 0
    private var totalBytes: Int64 = 0
    private var isRangeResume = false
    private var isCancelled = false
    private var hasResolvedHtmlConfirmation = false
    
    private var md5Hasher = Insecure.MD5()
    private var htmlBuffer = Data()
    private var isHtmlResponse = false
    
    // High-performance 2 MB disk write buffer to eliminate synchronous kernel I/O thrashing
    private var writeBuffer = Data()
    private let writeBufferLimit: Int = 2 * 1024 * 1024
    private var lastProgressReportTime: TimeInterval = 0
    
    public static let RateLimitDomain = "DriveMateRateLimit"
    
    // Anti-Abuse & Rate-Limit Retry Policies
    private var rateLimitRetries = 0
    private let maxRateLimitRetries = 4
    private var networkRetries = 0
    private let maxNetworkRetries = 3
    private var isRetrying = false
    
    private func getDownloadURL(attempt: Int) -> URL? {
        if item.id.hasPrefix("http://") || item.id.hasPrefix("https://") {
            return URL(string: item.id)
        }
        let sanitizedId = item.id.trimmingCharacters(in: .whitespacesAndNewlines)
        let endpointIndex = attempt % 3
        let urlStr: String
        switch endpointIndex {
        case 0:
            urlStr = "https://drive.usercontent.google.com/download?id=\(sanitizedId)&export=download&confirm=t"
        case 1:
            urlStr = "https://drive.google.com/uc?export=download&id=\(sanitizedId)&confirm=t"
        case 2:
            urlStr = "https://drive.google.com/uc?id=\(sanitizedId)&export=download"
        default:
            urlStr = "https://drive.usercontent.google.com/download?id=\(sanitizedId)&export=download&confirm=t"
        }
        return URL(string: urlStr)
    }
    
    private func configureRequestHeaders(_ request: inout URLRequest) {
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
        request.setValue("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8", forHTTPHeaderField: "Accept")
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        request.setValue("gzip, deflate, br", forHTTPHeaderField: "Accept-Encoding")
        request.setValue("\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"", forHTTPHeaderField: "sec-ch-ua")
        request.setValue("?0", forHTTPHeaderField: "sec-ch-ua-mobile")
        request.setValue("\"macOS\"", forHTTPHeaderField: "sec-ch-ua-platform")
        request.setValue("document", forHTTPHeaderField: "Sec-Fetch-Dest")
        request.setValue("navigate", forHTTPHeaderField: "Sec-Fetch-Mode")
        request.setValue("none", forHTTPHeaderField: "Sec-Fetch-Site")
        request.setValue("?1", forHTTPHeaderField: "Sec-Fetch-User")
        request.setValue("1", forHTTPHeaderField: "Upgrade-Insecure-Requests")
    }
    
    private func handleRateLimitOrQuota(statusCode: Int, reason: String) {
        if isCancelled { return }
        
        completionLock.lock()
        if hasCompleted {
            completionLock.unlock()
            return
        }
        completionLock.unlock()
        
        if rateLimitRetries < maxRateLimitRetries {
            isRetrying = true
            closeFileHandle()
            task?.cancel()
            task = nil
            session?.invalidateAndCancel()
            session = nil
            
            rateLimitRetries += 1
            let baseDelay = pow(2.0, Double(rateLimitRetries - 1)) * 2.0
            let jitter = Double.random(in: 0.4...1.2)
            let delay = baseDelay + jitter
            let nextEndpoint = rateLimitRetries % 3
            
            logDiagnostics("[Anti-Abuse Worker] Rate limit/quota (HTTP \(statusCode)) on '\(item.name)'. Silent retry in \(String(format: "%.1f", delay))s with mirror endpoint #\(nextEndpoint) (attempt \(rateLimitRetries)/\(maxRateLimitRetries))...")
            
            DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self = self, !self.isCancelled else { return }
                self.completionLock.lock()
                let alreadyDone = self.hasCompleted
                self.completionLock.unlock()
                guard !alreadyDone else { return }
                self.start()
            }
            return
        }
        
        closeFileHandle()
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        
        let err = NSError(
            domain: DownloadWorker.RateLimitDomain,
            code: statusCode,
            userInfo: [NSLocalizedDescriptionKey: "Google Drive rate limit / quota cooldown needed: \(reason)"]
        )
        completeOnce(.failure(err))
    }
    
    // Thread-safe one-time completion guard
    private let completionLock = NSLock()
    private var hasCompleted = false
    
    private func completeOnce(_ result: Result<FileCompletedEvent, Error>) {
        completionLock.lock()
        defer { completionLock.unlock() }
        guard !hasCompleted else { return }
        hasCompleted = true
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        onComplete(result)
    }
    
    private func checkDiskSpace(neededBytes: Int64) -> Bool {
        guard neededBytes > 0 else { return true }
        // 1. Try standard attributesOfFileSystem (reliable across external SSDs, APFS, HFS+)
        if let fsAttrs = try? FileManager.default.attributesOfFileSystem(forPath: destinationRoot.path),
           let freeSize = fsAttrs[.systemFreeSize] as? Int64 {
            if freeSize > 0 && freeSize < neededBytes {
                return false
            }
        }
        // 2. Fallback to resourceValues
        do {
            let values = try destinationRoot.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeAvailableCapacityKey])
            let available = values.volumeAvailableCapacityForImportantUsage ?? (values.volumeAvailableCapacity.map { Int64($0) }) ?? 0
            if available > 0 && available < neededBytes {
                return false
            }
        } catch {}
        return true
    }
    
    public init(
        item: DownloadFileItem,
        destinationRoot: URL,
        skipExisting: Bool = true,
        onProgress: @escaping @Sendable (Int64, Int64) -> Void,
        onComplete: @escaping @Sendable (Result<FileCompletedEvent, Error>) -> Void
    ) {
        self.item = item
        self.destinationRoot = destinationRoot
        self.skipExisting = skipExisting
        self.onProgress = onProgress
        self.onComplete = onComplete
        
        // Sanitize path to prevent directory traversal
        let sanitizedRel = DownloadWorker.sanitizeRelativePath(item.relativePath)
        self.finalFileURL = destinationRoot.appendingPathComponent(sanitizedRel)
        self.partFileURL = destinationRoot.appendingPathComponent(sanitizedRel + ".part")
        
        super.init()
    }
    
    public static func sanitizeRelativePath(_ relPath: String) -> String {
        var components = relPath.components(separatedBy: "/")
        // Filter out empty components, ".", and ".." to strictly prevent traversal
        components = components.filter { $0 != "." && $0 != ".." && !$0.isEmpty }
        if components.isEmpty {
            return "downloaded_file"
        }
        return components.joined(separator: "/")
    }
    
    private func computeMD5(of fileURL: URL) -> String? {
        var fileHasher = Insecure.MD5()
        guard let readHandle = try? FileHandle(forReadingFrom: fileURL) else { return nil }
        defer { try? readHandle.close() }
        while let chunk = try? readHandle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
            fileHasher.update(data: chunk)
        }
        let digest = fileHasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }
    
    public func start() {
        guard !isCancelled else { return }
        
        // Strict boundary check: ensure destination path does not escape destinationRoot
        let standardizedFinal = finalFileURL.standardizedFileURL.path
        let standardizedRoot = destinationRoot.standardizedFileURL.path
        guard standardizedFinal.hasPrefix(standardizedRoot) else {
            completeOnce(.failure(NSError(domain: "DriveMate", code: 403, userInfo: [NSLocalizedDescriptionKey: "Security violation: File path escapes destination root."])))
            return
        }
        
        // 0. Check if destination file already exists with matching size (Skip redundant download)
        if skipExisting && FileManager.default.fileExists(atPath: finalFileURL.path) {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: finalFileURL.path),
               let existingSize = attrs[.size] as? Int64, existingSize > 0 {
                
                // A. Check reliable prior completion manifest
                if let manifestEntry = CompletionManifest.lookup(destinationRoot: destinationRoot, relativePath: item.relativePath, fileId: item.id),
                   manifestEntry.size == existingSize {
                    logDiagnostics("File '\(item.name)' previously completed with matching size (\(existingSize) bytes) per completion manifest. Skipping re-download.")
                    if FileManager.default.fileExists(atPath: partFileURL.path) {
                        try? FileManager.default.removeItem(at: partFileURL)
                    }
                    let completedEvent = FileCompletedEvent(
                        action: "FILE_COMPLETED",
                        jobId: "",
                        fileId: item.id,
                        name: item.name,
                        relativePath: item.relativePath,
                        bytesWritten: existingSize,
                        md5Checksum: manifestEntry.md5Checksum,
                        verified: manifestEntry.verified
                    )
                    onProgress(existingSize, existingSize)
                    completeOnce(.success(completedEvent))
                    return
                }
                
                // B. Check authoritative source expected size (if provided)
                if let expected = item.expectedSize, expected > 0 {
                    if existingSize == expected {
                        var isVerified = false
                        if let expectedMd5 = item.md5Checksum, !expectedMd5.isEmpty {
                            if let hash = computeMD5(of: finalFileURL) {
                                if hash.lowercased() == expectedMd5.lowercased() {
                                    isVerified = true
                                } else {
                                    logDiagnostics("Existing file '\(item.name)' has matching size but corrupted MD5. Re-downloading.")
                                    try? FileManager.default.removeItem(at: finalFileURL)
                                    // continue to network download
                                }
                            }
                        } else {
                            isVerified = true
                        }
                        
                        if isVerified || item.md5Checksum == nil || item.md5Checksum?.isEmpty == true {
                            logDiagnostics("File '\(item.name)' already exists with matching size (\(existingSize) bytes) in destination. Skipping re-download.")
                            if FileManager.default.fileExists(atPath: partFileURL.path) {
                                try? FileManager.default.removeItem(at: partFileURL)
                            }
                            CompletionManifest.recordCompletion(
                                destinationRoot: destinationRoot,
                                item: item,
                                bytesWritten: existingSize,
                                md5Checksum: item.md5Checksum,
                                verified: isVerified
                            )
                            let completedEvent = FileCompletedEvent(
                                action: "FILE_COMPLETED",
                                jobId: "",
                                fileId: item.id,
                                name: item.name,
                                relativePath: item.relativePath,
                                bytesWritten: existingSize,
                                md5Checksum: item.md5Checksum,
                                verified: isVerified
                            )
                            onProgress(existingSize, existingSize)
                            completeOnce(.success(completedEvent))
                            return
                        }
                    }
                } else {
                    // C. Expected size is unknown upfront (expectedSize == nil || expectedSize == 0)
                    // Check file format validation
                    let validation = FileFormatValidator.validate(url: finalFileURL)
                    if validation.isValid {
                        logDiagnostics("File '\(item.name)' verified on disk via \(validation.formatName) container validation (\(existingSize) bytes). Skipping re-download.")
                        if FileManager.default.fileExists(atPath: partFileURL.path) {
                            try? FileManager.default.removeItem(at: partFileURL)
                        }
                        CompletionManifest.recordCompletion(
                            destinationRoot: destinationRoot,
                            item: item,
                            bytesWritten: existingSize,
                            md5Checksum: item.md5Checksum,
                            verified: true
                        )
                        let completedEvent = FileCompletedEvent(
                            action: "FILE_COMPLETED",
                            jobId: "",
                            fileId: item.id,
                            name: item.name,
                            relativePath: item.relativePath,
                            bytesWritten: existingSize,
                            md5Checksum: item.md5Checksum,
                            verified: true
                        )
                        onProgress(existingSize, existingSize)
                        completeOnce(.success(completedEvent))
                        return
                    }
                }
            }
        }
        
        // Ensure parent directory exists
        let parentDir = partFileURL.deletingLastPathComponent()
        do {
            try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true, attributes: nil)
        } catch {
            completeOnce(.failure(error))
            return
        }
        
        // Check existing .part file size for resumption
        var existingSize: Int64 = 0
        if let attrs = try? FileManager.default.attributesOfItem(atPath: partFileURL.path),
           let fileSize = attrs[.size] as? Int64 {
            if let expected = item.expectedSize, expected > 0 && fileSize > expected {
                // Part file is oversized/corrupted, delete and restart cleanly
                logDiagnostics("Part file '\(partFileURL.lastPathComponent)' is larger than expected size (\(fileSize) > \(expected)). Restarting from 0.")
                try? FileManager.default.removeItem(at: partFileURL)
                existingSize = 0
            } else {
                existingSize = fileSize
            }
        }
        
        let bytesNeeded = max(0, (item.expectedSize ?? 0) - existingSize)
        if bytesNeeded > 0 && !checkDiskSpace(neededBytes: bytesNeeded) {
            completeOnce(.failure(NSError(domain: "DriveMate", code: 507, userInfo: [NSLocalizedDescriptionKey: "Insufficient disk space on destination volume. Need \(bytesNeeded) bytes, but space is exhausted."])))
            return
        }
        
        self.bytesDownloaded = existingSize
        self.totalBytes = item.expectedSize ?? 0
        self.isRetrying = false
        
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        isHtmlResponse = false
        htmlBuffer.removeAll()
        hasResolvedHtmlConfirmation = false
        
        guard let url = getDownloadURL(attempt: rateLimitRetries) else {
            completeOnce(.failure(NSError(domain: "DriveMate", code: 400, userInfo: [NSLocalizedDescriptionKey: "Invalid file URL"])))
            return
        }
        
        var request = URLRequest(url: url)
        configureRequestHeaders(&request)
        
        if existingSize > 0 {
            request.setValue("bytes=\(existingSize)-", forHTTPHeaderField: "Range")
            isRangeResume = true
        } else {
            isRangeResume = false
        }
        
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 64
        config.timeoutIntervalForRequest = 60.0
        config.timeoutIntervalForResource = 7200.0
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.urlCache = nil
        config.networkServiceType = .responsiveData
        config.httpShouldUsePipelining = true
        self.session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        
        let task = session?.dataTask(with: request)
        self.task = task
        task?.resume()
    }
    
    public func cancel() {
        isCancelled = true
        task?.cancel()
        writeBuffer.removeAll()
        closeFileHandle()
    }
    
    // MARK: - URLSessionDataDelegate
    
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let httpResponse = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            completeOnce(.failure(NSError(domain: "DriveMate", code: 500, userInfo: [NSLocalizedDescriptionKey: "Non-HTTP response received"])))
            return
        }
        
        let statusCode = httpResponse.statusCode
        
        // 1. Check HTTP Status
        if statusCode == 404 {
            completionHandler(.cancel)
            completeOnce(.failure(NSError(domain: "DriveMate", code: 404, userInfo: [NSLocalizedDescriptionKey: "File is inaccessible or private (HTTP 404)"])))
            return
        }
        
        if statusCode == 403 || statusCode == 429 {
            completionHandler(.cancel)
            handleRateLimitOrQuota(statusCode: statusCode, reason: statusCode == 429 ? "HTTP 429 Too Many Requests" : "HTTP 403 Quota / Rate Limited")
            return
        }
        
        if statusCode >= 500 && statusCode <= 504 {
            completionHandler(.cancel)
            handleRateLimitOrQuota(statusCode: statusCode, reason: "Google Drive server temporary error (HTTP \(statusCode))")
            return
        }
        
        if statusCode >= 400 && statusCode != 416 {
            completionHandler(.cancel)
            completeOnce(.failure(NSError(domain: "DriveMate", code: statusCode, userInfo: [NSLocalizedDescriptionKey: "Google Drive download error (HTTP \(statusCode))"])))
            return
        }
        
        if statusCode == 416 {
            // Range Not Satisfiable
            completionHandler(.cancel)
            // If already complete, finalize
            if let expected = item.expectedSize, bytesDownloaded >= expected {
                finalizeFile()
            } else {
                // Restart from 0
                restartFromZero()
            }
            return
        }
        
        // 2. Check Content-Type for HTML (Virus confirmation / quota error)
        let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
        if (statusCode == 200 || statusCode == 206) && contentType.contains("text/html") {
            isHtmlResponse = true
            htmlBuffer.removeAll()
            completionHandler(.allow)
            return
        } else {
            isHtmlResponse = false
        }
        
        // 3. Determine Content-Length & Check skipExisting BEFORE allocating local .part files
        var receivedContentLength: Int64 = 0
        if let clStr = httpResponse.value(forHTTPHeaderField: "Content-Length"), let cl = Int64(clStr) {
            receivedContentLength = cl
            if statusCode == 206 {
                self.totalBytes = bytesDownloaded + cl
            } else {
                self.totalBytes = cl
            }
        }
        
        // Check if destination file already exists with matching Content-Length
        if skipExisting && FileManager.default.fileExists(atPath: finalFileURL.path),
           receivedContentLength > 0,
           let attrs = try? FileManager.default.attributesOfItem(atPath: finalFileURL.path),
           let existingSize = attrs[.size] as? Int64,
           existingSize == receivedContentLength {
            logDiagnostics("File '\(item.name)' already exists with matching Content-Length (\(existingSize) bytes). Skipping re-download.")
            isCancelled = true
            completionHandler(.cancel)
            closeFileHandle()
            if FileManager.default.fileExists(atPath: partFileURL.path) {
                try? FileManager.default.removeItem(at: partFileURL)
            }
            CompletionManifest.recordCompletion(
                destinationRoot: destinationRoot,
                item: item,
                bytesWritten: existingSize,
                md5Checksum: item.md5Checksum,
                verified: true
            )
            let completedEvent = FileCompletedEvent(
                action: "FILE_COMPLETED",
                jobId: "",
                fileId: item.id,
                name: item.name,
                relativePath: item.relativePath,
                bytesWritten: existingSize,
                md5Checksum: item.md5Checksum,
                verified: true
            )
            onProgress(existingSize, existingSize)
            completeOnce(.success(completedEvent))
            return
        }
        
        // 4. Handle Range Resumption / File Initialization (only for non-skipped files)
        if statusCode == 206 {
            // Validate Content-Range: bytes {start}-{end}/{total}
            if let contentRange = httpResponse.value(forHTTPHeaderField: "Content-Range") {
                let rangeValid = validateContentRange(contentRange, expectedStart: bytesDownloaded)
                if rangeValid {
                    // Open existing file in append mode
                    if let handle = try? FileHandle(forWritingTo: partFileURL) {
                        handle.seekToEndOfFile()
                        self.fileHandle = handle
                    } else {
                        restartFromZero()
                        completionHandler(.cancel)
                        return
                    }
                } else {
                    // Range mismatch -> Restart safely from 0
                    restartFromZero()
                    completionHandler(.cancel)
                    return
                }
            }
        } else if statusCode == 200 {
            // Server returned 200 instead of 206! Range was ignored.
            // DO NOT append! Truncate to 0 and start cleanly.
            self.bytesDownloaded = 0
            FileManager.default.createFile(atPath: partFileURL.path, contents: nil, attributes: nil)
            self.fileHandle = try? FileHandle(forWritingTo: partFileURL)
        }
        
        completionHandler(.allow)
    }
    
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !isCancelled else { return }
        
        if isHtmlResponse {
            // Buffer HTML response to inspect confirmation form
            htmlBuffer.append(data)
            return
        }
        
        // High-speed write buffering: collect chunks in memory before flushing
        writeBuffer.append(data)
        bytesDownloaded += Int64(data.count)
        md5Hasher.update(data: data)
        
        if writeBuffer.count >= writeBufferLimit {
            flushWriteBuffer()
        }
        
        let now = Date().timeIntervalSince1970
        if now - lastProgressReportTime >= 0.1 {
            lastProgressReportTime = now
            onProgress(bytesDownloaded, totalBytes)
        }
    }
    
    private func flushWriteBuffer() {
        guard !writeBuffer.isEmpty else { return }
        fileHandle?.write(writeBuffer)
        writeBuffer.removeAll(keepingCapacity: true)
    }
    
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        closeFileHandle()
        
        if isCancelled || hasCompleted || isRetrying {
            return
        }
        
        if let error = error {
            let nsErr = error as NSError
            if nsErr.domain == NSURLErrorDomain && nsErr.code == NSURLErrorCancelled {
                // Cancelled due to intentional backoff/retry or teardown
                return
            }
            
            let isTransient = nsErr.domain == NSURLErrorDomain && (
                nsErr.code == NSURLErrorTimedOut ||
                nsErr.code == NSURLErrorNetworkConnectionLost ||
                nsErr.code == NSURLErrorCannotConnectToHost ||
                nsErr.code == NSURLErrorDNSLookupFailed ||
                nsErr.code == -1005 || // connection reset by peer
                nsErr.code == -1001    // request timed out
            )
            if isTransient && networkRetries < maxNetworkRetries && !isCancelled {
                isRetrying = true
                networkRetries += 1
                let delay = Double(networkRetries) * 2.0 + Double.random(in: 0.3...1.0)
                logDiagnostics("Transient network drop on '\(item.name)': \(nsErr.localizedDescription). Retrying in \(String(format: "%.1f", delay))s (attempt \(networkRetries)/\(maxNetworkRetries))...")
                DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
                    guard let self = self, !self.isCancelled else { return }
                    self.completionLock.lock()
                    let alreadyDone = self.hasCompleted
                    self.completionLock.unlock()
                    guard !alreadyDone else { return }
                    self.start()
                }
                return
            }
            if isTransient {
                let err = NSError(
                    domain: DownloadWorker.RateLimitDomain,
                    code: 503,
                    userInfo: [NSLocalizedDescriptionKey: "Network connection reset or timed out by Google CDN: \(nsErr.localizedDescription)"]
                )
                completeOnce(.failure(err))
                return
            }
            completeOnce(.failure(error))
            return
        }
        
        if isHtmlResponse {
            // Parse HTML for confirmation or error
            handleHtmlContent(htmlBuffer)
            return
        }
        
        flushWriteBuffer()
        onProgress(bytesDownloaded, totalBytes)
        finalizeFile()
    }
    
    // MARK: - Safe Finalization & Integrity Validation
    
    private func finalizeFile() {
        closeFileHandle()
        
        // 1. Verify byte size if expected size was known
        if let expected = item.expectedSize, expected > 0 {
            if bytesDownloaded != expected {
                let err = NSError(
                    domain: "DriveMate",
                    code: 422,
                    userInfo: [NSLocalizedDescriptionKey: "Integrity check failed: Expected \(expected) bytes, but downloaded \(bytesDownloaded) bytes."]
                )
                completeOnce(.failure(err))
                return
            }
        }
        
        // 2. Compute MD5 checksum by streaming from .part file on disk
        var fileHasher = Insecure.MD5()
        if let readHandle = try? FileHandle(forReadingFrom: partFileURL) {
            while let chunk = try? readHandle.read(upToCount: 1024 * 1024), !chunk.isEmpty {
                fileHasher.update(data: chunk)
            }
            try? readHandle.close()
        } else {
            fileHasher = md5Hasher
        }
        let computedDigest = fileHasher.finalize()
        let computedChecksum = computedDigest.map { String(format: "%02x", $0) }.joined()
        
        // If source provided expected MD5, verify
        var isVerified = false
        if let expectedMd5 = item.md5Checksum, !expectedMd5.isEmpty {
            if computedChecksum.lowercased() != expectedMd5.lowercased() {
                let err = NSError(
                    domain: "DriveMate",
                    code: 422,
                    userInfo: [NSLocalizedDescriptionKey: "Integrity check failed: MD5 mismatch (expected \(expectedMd5), got \(computedChecksum))."]
                )
                completeOnce(.failure(err))
                return
            }
            isVerified = true
        }
        
        // 3. Collision Resolution & Safe Atomic Replacement
        let fileManager = FileManager.default
        let targetDestination = finalFileURL
        
        // Safety guard: ensure the temporary part file actually exists on disk before trying to finalize
        guard fileManager.fileExists(atPath: partFileURL.path) else {
            let err = NSError(
                domain: "DriveMate",
                code: 404,
                userInfo: [NSLocalizedDescriptionKey: "Download failed: Server did not write file content for '\(item.name)' (Google Drive stream unavailable or rate limited)."]
            )
            completeOnce(.failure(err))
            return
        }
        
        // Safety guard: prevent moving 0-byte corrupt files when actual content was expected
        let partAttrs = try? fileManager.attributesOfItem(atPath: partFileURL.path)
        let actualSize = (partAttrs?[.size] as? Int64) ?? bytesDownloaded
        if actualSize == 0 && (item.expectedSize ?? 1) > 0 {
            try? fileManager.removeItem(at: partFileURL)
            handleRateLimitOrQuota(statusCode: 429, reason: "0 bytes received (Google Drive stream throttled)")
            return
        }
        
        // Ensure destination directory exists
        try? fileManager.createDirectory(at: targetDestination.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
        
        if fileManager.fileExists(atPath: targetDestination.path) {
            let existingAttrs = try? fileManager.attributesOfItem(atPath: targetDestination.path)
            let existingSize = (existingAttrs?[.size] as? Int64) ?? -1
            let partSize = actualSize
            
            if existingSize == partSize && existingSize > 0 {
                var identical = true
                if let expectedMd5 = item.md5Checksum, !expectedMd5.isEmpty {
                    if let existingHash = computeMD5(of: targetDestination),
                       existingHash.lowercased() != expectedMd5.lowercased() {
                        identical = false
                    }
                }
                if identical {
                    logDiagnostics("Target file '\(targetDestination.lastPathComponent)' is already identical (\(existingSize) bytes). Discarding redundant .part file.")
                    try? fileManager.removeItem(at: partFileURL)
                    CompletionManifest.recordCompletion(
                        destinationRoot: destinationRoot,
                        item: item,
                        bytesWritten: existingSize,
                        md5Checksum: computedChecksum,
                        verified: isVerified
                    )
                    let completedEvent = FileCompletedEvent(
                        action: "FILE_COMPLETED",
                        jobId: "",
                        fileId: item.id,
                        name: item.name,
                        relativePath: item.relativePath,
                        bytesWritten: existingSize,
                        md5Checksum: computedChecksum,
                        verified: isVerified
                    )
                    completeOnce(.success(completedEvent))
                    return
                }
            }
            
            // Existing file has different size or corrupt hash:
            // Safely replace using atomic replaceItemAt where supported
            do {
                _ = try fileManager.replaceItemAt(targetDestination, withItemAt: partFileURL, backupItemName: nil, options: .withoutDeletingBackupItem)
                logDiagnostics("Safely replaced destination file '\(targetDestination.lastPathComponent)' with validated download.")
            } catch {
                // Safe backup and swap fallback
                let backupURL = targetDestination.deletingLastPathComponent().appendingPathComponent(".backup_\(UUID().uuidString)_\(targetDestination.lastPathComponent)")
                do {
                    try fileManager.moveItem(at: targetDestination, to: backupURL)
                    try fileManager.moveItem(at: partFileURL, to: targetDestination)
                    try? fileManager.removeItem(at: backupURL)
                } catch {
                    if fileManager.fileExists(atPath: backupURL.path) && !fileManager.fileExists(atPath: targetDestination.path) {
                        try? fileManager.moveItem(at: backupURL, to: targetDestination)
                    }
                    completeOnce(.failure(error))
                    return
                }
            }
        } else {
            do {
                try fileManager.createDirectory(at: targetDestination.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: nil)
                try fileManager.moveItem(at: partFileURL, to: targetDestination)
            } catch {
                completeOnce(.failure(error))
                return
            }
        }
        
        CompletionManifest.recordCompletion(
            destinationRoot: destinationRoot,
            item: item,
            bytesWritten: bytesDownloaded,
            md5Checksum: computedChecksum,
            verified: isVerified
        )
        
        let event = FileCompletedEvent(
            action: "FILE_COMPLETED",
            jobId: "",
            fileId: item.id,
            name: targetDestination.lastPathComponent,
            relativePath: item.relativePath,
            bytesWritten: bytesDownloaded,
            md5Checksum: computedChecksum,
            verified: isVerified
        )
        completeOnce(.success(event))
    }
    
    private func resolveCollision(originalURL: URL) -> URL {
        let dir = originalURL.deletingLastPathComponent()
        let baseName = originalURL.deletingPathExtension().lastPathComponent
        let ext = originalURL.pathExtension
        let extSuffix = ext.isEmpty ? "" : ".\(ext)"
        
        var counter = 1
        var candidate = dir.appendingPathComponent("\(baseName) (\(counter))\(extSuffix)")
        while FileManager.default.fileExists(atPath: candidate.path) {
            counter += 1
            candidate = dir.appendingPathComponent("\(baseName) (\(counter))\(extSuffix)")
        }
        return candidate
    }
    
    private func validateContentRange(_ contentRange: String, expectedStart: Int64) -> Bool {
        // Format: bytes {start}-{end}/{total}
        let parts = contentRange.components(separatedBy: " ")
        guard parts.count == 2, parts[0] == "bytes" else { return false }
        let subparts = parts[1].components(separatedBy: "/")
        guard subparts.count == 2 else { return false }
        let rangeSpan = subparts[0].components(separatedBy: "-")
        guard rangeSpan.count == 2, let start = Int64(rangeSpan[0]) else { return false }
        return start == expectedStart
    }
    
    private func restartFromZero() {
        writeBuffer.removeAll()
        closeFileHandle()
        bytesDownloaded = 0
        md5Hasher = Insecure.MD5()
        FileManager.default.createFile(atPath: partFileURL.path, contents: nil, attributes: nil)
        start()
    }
    
    private func closeFileHandle() {
        flushWriteBuffer()
        try? fileHandle?.synchronize()
        try? fileHandle?.close()
        fileHandle = nil
    }
    
    // MARK: - HTML Response & Virus Scan Confirmation Handler
    
    private func handleHtmlContent(_ data: Data) {
        guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .ascii) else {
            completeOnce(.failure(NSError(domain: "DriveMate", code: 422, userInfo: [NSLocalizedDescriptionKey: "Received non-binary text response that could not be parsed."])))
            return
        }
        
        // 1. Quota exceeded error
        if html.contains("uc-error-subcaption") {
            let reason = extractErrorSubcaption(html) ?? "Too many users have viewed or downloaded this file recently."
            
            // Check if unverified destination file exists on disk
            if FileManager.default.fileExists(atPath: finalFileURL.path),
               let attrs = try? FileManager.default.attributesOfItem(atPath: finalFileURL.path),
               let existingSize = attrs[.size] as? Int64, existingSize > 0 {
                if let expected = item.expectedSize, expected > 0 && existingSize == expected {
                    logDiagnostics("Destination file exists with matching size (\(existingSize) bytes) despite quota warning. Verifying existing file.")
                    let completedEvent = FileCompletedEvent(
                        action: "FILE_COMPLETED",
                        jobId: "",
                        fileId: item.id,
                        name: item.name,
                        relativePath: item.relativePath,
                        bytesWritten: existingSize,
                        md5Checksum: item.md5Checksum,
                        verified: true
                    )
                    completeOnce(.success(completedEvent))
                    return
                }
            }
            
            handleRateLimitOrQuota(statusCode: 429, reason: "Google Drive Quota Exceeded: \(reason)")
            return
        }
        
        // 2. Sign in required
        if html.contains("accounts.google.com/ServiceLogin") || html.contains("Sign in - Google Accounts") {
            completeOnce(.failure(NSError(domain: "DriveMate", code: 401, userInfo: [NSLocalizedDescriptionKey: "Authentication required to download this file (private file)."])))
            return
        }
        
        // 3. Virus scan confirmation form
        if !hasResolvedHtmlConfirmation, let confirmationUrl = extractConfirmationUrl(html) {
            hasResolvedHtmlConfirmation = true
            isHtmlResponse = false
            htmlBuffer.removeAll()
            
            // Follow confirmation URL
            var request = URLRequest(url: confirmationUrl)
            configureRequestHeaders(&request)
            
            let task = session?.dataTask(with: request)
            self.task = task
            task?.resume()
            return
        }
        
        // 4. Rate-limiting HTML interstitial fallback
        handleRateLimitOrQuota(statusCode: 429, reason: "Anti-abuse HTML notice returned by Google CDN")
    }
    
    private func extractErrorSubcaption(_ html: String) -> String? {
        if let range = html.range(of: "<p class=\"uc-error-subcaption\">") {
            let after = html[range.upperBound...]
            if let endRange = after.range(of: "</p>") {
                return String(after[..<endRange.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        return nil
    }
    
    private func extractConfirmationUrl(_ html: String) -> URL? {
        // Look for #download-form or /uc?export=download with confirm tokens
        if let hrefRange = html.range(of: "href=\"(/uc\\?export=download[^\"]+)\"", options: .regularExpression) {
            var raw = String(html[hrefRange])
            raw = raw.replacingOccurrences(of: "href=\"", with: "").replacingOccurrences(of: "\"", with: "")
            raw = raw.replacingOccurrences(of: "&amp;", with: "&")
            return URL(string: "https://drive.google.com" + raw)
        }
        
        // Look for form action
        if let actionRange = html.range(of: "action=[\"']([^\"']+)[\"']", options: .regularExpression) {
            var rawAction = String(html[actionRange])
            rawAction = rawAction.replacingOccurrences(of: "action=\"", with: "")
                .replacingOccurrences(of: "action='", with: "")
                .replacingOccurrences(of: "\"", with: "")
                .replacingOccurrences(of: "'", with: "")
            rawAction = rawAction.replacingOccurrences(of: "&amp;", with: "&")
            
            // Extract hidden inputs (handling both name...value and value...name in any quote style)
            var queryItems: [URLQueryItem] = []
            let tagRegex = try? NSRegularExpression(pattern: "<input\\s+[^>]*>", options: .caseInsensitive)
            if let tagRegex = tagRegex {
                let nsHtml = html as NSString
                let tagMatches = tagRegex.matches(in: html, options: [], range: NSRange(location: 0, length: nsHtml.length))
                for tagMatch in tagMatches {
                    let tagStr = nsHtml.substring(with: tagMatch.range)
                    var extractedName: String?
                    var extractedValue: String?
                    
                    if let nameMatch = tagStr.range(of: "name=[\"']([^\"']+)[\"']", options: .regularExpression) {
                        var n = String(tagStr[nameMatch])
                        n = n.replacingOccurrences(of: "name=\"", with: "")
                            .replacingOccurrences(of: "name='", with: "")
                            .replacingOccurrences(of: "\"", with: "")
                            .replacingOccurrences(of: "'", with: "")
                        extractedName = n
                    }
                    if let valMatch = tagStr.range(of: "value=[\"']([^\"']*)[\"']", options: .regularExpression) {
                        var v = String(tagStr[valMatch])
                        v = v.replacingOccurrences(of: "value=\"", with: "")
                            .replacingOccurrences(of: "value='", with: "")
                            .replacingOccurrences(of: "\"", with: "")
                            .replacingOccurrences(of: "'", with: "")
                        extractedValue = v
                    }
                    
                    if let name = extractedName, let value = extractedValue, name.lowercased() != "submit" {
                        queryItems.append(URLQueryItem(name: name, value: value))
                    }
                }
            }
            
            let baseURL = task?.currentRequest?.url ?? URL(string: "https://drive.google.com")!
            let resolvedURL = URL(string: rawAction, relativeTo: baseURL)?.absoluteURL ?? baseURL
            
            if var components = URLComponents(url: resolvedURL, resolvingAgainstBaseURL: true) {
                var currentItems = components.queryItems ?? []
                currentItems.append(contentsOf: queryItems)
                components.queryItems = currentItems
                return components.url
            }
        }
        
        return nil
    }
}
