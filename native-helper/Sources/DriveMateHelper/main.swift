import Foundation

#if canImport(Darwin)
import Darwin
#endif

// MARK: - Logging (Standard Error + Local Audit Log)

func logDiagnostics(_ message: String) {
    let formatter = ISO8601DateFormatter()
    let timestamp = formatter.string(from: Date())
    let line = "[\(timestamp)] [DriveMateHelper PID:\(getpid())] \(message)\n"
    
    // 1. Strict write to standard error (never stdout!)
    if let data = line.data(using: .utf8) {
        data.withUnsafeBytes { ptr in
            if let baseAddress = ptr.baseAddress {
                _ = write(STDERR_FILENO, baseAddress, data.count)
            }
        }
    }
    
    // 2. Append to local audit file for live verification
    let auditLogPath = "/tmp/drivemate_helper.log"
    if let fileHandle = FileHandle(forWritingAtPath: auditLogPath) {
        fileHandle.seekToEndOfFile()
        if let data = line.data(using: .utf8) {
            fileHandle.write(data)
        }
        try? fileHandle.close()
    } else {
        FileManager.default.createFile(atPath: auditLogPath, contents: line.data(using: .utf8), attributes: nil)
    }
}

// MARK: - Low-Level POSIX Stdio Helpers

/// Reads exactly `count` bytes from standard input.
/// Returns nil on EOF or error.
func readExactBytes(count: Int) -> Data? {
    guard count > 0 else { return Data() }
    var buffer = [UInt8](repeating: 0, count: count)
    var totalRead = 0
    
    while totalRead < count {
        let bytesRemaining = count - totalRead
        let result = buffer.withUnsafeMutableBytes { ptr -> Int in
            guard let base = ptr.baseAddress else { return -1 }
            let dest = base.advanced(by: totalRead)
            return read(STDIN_FILENO, dest, bytesRemaining)
        }
        
        if result == 0 {
            // EOF encountered
            return nil
        }
        if result < 0 {
            logDiagnostics("POSIX read() failed with errno \(errno)")
            return nil
        }
        totalRead += result
    }
    
    return Data(buffer)
}

/// Writes a Chrome Native Messaging packet (4-byte LE length + JSON data) to standard output.
@discardableResult
func writePacket(data: Data) -> Bool {
    var length = UInt32(data.count).littleEndian
    let lengthBytes = withUnsafeBytes(of: &length) { Data($0) }
    
    var packet = lengthBytes
    packet.append(data)
    
    let totalCount = packet.count
    var totalWritten = 0
    
    let success = packet.withUnsafeBytes { ptr -> Bool in
        guard let base = ptr.baseAddress else { return false }
        while totalWritten < totalCount {
            let written = write(STDOUT_FILENO, base.advanced(by: totalWritten), totalCount - totalWritten)
            if written <= 0 {
                logDiagnostics("POSIX write() failed with errno \(errno)")
                return false
            }
            totalWritten += written
        }
        return true
    }
    
    fflush(stdout)
    return success
}

func sendOutbound(_ msg: OutboundMessage) {
    do {
        let responseData = try JSONEncoder().encode(msg)
        if !writePacket(data: responseData) {
            logDiagnostics("Failed to write packet to standard output.")
        }
    } catch {
        logDiagnostics("Fatal: Failed to encode response JSON: \(error)")
    }
}

// MARK: - Main Message Loop

