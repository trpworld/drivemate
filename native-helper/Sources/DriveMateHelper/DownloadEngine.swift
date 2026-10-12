import Foundation

public final class DownloadEngine: @unchecked Sendable {
    public static let shared = DownloadEngine()
    
    private let queue = DispatchQueue(label: "com.drivemate.engine", qos: .userInitiated)
    private var activeWorkers: [String: DownloadWorker] = [:] // workerKey -> worker
    private var activeWorkerBytes: [String: Int64] = [:] // workerKey -> bytes downloaded
    private var fileKnownSizes: [String: Int64] = [:] // fileId -> known size
    private var completedFileKeys: Set<String> = []
    private var failedFileKeys: Set<String> = []
    
    private var currentJobId: String?
    private var destinationRoot: URL?
    private var filesQueue: [DownloadFileItem] = []
    private var queueIndex: Int = 0
    private var inFlightRetryQueue: [DownloadFileItem] = []
    private var configuredConcurrency: Int = 16
    private var effectiveConcurrency: Int = 16
    private var consecutiveRateLimitCount: Int = 0
    private var consecutiveSuccessCount: Int = 0
    private var circuitBreakerCooldownUntil: TimeInterval = 0
    private var fileRequeueCycles: [String: Int] = [:]
    private let maxRequeueCycles = 5
    private var skipExisting: Bool = true
    
    private var isPaused = false
    private var isStopped = false
    
    private var totalFiles = 0
    private var completedCount = 0
    private var failedCount = 0
    private var skippedCount = 0
    
    private var completedBytesTotal: Int64 = 0
    private var overallBytesDownloaded: Int64 = 0
    private var overallTotalBytes: Int64 = 0
    private var knownSizesSum: Int64 = 0
    
    private var lastSpeedCheckTime: TimeInterval = 0
    private var lastBytesCount: Int64 = 0
    private var currentSpeedBps: Double = 0
    
    private init() {}
    
    public func startJob(
        jobId: String,
        destinationPath: String,
        concurrency: Int,
        skipExisting: Bool = true,
        files: [DownloadFileItem],
        totalFilesExpected: Int? = nil,
        onEvent: @escaping @Sendable (OutboundMessage) -> Void
    ) {
        queue.async {
            self.currentJobId = jobId
            self.destinationRoot = URL(fileURLWithPath: destinationPath, isDirectory: true)
            self.skipExisting = skipExisting
            // Concurrency: up to 32 streams, default 16
            self.configuredConcurrency = max(1, min(32, concurrency > 0 ? concurrency : 16))
            self.effectiveConcurrency = self.configuredConcurrency
            self.consecutiveRateLimitCount = 0
            self.consecutiveSuccessCount = 0
            self.circuitBreakerCooldownUntil = 0
            self.fileRequeueCycles.removeAll()
            self.filesQueue = files
            self.queueIndex = 0
            self.inFlightRetryQueue.removeAll()
            self.isPaused = false
            self.isStopped = false
            
            self.totalFiles = max(totalFilesExpected ?? files.count, files.count)
            self.completedFileKeys.removeAll()
            self.failedFileKeys.removeAll()
            self.completedCount = 0
            self.failedCount = 0
            self.skippedCount = 0
            self.activeWorkers.removeAll()
            self.activeWorkerBytes.removeAll()
            self.fileKnownSizes.removeAll()
            self.completedBytesTotal = 0
            self.knownSizesSum = 0
            self.overallBytesDownloaded = 0
            
            for f in files {
                if let exp = f.expectedSize, exp > 0 {
                    self.fileKnownSizes[f.id] = exp
                    self.knownSizesSum += exp
                }
            }
            if self.fileKnownSizes.count == self.totalFiles && self.totalFiles > 0 {
                self.overallTotalBytes = self.knownSizesSum
            } else {
                self.overallTotalBytes = 0
            }
            self.lastSpeedCheckTime = Date().timeIntervalSince1970
            self.lastBytesCount = 0
            self.currentSpeedBps = 0
            
            logDiagnostics("Starting download job \(jobId): \(files.count) files, destination: \(destinationPath), concurrency: \(self.effectiveConcurrency) (anti-abuse paced)")
            
            self.scheduleNextBatches(onEvent: onEvent)
        }
    }
    
