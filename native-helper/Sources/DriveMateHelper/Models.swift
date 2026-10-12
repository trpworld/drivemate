import Foundation

// MARK: - Native Messaging Protocol Models

public struct InboundMessage: Decodable, Sendable {
    public let action: String
    public let timestamp: Double?
    public let payload: String?
    
    // Optional direct URL fetch
    public let url: String?
    
    // Download Job Fields
    public let jobId: String?
    public let destinationPath: String?
    public let concurrency: Int?
    public let files: [DownloadFileItem]?
    public let skipExisting: Bool?
    public let totalFilesExpected: Int?
}

public struct DownloadFileItem: Decodable, Encodable, Sendable {
    public let id: String
    public let name: String
    public let relativePath: String
    public let expectedSize: Int64?
    public let md5Checksum: String?
    public let mimeType: String?
    
    public init(id: String, name: String, relativePath: String, expectedSize: Int64? = nil, md5Checksum: String? = nil, mimeType: String? = nil) {
        self.id = id
        self.name = name
        self.relativePath = relativePath
        self.expectedSize = expectedSize
        self.md5Checksum = md5Checksum
        self.mimeType = mimeType
    }
}

public struct FileCompletedEvent: Sendable {
    public let action: String
    public let jobId: String
    public let fileId: String
    public let name: String
    public let relativePath: String
    public let bytesWritten: Int64?
    public let md5Checksum: String?
    public let verified: Bool
    
    public init(action: String = "FILE_COMPLETED", jobId: String = "", fileId: String, name: String, relativePath: String, bytesWritten: Int64?, md5Checksum: String?, verified: Bool) {
        self.action = action
        self.jobId = jobId
        self.fileId = fileId
        self.name = name
        self.relativePath = relativePath
        self.bytesWritten = bytesWritten
        self.md5Checksum = md5Checksum
        self.verified = verified
    }
}

public struct JobStats: Encodable, Sendable {
    public let totalFiles: Int
    public let completedFiles: Int
    public let failedFiles: Int
    public let skippedFiles: Int
    public let totalBytes: Int64
    public let bytesDownloaded: Int64
    
    public init(totalFiles: Int, completedFiles: Int, failedFiles: Int, skippedFiles: Int, totalBytes: Int64, bytesDownloaded: Int64) {
        self.totalFiles = totalFiles
        self.completedFiles = completedFiles
        self.failedFiles = failedFiles
        self.skippedFiles = skippedFiles
        self.totalBytes = totalBytes
        self.bytesDownloaded = bytesDownloaded
    }
}

public struct OutboundMessage: Encodable, Sendable {
    public let status: String
    public let action: String
    public let responseTimestamp: Double
    public let echoPayload: String?
    public let receivedTimestamp: Double?
    public let helperVersion: String?
    public let error: String?
    
    // Download Engine Fields
    public let jobId: String?
    public let fileId: String?
    public let name: String?
    public let relativePath: String?
    public let bytesDownloaded: Int64?
    public let bytesWritten: Int64?
    public let totalBytes: Int64?
    public let overallBytes: Int64?
    public let overallTotalBytes: Int64?
    public let speedBps: Double?
    public let activeCount: Int?
    public let completedCount: Int?
    public let failedCount: Int?
    public let totalFiles: Int?
    public let verified: Bool?
    public let md5Checksum: String?
    public let stats: JobStats?
    
    // Direct URL Fetch Fields
    public let httpStatus: Int?
    public let httpBody: String?
    
    public init(
        status: String,
        action: String,
        responseTimestamp: Double = Date().timeIntervalSince1970 * 1000,
        echoPayload: String? = nil,
        receivedTimestamp: Double? = nil,
        helperVersion: String? = "0.3.0-phase3",
        error: String? = nil,
        jobId: String? = nil,
        fileId: String? = nil,
        name: String? = nil,
        relativePath: String? = nil,
        bytesDownloaded: Int64? = nil,
        bytesWritten: Int64? = nil,
        totalBytes: Int64? = nil,
        overallBytes: Int64? = nil,
        overallTotalBytes: Int64? = nil,
        speedBps: Double? = nil,
        activeCount: Int? = nil,
        completedCount: Int? = nil,
        failedCount: Int? = nil,
        totalFiles: Int? = nil,
        verified: Bool? = nil,
        md5Checksum: String? = nil,
        stats: JobStats? = nil,
        httpStatus: Int? = nil,
        httpBody: String? = nil
    ) {
        self.status = status
        self.action = action
        self.responseTimestamp = responseTimestamp
        self.echoPayload = echoPayload
        self.receivedTimestamp = receivedTimestamp
        self.helperVersion = helperVersion
        self.error = error
        self.jobId = jobId
        self.fileId = fileId
        self.name = name
        self.relativePath = relativePath
        self.bytesDownloaded = bytesDownloaded ?? bytesWritten
        self.bytesWritten = bytesWritten ?? bytesDownloaded
        self.totalBytes = totalBytes
        self.overallBytes = overallBytes
        self.overallTotalBytes = overallTotalBytes
        self.speedBps = speedBps
        self.activeCount = activeCount
        self.completedCount = completedCount
        self.failedCount = failedCount
        self.totalFiles = totalFiles
        self.verified = verified
        self.md5Checksum = md5Checksum
        self.stats = stats
        self.httpStatus = httpStatus
        self.httpBody = httpBody
    }
}