func runNativeHost() {
    logDiagnostics("Native Messaging Host started (v0.3.0-phase3)")
    atexit {
        CompletionManifest.flushAll()
    }
    
    let maxPayloadSize: UInt32 = 64 * 1024 * 1024 // 64 MB inbound buffer to support arbitrary file count jobs (e.g. 10,000+ files)
    
    while true {
        // Step 1: Read 4-byte little-endian length prefix
        guard let lengthData = readExactBytes(count: 4) else {
            logDiagnostics("Standard input closed (EOF). Terminating process cleanly.")
            CompletionManifest.flushAll()
            exit(0)
        }
        
        let length = lengthData.withUnsafeBytes { $0.load(as: UInt32.self) }.littleEndian
        logDiagnostics("Read message header: length = \(length) bytes")
        
        // Step 2: Validate length
        if length == 0 {
            logDiagnostics("Received zero-length packet. Ignoring.")
            continue
        }
        if length > maxPayloadSize {
            logDiagnostics("Message length (\(length) bytes) exceeds max payload size (\(maxPayloadSize) bytes). Emitting error and terminating.")
            let errOutbound = OutboundMessage(
                status: "ERROR",
                action: "MESSAGE_OVERSIZED",
                error: "Inbound message length (\(length) bytes) exceeds max payload size (\(maxPayloadSize) bytes)."
            )
            sendOutbound(errOutbound)
            CompletionManifest.flushAll()
            exit(1)
        }
        
        // Step 3: Read JSON payload
        guard let payloadData = readExactBytes(count: Int(length)) else {
            logDiagnostics("Unexpected EOF while reading message payload of \(length) bytes. Terminating.")
            exit(1)
        }
        
        // Step 4: Parse and validate JSON schema
        do {
            let inbound = try JSONDecoder().decode(InboundMessage.self, from: payloadData)
            logDiagnostics("Successfully parsed message with action: '\(inbound.action)'")
            
            switch inbound.action.uppercased() {
            case "PING":
                let outbound = OutboundMessage(
                    status: "SUCCESS",
                    action: "PONG",
                    echoPayload: inbound.payload,
                    receivedTimestamp: inbound.timestamp,
                    helperVersion: "0.3.0-phase3"
                )
                sendOutbound(outbound)
                
            case "ECHO":
                let outbound = OutboundMessage(
                    status: "SUCCESS",
                    action: "ECHO_RESPONSE",
                    echoPayload: inbound.payload,
                    receivedTimestamp: inbound.timestamp,
                    helperVersion: "0.3.0-phase3"
                )
                sendOutbound(outbound)
                
            case "START_DOWNLOAD_JOB":
                guard let jId = inbound.jobId, !jId.isEmpty,
                      let dest = inbound.destinationPath, !dest.isEmpty,
                      let files = inbound.files else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "START_DOWNLOAD_JOB",
                        error: "Missing required fields (jobId, destinationPath, or files)."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                
                let concurrency = inbound.concurrency ?? 16
                let skipExisting = inbound.skipExisting ?? true
                let ack = OutboundMessage(
                    status: "SUCCESS",
                    action: "JOB_ACCEPTED",
                    jobId: jId
                )
                sendOutbound(ack)
                
                DownloadEngine.shared.startJob(
                    jobId: jId,
                    destinationPath: dest,
                    concurrency: concurrency,
                    skipExisting: skipExisting,
                    files: files,
                    totalFilesExpected: inbound.totalFilesExpected,
                    onEvent: { event in
                        sendOutbound(event)
                    }
                )
                
            case "APPEND_FILES", "ENQUEUE_FILES":
                guard let jId = inbound.jobId, let files = inbound.files, !files.isEmpty else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "APPEND_FILES",
                        error: "Missing jobId or files array."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                DownloadEngine.shared.appendFiles(jobId: jId, files: files) { event in
                    sendOutbound(event)
                }
                
            case "PAUSE_DOWNLOAD_JOB":
                guard let jId = inbound.jobId else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "PAUSE_DOWNLOAD_JOB",
                        error: "Missing jobId."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                DownloadEngine.shared.pauseJob(jobId: jId) { event in
                    sendOutbound(event)
                }
                
            case "RESUME_DOWNLOAD_JOB":
                guard let jId = inbound.jobId else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "RESUME_DOWNLOAD_JOB",
                        error: "Missing jobId."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                DownloadEngine.shared.resumeJob(jobId: jId) { event in
                    sendOutbound(event)
                }
                
            case "STOP_DOWNLOAD_JOB":
                guard let jId = inbound.jobId else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "STOP_DOWNLOAD_JOB",
                        error: "Missing jobId."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                DownloadEngine.shared.stopJob(jobId: jId) { event in
                    sendOutbound(event)
                }
                
            case "FETCH_URL":
                guard let urlStr = inbound.url ?? inbound.payload,
                      let url = URL(string: urlStr) else {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "FETCH_URL_RESPONSE",
                        error: "Missing or invalid URL parameter."
                    )
                    sendOutbound(errOutbound)
                    continue
                }
                
                var req = URLRequest(url: url)
                req.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
                
                let semaphore = DispatchSemaphore(value: 0)
                var fetchStatus: Int = 0
                var fetchBody: String = ""
                var fetchError: String? = nil
                var isRedirectedToLogin = false
                
                let task = URLSession.shared.dataTask(with: req) { data, response, error in
                    if let error = error {
                        fetchError = error.localizedDescription
                    } else if let http = response as? HTTPURLResponse {
                        fetchStatus = http.statusCode
                        if let data = data, let body = String(data: data, encoding: .utf8) {
                            fetchBody = body
                        }
                        if let finalUrl = http.url?.absoluteString,
                           (finalUrl.contains("accounts.google.com") || finalUrl.contains("ServiceLogin")) {
                            isRedirectedToLogin = true
                        }
                    }
                    semaphore.signal()
                }
                task.resume()
                _ = semaphore.wait(timeout: .now() + 15.0)
                
                if let fetchError = fetchError {
                    let errOutbound = OutboundMessage(
                        status: "ERROR",
                        action: "FETCH_URL_RESPONSE",
                        error: fetchError
                    )
                    sendOutbound(errOutbound)
                } else {
                    let okOutbound = OutboundMessage(
                        status: "SUCCESS",
                        action: "FETCH_URL_RESPONSE",
                        verified: !isRedirectedToLogin,
                        httpStatus: isRedirectedToLogin ? 401 : fetchStatus,
                        httpBody: fetchBody
                    )
                    sendOutbound(okOutbound)
                }
                
            default:
                logDiagnostics("Unrecognized action received: '\(inbound.action)'")
                let outbound = OutboundMessage(
                    status: "ERROR",
                    action: inbound.action,
                    receivedTimestamp: inbound.timestamp,
                    helperVersion: "0.3.0-phase3",
                    error: "Unrecognized action '\(inbound.action)'."
                )
                sendOutbound(outbound)
            }
        } catch {
            logDiagnostics("JSON schema validation failed: \(error.localizedDescription)")
            let outbound = OutboundMessage(
                status: "ERROR",
                action: "PARSE_ERROR",
                helperVersion: "0.3.0-phase3",
                error: "Malformed JSON schema: \(error.localizedDescription)"
            )
            sendOutbound(outbound)
        }
    }
}

// Start the host
runNativeHost()