    public func appendFiles(
        jobId: String,
        files: [DownloadFileItem],
        onEvent: @escaping @Sendable (OutboundMessage) -> Void
    ) {
        queue.async {
            guard self.currentJobId == jobId, !self.isStopped else { return }
            self.filesQueue.append(contentsOf: files)
            self.totalFiles = max(self.totalFiles, self.filesQueue.count)
            for f in files {
                if let exp = f.expectedSize, exp > 0 {
                    let prev = self.fileKnownSizes[f.id] ?? 0
                    self.fileKnownSizes[f.id] = exp
                    self.knownSizesSum += (exp - prev)
                }
            }
            if self.fileKnownSizes.count == self.totalFiles && self.totalFiles > 0 {
                self.overallTotalBytes = max(self.knownSizesSum, self.overallBytesDownloaded)
            }
            logDiagnostics("Appended \(files.count) files to job \(jobId). Total files: \(self.totalFiles)")
            self.scheduleNextBatches(onEvent: onEvent)
        }
    }
    
    public func pauseJob(jobId: String, onEvent: @escaping @Sendable (OutboundMessage) -> Void) {
        queue.async {
            guard self.currentJobId == jobId else {
                let err = OutboundMessage(
                    status: "ERROR",
                    action: "JOB_PAUSED",
                    error: "Job \(jobId) is not currently active.",
                    jobId: jobId
                )
                onEvent(err)
                return
            }
            self.isPaused = true
            logDiagnostics("Pausing job \(jobId). Active downloads checkpointing.")
            
            for worker in self.activeWorkers.values {
                self.inFlightRetryQueue.append(worker.item)
                worker.cancel()
            }
            self.activeWorkers.removeAll()
            self.activeWorkerBytes.removeAll()
            
            if let dest = self.destinationRoot {
                CompletionManifest.flush(destinationRoot: dest)
            }
            
            let msg = OutboundMessage(
                status: "SUCCESS",
                action: "JOB_PAUSED",
                jobId: jobId
            )
            onEvent(msg)
        }
    }
    
    public func resumeJob(jobId: String, onEvent: @escaping @Sendable (OutboundMessage) -> Void) {
        queue.async {
            guard self.currentJobId == jobId else { return }
            self.isPaused = false
            self.isStopped = false
            logDiagnostics("Resuming job \(jobId).")
            
            let msg = OutboundMessage(
                status: "SUCCESS",
                action: "JOB_RESUMED",
                jobId: jobId
            )
            onEvent(msg)
            
            self.scheduleNextBatches(onEvent: onEvent)
        }
    }
    
    public func stopJob(jobId: String, onEvent: @escaping @Sendable (OutboundMessage) -> Void) {
        queue.async {
            guard self.currentJobId == jobId else { return }
            self.isStopped = true
            self.isPaused = false
            logDiagnostics("Stopping job \(jobId).")
            
            for worker in self.activeWorkers.values {
                worker.cancel()
            }
            self.activeWorkers.removeAll()
            self.activeWorkerBytes.removeAll()
            self.filesQueue.removeAll()
            self.inFlightRetryQueue.removeAll()
            self.queueIndex = 0
            
            if let dest = self.destinationRoot {
                CompletionManifest.flush(destinationRoot: dest)
            }
            
            let msg = OutboundMessage(
                status: "SUCCESS",
                action: "JOB_STOPPED",
                jobId: jobId
            )
            onEvent(msg)
        }
    }
    
    private func scheduleNextBatches(onEvent: @escaping @Sendable (OutboundMessage) -> Void) {
        guard !isPaused && !isStopped else { return }
        guard let destRoot = destinationRoot, let jId = currentJobId else { return }
        
        let now = Date().timeIntervalSince1970
        if now < circuitBreakerCooldownUntil {
            let delay = circuitBreakerCooldownUntil - now
            queue.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.scheduleNextBatches(onEvent: onEvent)
            }
            return
        }
        
        // Cooldown safety: If main queue is done and only re-queued items remain
        if self.queueIndex >= self.filesQueue.count && self.activeWorkers.isEmpty && !self.inFlightRetryQueue.isEmpty {
            let remainingCool = self.circuitBreakerCooldownUntil - now
            if remainingCool > 0 {
                queue.asyncAfter(deadline: .now() + remainingCool) { [weak self] in
                    self?.scheduleNextBatches(onEvent: onEvent)
                }
                return
            }
        }
        
