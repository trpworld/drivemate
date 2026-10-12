import Foundation

// MARK: - Persistent Completion Manifest

public final class CompletionManifest: @unchecked Sendable {
    private static let lock = NSLock()
    
    public struct Entry: Codable, Sendable {
        public let fileId: String
        public let name: String
        public let relativePath: String
        public let size: Int64
        public let md5Checksum: String?
        public let verified: Bool
        public let completedAt: String
        
        public init(fileId: String, name: String, relativePath: String, size: Int64, md5Checksum: String?, verified: Bool, completedAt: String) {
            self.fileId = fileId
            self.name = name
            self.relativePath = relativePath
            self.size = size
            self.md5Checksum = md5Checksum
            self.verified = verified
            self.completedAt = completedAt
        }
    }
    
    public struct ManifestData: Codable, Sendable {
        public var version: String = "1.0"
        public var files: [String: Entry] = [:] // key: relativePath
        
        public init(version: String = "1.0", files: [String: Entry] = [:]) {
            self.version = version
            self.files = files
        }
    }
    
    nonisolated(unsafe) private static var cachedManifests: [URL: ManifestData] = [:]
    nonisolated(unsafe) private static var isDirty: [URL: Bool] = [:]
    nonisolated(unsafe) private static var lastSaveTimes: [URL: TimeInterval] = [:]
    
    private static func manifestURL(for destinationRoot: URL) -> URL {
        return destinationRoot.appendingPathComponent(".drivemate_manifest.json")
    }
    
    public static func load(destinationRoot: URL) -> ManifestData {
        if let cached = cachedManifests[destinationRoot] {
            return cached
        }
        let url = manifestURL(for: destinationRoot)
        guard let data = try? Data(contentsOf: url) else {
            let fresh = ManifestData()
            cachedManifests[destinationRoot] = fresh
            return fresh
        }
        let loaded = (try? JSONDecoder().decode(ManifestData.self, from: data)) ?? ManifestData()
        cachedManifests[destinationRoot] = loaded
        return loaded
    }
    
    public static func recordCompletion(destinationRoot: URL, item: DownloadFileItem, bytesWritten: Int64, md5Checksum: String?, verified: Bool) {
        lock.lock()
        defer { lock.unlock() }
        
        var manifest = load(destinationRoot: destinationRoot)
        let formatter = ISO8601DateFormatter()
        let now = formatter.string(from: Date())
        let sanitizedRel = DownloadWorker.sanitizeRelativePath(item.relativePath)
        
        manifest.files[sanitizedRel] = Entry(
            fileId: item.id,
            name: item.name,
            relativePath: sanitizedRel,
            size: bytesWritten,
            md5Checksum: md5Checksum,
            verified: verified,
            completedAt: now
        )
        cachedManifests[destinationRoot] = manifest
        isDirty[destinationRoot] = true
        
        // Write to disk immediately or debounced for high throughput
        let nowTime = Date().timeIntervalSince1970
        let lastTime = lastSaveTimes[destinationRoot] ?? 0
        if nowTime - lastTime >= 0.5 {
            saveToDisk(destinationRoot: destinationRoot, manifest: manifest)
            lastSaveTimes[destinationRoot] = nowTime
            isDirty[destinationRoot] = false
        }
    }
    
    private static func saveToDisk(destinationRoot: URL, manifest: ManifestData) {
        let url = manifestURL(for: destinationRoot)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(manifest) {
            try? data.write(to: url, options: .atomic)
        }
    }
    
    public static func flush(destinationRoot: URL) {
        lock.lock()
        defer { lock.unlock() }
        
        if isDirty[destinationRoot] == true, let manifest = cachedManifests[destinationRoot] {
            saveToDisk(destinationRoot: destinationRoot, manifest: manifest)
            isDirty[destinationRoot] = false
            lastSaveTimes[destinationRoot] = Date().timeIntervalSince1970
        }
    }
    
    public static func flushAll() {
        lock.lock()
        defer { lock.unlock() }
        
        for (root, dirty) in isDirty {
            if dirty, let manifest = cachedManifests[root] {
                saveToDisk(destinationRoot: root, manifest: manifest)
                isDirty[root] = false
                lastSaveTimes[root] = Date().timeIntervalSince1970
            }
        }
    }
    
    public static func lookup(destinationRoot: URL, relativePath: String, fileId: String?) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        
        let manifest = load(destinationRoot: destinationRoot)
        let sanitizedRel = DownloadWorker.sanitizeRelativePath(relativePath)
        guard let entry = manifest.files[sanitizedRel] else { return nil }
        
        if let fId = fileId, !fId.isEmpty, !entry.fileId.isEmpty,
           !fId.hasPrefix("http://") && !fId.hasPrefix("https://") &&
           !entry.fileId.hasPrefix("http://") && !entry.fileId.hasPrefix("https://") {
            if entry.fileId != fId {
                // Different source file ID for the same path
                return nil
            }
        }
        return entry
    }
}
