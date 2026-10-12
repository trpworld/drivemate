import Foundation

// MARK: - File Format & Container Validator

public enum FileFormatValidator {
    /// Inspects a local file and determines if it is a structurally valid, complete container/document.
    public static func validate(url: URL) -> (isValid: Bool, formatName: String) {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? Int64,
              size > 0 else {
            return (false, "empty")
        }
        
        let ext = url.pathExtension.lowercased()
        
        // 1. XML / Camera Metadata Sidecars
        if ext == "xml" {
            if let data = try? Data(contentsOf: url, options: .mappedIfSafe),
               let xmlStr = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .ascii) {
                let trimmed = xmlStr.trimmingCharacters(in: .whitespacesAndNewlines)
                if (trimmed.hasPrefix("<?xml") || trimmed.hasPrefix("<")) && trimmed.hasSuffix(">") && trimmed.contains("</") {
                    return (true, "xml")
                }
            }
            return (false, "xml_invalid")
        }
        
        // 2. MP4 / M4V / MOV (ISO Base Media File Format)
        if ext == "mp4" || ext == "m4v" || ext == "mov" {
            return validateISOContainer(url: url, size: size)
        }
        
        // 3. JSON
        if ext == "json" {
            if let data = try? Data(contentsOf: url, options: .mappedIfSafe),
               (try? JSONSerialization.jsonObject(with: data)) != nil {
                return (true, "json")
            }
            return (false, "json_invalid")
        }
        
        // 4. JPEG
        if ext == "jpg" || ext == "jpeg" {
            if size > 4, let handle = try? FileHandle(forReadingFrom: url) {
                defer { try? handle.close() }
                let start = (try? handle.read(upToCount: 2)) ?? Data()
                try? handle.seek(toOffset: UInt64(size - 2))
                let end = (try? handle.read(upToCount: 2)) ?? Data()
                if start == Data([0xFF, 0xD8]) && end == Data([0xFF, 0xD9]) {
                    return (true, "jpeg")
                }
            }
            return (false, "jpeg_invalid")
        }
        
        // 5. PNG
        if ext == "png" {
            if size > 8, let handle = try? FileHandle(forReadingFrom: url) {
                defer { try? handle.close() }
                let start = (try? handle.read(upToCount: 8)) ?? Data()
                let pngHeader = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
                if start == pngHeader {
                    try? handle.seek(toOffset: UInt64(max(0, size - 12)))
                    let tail = (try? handle.read(upToCount: 12)) ?? Data()
                    if tail.contains(Data([0x49, 0x45, 0x4E, 0x44])) {
                        return (true, "png")
                    }
                }
            }
            return (false, "png_invalid")
        }
        
        // 6. ZIP
        if ext == "zip" {
            if size > 22, let handle = try? FileHandle(forReadingFrom: url) {
                defer { try? handle.close() }
                try? handle.seek(toOffset: UInt64(max(0, size - 1024)))
                let tail = (try? handle.read(upToCount: 1024)) ?? Data()
                if tail.contains(Data([0x50, 0x4B, 0x05, 0x06])) {
                    return (true, "zip")
                }
            }
            return (false, "zip_invalid")
        }
        
        return (false, "unknown_format")
    }
    
    private static func validateISOContainer(url: URL, size: Int64) -> (isValid: Bool, formatName: String) {
        guard size >= 16, let handle = try? FileHandle(forReadingFrom: url) else {
            return (false, "mp4_unreadable")
        }
        defer { try? handle.close() }
        
        var offset: UInt64 = 0
        var hasFtyp = false
        var hasMoov = false
        var hasMdat = false
        let totalSize = UInt64(size)
        
        while offset < totalSize {
            do {
                try handle.seek(toOffset: offset)
                guard let hdr = try handle.read(upToCount: 8), hdr.count == 8 else { break }
                let boxSize32 = UInt64(hdr.prefix(4).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
                let boxType = String(data: hdr.suffix(4), encoding: .ascii) ?? ""
                
                var boxLen: UInt64 = boxSize32
                if boxSize32 == 1 {
                    guard let hdr64 = try handle.read(upToCount: 8), hdr64.count == 8 else { break }
                    boxLen = hdr64.withUnsafeBytes { $0.load(as: UInt64.self).bigEndian }
                } else if boxSize32 == 0 {
                    boxLen = totalSize - offset
                }
                
                if boxType == "ftyp" { hasFtyp = true }
                else if boxType == "moov" { hasMoov = true }
                else if boxType == "mdat" { hasMdat = true }
                
                if boxLen == 0 { break }
                offset += boxLen
            } catch {
                break
            }
        }
        
        if hasFtyp && hasMoov && hasMdat {
            return (true, "mp4")
        }
        return (false, "mp4_incomplete")
    }
}