        var dispatchOffset: Double = 0.0
        while activeWorkers.count < effectiveConcurrency {
            let item: DownloadFileItem
            if !inFlightRetryQueue.isEmpty {
                item = inFlightRetryQueue.removeFirst()
            } else if queueIndex < filesQueue.count {
                item = filesQueue[queueIndex]
                queueIndex += 1
            } else {
                break
            }
            
            let fileId = item.id
            let workerKey = "\(item.id):\(item.relativePath)"
            
            let worker = DownloadWorker(
                item: item,
                destinationRoot: destRoot,
                skipExisting: self.skipExisting,
                onProgress: { [weak self] fileBytes, fileTotal in
                    self?.handleWorkerProgress(workerKey: workerKey, fileId: fileId, fileBytes: fileBytes, fileTotal: fileTotal, onEvent: onEvent)
                },
                onComplete: { [weak self] result in
                    self?.handleWorkerCompletion(workerKey: workerKey, fileId: fileId, item: item, result: result, onEvent: onEvent)
                }
            )
            
            activeWorkers[workerKey] = worker
            
            if dispatchOffset == 0.0 {
                worker.start()
            } else {
                let offset = dispatchOffset
                DispatchQueue.global().asyncAfter(deadline: .now() + offset) { [weak worker] in
                    worker?.start()
                }
            }
            // Gentle pacing delay between concurrent worker launches (150ms) to eliminate burst traffic spikes
            dispatchOffset += 0.15
        }
        
        // If no active workers and queue is empty, job is complete!
        if activeWorkers.isEmpty && inFlightRetryQueue.isEmpty && queueIndex >= filesQueue.count && (filesQueue.count >= totalFiles) {
            CompletionManifest.flush(destinationRoot: destRoot)
            let finalTotal = max(overallTotalBytes, max(knownSizesSum, overallBytesDownloaded))
            self.overallTotalBytes = finalTotal
            let stats = JobStats(
                totalFiles: totalFiles,
                completedFiles: completedCount,
                failedFiles: failedCount,
                skippedFiles: skippedCount,
                totalBytes: finalTotal,
                bytesDownloaded: overallBytesDownloaded
            )
            let completeMsg = OutboundMessage(
                status: "SUCCESS",
                action: "JOB_COMPLETED",
                jobId: jId,
                stats: stats
            )
            logDiagnostics("Job \(jId) finished: \(completedCount)/\(totalFiles) completed, \(failedCount) failed.")
            onEvent(completeMsg)
        }
    }
    
    private func handleWorkerProgress(workerKey: String, fileId: String, fileBytes: Int64, fileTotal: Int64, onEvent: @escaping @Sendable (OutboundMessage) -> Void) {
        queue.async {
            guard let jId = self.currentJobId, !self.isPaused && !self.isStopped else { return }
            
            self.activeWorkerBytes[workerKey] = fileBytes
            if fileTotal > 0 {
                let prev = self.fileKnownSizes[fileId] ?? 0
                self.fileKnownSizes[fileId] = fileTotal
                self.knownSizesSum += (fileTotal - prev)
            }
            let inFlight = self.activeWorkerBytes.values.reduce(Int64(0), +)
            let currentTotal = self.completedBytesTotal + inFlight
            self.overallBytesDownloaded = currentTotal
            
            if self.fileKnownSizes.count == self.totalFiles && self.totalFiles > 0 {
                self.overallTotalBytes = max(self.knownSizesSum, currentTotal)
            }
            
            let now = Date().timeIntervalSince1970
            let dt = now - self.lastSpeedCheckTime
            if dt >= 0.25 {
                let bytesDelta = currentTotal - self.lastBytesCount
                self.currentSpeedBps = max(0, Double(bytesDelta) / dt)
                self.lastSpeedCheckTime = now
                self.lastBytesCount = currentTotal
            }
            
            let event = OutboundMessage(
                status: "EVENT",
                action: "DOWNLOAD_PROGRESS",
                jobId: jId,
                fileId: fileId,
                bytesDownloaded: fileBytes,
                bytesWritten: fileBytes,
                totalBytes: fileTotal,
                overallBytes: currentTotal,
                overallTotalBytes: self.overallTotalBytes,
                speedBps: self.currentSpeedBps,
                activeCount: self.activeWorkers.count,
                completedCount: self.completedCount,
                failedCount: self.failedCount,
                totalFiles: self.totalFiles
            )
            onEvent(event)
        }
    }
    
    private func handleWorkerCompletion(
        workerKey: String,
        fileId: String,
        item: DownloadFileItem,
        result: Result<FileCompletedEvent, Error>,
        onEvent: @escaping @Sendable (OutboundMessage) -> Void
    ) {
        queue.async {
            self.activeWorkers.removeValue(forKey: workerKey)
            self.activeWorkerBytes.removeValue(forKey: workerKey)
            guard let jId = self.currentJobId, !self.isStopped else { return }
            
            if self.completedFileKeys.contains(workerKey) || self.failedFileKeys.contains(workerKey) {
                self.scheduleNextBatches(onEvent: onEvent)
                return
            }
            
            switch result {
            case .success(let completedEvent):
                self.consecutiveRateLimitCount = 0
                self.consecutiveSuccessCount += 1
                
                // Additive recovery of concurrency if we were previously throttled
                if self.consecutiveSuccessCount >= 6 && self.effectiveConcurrency < self.configuredConcurrency {
                    self.effectiveConcurrency = min(self.configuredConcurrency, self.effectiveConcurrency + 1)
                    self.consecutiveSuccessCount = 0
                    logDiagnostics("[Anti-Abuse Engine] Traffic smooth. Restoring concurrency to \(self.effectiveConcurrency)/\(self.configuredConcurrency) streams.")
                }
                
                self.completedFileKeys.insert(workerKey)
                self.completedCount = self.completedFileKeys.count
                let written = completedEvent.bytesWritten ?? 0
                if written > 0 {
                    let prev = self.fileKnownSizes[fileId] ?? 0
                    self.fileKnownSizes[fileId] = written
                    self.knownSizesSum += (written - prev)
                }
                self.completedBytesTotal += written
                let inFlight = self.activeWorkerBytes.values.reduce(Int64(0), +)
                self.overallBytesDownloaded = self.completedBytesTotal + inFlight
                if self.fileKnownSizes.count == self.totalFiles && self.totalFiles > 0 {
                    self.overallTotalBytes = max(self.knownSizesSum, self.overallBytesDownloaded)
                }
                
                let eventMsg = OutboundMessage(
                    status: "EVENT",
                    action: "FILE_COMPLETED",
                    jobId: jId,
                    fileId: fileId,
                    name: completedEvent.name,
                    relativePath: completedEvent.relativePath,
                    bytesDownloaded: completedEvent.bytesWritten,
                    bytesWritten: completedEvent.bytesWritten,
                    totalBytes: completedEvent.bytesWritten,
                    verified: completedEvent.verified,
                    md5Checksum: completedEvent.md5Checksum
                )
                onEvent(eventMsg)
                
            case .failure(let error):
                let nsError = error as NSError
                let isRateLimitOrThrottle = nsError.domain == DownloadWorker.RateLimitDomain ||
                    nsError.code == 429 ||
                    nsError.code == 403 ||
                    nsError.code == 503 ||
                    nsError.localizedDescription.contains("throttled") ||
                    nsError.localizedDescription.contains("quota") ||
                    nsError.localizedDescription.contains("rate limit")
                
                let cycles = self.fileRequeueCycles[fileId] ?? 0
                
                if isRateLimitOrThrottle && cycles < self.maxRequeueCycles {
                    // Anti-Abuse Circuit Breaker
                    self.consecutiveRateLimitCount += 1
                    self.consecutiveSuccessCount = 0
                    
                    if self.consecutiveRateLimitCount >= 2 {
                        // Multiplicative decrease: step down concurrency (min 4)
                        let newConcurrency = max(4, self.effectiveConcurrency / 2)
                        if newConcurrency != self.effectiveConcurrency {
                            self.effectiveConcurrency = newConcurrency
                            logDiagnostics("[Anti-Abuse Engine] Circuit breaker activated: Rate limits detected. Auto-throttling concurrency to \(self.effectiveConcurrency) streams.")
                        }
                        // Insert 2.5s cooldown before next launches
                        self.circuitBreakerCooldownUntil = Date().timeIntervalSince1970 + 2.5
                    }
                    
                    // Tail Re-Queueing
                    self.fileRequeueCycles[fileId] = cycles + 1
                    self.inFlightRetryQueue.append(item)
                    
                    logDiagnostics("[Anti-Abuse Engine] File '\(item.name)' was throttled by Google. Silently re-queueing to tail of batch (pass \(cycles + 1)/\(self.maxRequeueCycles)). Other files proceed while cooldown completes.")
                    
                    // Note: We DO NOT increment failedCount, and DO NOT emit FILE_FAILED!
                    // This file will be retried automatically when the queue advances!
                    
                } else {
                    // Permanent failure (404 private/deleted or exceeded maximum requeue passes)
                    self.failedFileKeys.insert(workerKey)
                    self.failedCount = self.failedFileKeys.count
                    let failMsg = OutboundMessage(
                        status: "EVENT",
                        action: "FILE_FAILED",
                        error: error.localizedDescription,
                        jobId: jId,
                        fileId: fileId
                    )
                    logDiagnostics("File '\(item.name)' (\(fileId)) failed permanently: \(error.localizedDescription)")
                    onEvent(failMsg)
                }
            }
            
            // Continue with remaining files
            self.scheduleNextBatches(onEvent: onEvent)
        }
    }
}
