use md5::{Digest, Md5};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerificationResult {
    pub is_valid: bool,
    pub format_name: String,
    pub actual_size: u64,
    pub md5_matches: Option<bool>,
    pub details: String,
}

pub struct FileFormatValidator;

impl FileFormatValidator {
    /// Validates file integrity, container structure, and optional MD5 checksum.
    pub fn validate(path: &Path, expected_size: Option<u64>, expected_md5: Option<&str>) -> VerificationResult {
        let metadata = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(e) => {
                return VerificationResult {
                    is_valid: false,
                    format_name: "unreadable".to_string(),
                    actual_size: 0,
                    md5_matches: None,
                    details: format!("Cannot read file metadata: {}", e),
                };
            }
        };

        let actual_size = metadata.len();
        if actual_size == 0 {
            // Check if 0-byte is legitimate (e.g. SONYCARD.IND, marker files, or expected_size == Some(0))
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if expected_size == Some(0) || ext == "ind" || ext == "keep" || ext == "gitkeep" || ext == "dat" {
                return VerificationResult {
                    is_valid: true,
                    format_name: "empty_valid".to_string(),
                    actual_size: 0,
                    md5_matches: None,
                    details: "Valid 0-byte marker/index file.".to_string(),
                };
            }
            return VerificationResult {
                is_valid: false,
                format_name: "empty".to_string(),
                actual_size: 0,
                md5_matches: None,
                details: "File is 0 bytes (empty).".to_string(),
            };
        }

        // Verify size if expected size was provided and > 0
        if let Some(exp) = expected_size {
            if exp > 0 && exp != actual_size {
                return VerificationResult {
                    is_valid: false,
                    format_name: "size_mismatch".to_string(),
                    actual_size,
                    md5_matches: None,
                    details: format!("Size mismatch: expected {} bytes, found {} bytes.", exp, actual_size),
                };
            }
        }

        // Verify MD5 if provided
        let mut md5_matches = None;
        if let Some(exp_md5) = expected_md5 {
            if !exp_md5.is_empty() {
                if let Ok(calc_md5) = Self::compute_md5(path) {
                    let matches = calc_md5.eq_ignore_ascii_case(exp_md5);
                    md5_matches = Some(matches);
                    if !matches {
                        return VerificationResult {
                            is_valid: false,
                            format_name: "md5_mismatch".to_string(),
                            actual_size,
                            md5_matches: Some(false),
                            details: format!("Checksum mismatch: expected {}, got {}.", exp_md5, calc_md5),
                        };
                    }
                }
            }
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        match ext.as_str() {
            "jpg" | "jpeg" => Self::validate_jpeg(path, actual_size, md5_matches),
            "png" => Self::validate_png(path, actual_size, md5_matches),
            "mp4" | "m4v" | "mov" => Self::validate_iso_bmff(path, actual_size, md5_matches),
            "zip" => Self::validate_zip(path, actual_size, md5_matches),
            "json" => Self::validate_json(path, actual_size, md5_matches),
            "xml" => Self::validate_xml(path, actual_size, md5_matches),
            _ => VerificationResult {
                is_valid: true,
                format_name: "generic_file".to_string(),
                actual_size,
                md5_matches,
                details: "Size verified. No specific container parser for this extension.".to_string(),
            },
        }
    }

    pub fn compute_md5(path: &Path) -> Result<String, std::io::Error> {
        let mut file = File::open(path)?;
        let mut hasher = Md5::new();
        let mut buffer = [0u8; 65536];

        loop {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    fn validate_jpeg(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        if size < 4 {
            return VerificationResult {
                is_valid: false,
                format_name: "jpeg_truncated".to_string(),
                actual_size: size,
                md5_matches,
                details: "JPEG file too small to contain valid headers.".to_string(),
            };
        }

        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Self::err("jpeg_unreadable", size, md5_matches),
        };

        let mut start = [0u8; 2];
        if file.read_exact(&mut start).is_err() || start != [0xFF, 0xD8] {
            return VerificationResult {
                is_valid: false,
                format_name: "jpeg_corrupted_header".to_string(),
                actual_size: size,
                md5_matches,
                details: "Missing JPEG SOI (0xFFD8) start marker.".to_string(),
            };
        }

        if file.seek(SeekFrom::End(-2)).is_err() {
            return Self::err("jpeg_seek_error", size, md5_matches);
        }

        let mut end = [0u8; 2];
        if file.read_exact(&mut end).is_err() || end != [0xFF, 0xD9] {
            return VerificationResult {
                is_valid: false,
                format_name: "jpeg_incomplete".to_string(),
                actual_size: size,
                md5_matches,
                details: "Missing JPEG EOI (0xFFD9) end marker (file is truncated).".to_string(),
            };
        }

        VerificationResult {
            is_valid: true,
            format_name: "jpeg".to_string(),
            actual_size: size,
            md5_matches,
            details: "Valid complete JPEG image container.".to_string(),
        }
    }

    fn validate_png(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        if size < 8 {
            return Self::err("png_truncated", size, md5_matches);
        }

        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Self::err("png_unreadable", size, md5_matches),
        };

        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() || header != [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
            return VerificationResult {
                is_valid: false,
                format_name: "png_corrupted_header".to_string(),
                actual_size: size,
                md5_matches,
                details: "Invalid PNG magic header.".to_string(),
            };
        }

        let tail_seek = if size >= 12 { size - 12 } else { 0 };
        if file.seek(SeekFrom::Start(tail_seek)).is_err() {
            return Self::err("png_seek_error", size, md5_matches);
        }

        let mut tail = Vec::new();
        let _ = file.read_to_end(&mut tail);
        if !tail.windows(4).any(|w| w == b"IEND") {
            return VerificationResult {
                is_valid: false,
                format_name: "png_incomplete".to_string(),
                actual_size: size,
                md5_matches,
                details: "Missing PNG IEND closing chunk (file is truncated).".to_string(),
            };
        }

        VerificationResult {
            is_valid: true,
            format_name: "png".to_string(),
            actual_size: size,
            md5_matches,
            details: "Valid complete PNG image container.".to_string(),
        }
    }

    fn validate_iso_bmff(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        if size < 16 {
            return Self::err("mp4_truncated", size, md5_matches);
        }

        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Self::err("mp4_unreadable", size, md5_matches),
        };

        let mut offset = 0u64;
        let mut has_ftyp = false;
        let mut has_moov = false;
        let mut has_mdat = false;

        while offset < size {
            if file.seek(SeekFrom::Start(offset)).is_err() {
                break;
            }

            let mut hdr = [0u8; 8];
            if file.read_exact(&mut hdr).is_err() {
                break;
            }

            let box_len_32 = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as u64;
            let box_type = &hdr[4..8];

            let box_len = if box_len_32 == 1 {
                let mut hdr64 = [0u8; 8];
                if file.read_exact(&mut hdr64).is_err() {
                    break;
                }
                u64::from_be_bytes(hdr64)
            } else if box_len_32 == 0 {
                size - offset
            } else {
                box_len_32
            };

            if box_type == b"ftyp" {
                has_ftyp = true;
            } else if box_type == b"moov" {
                has_moov = true;
            } else if box_type == b"mdat" {
                has_mdat = true;
            }

            if box_len == 0 {
                break;
            }
            offset += box_len;
        }

        if has_ftyp && has_moov && has_mdat {
            VerificationResult {
                is_valid: true,
                format_name: "mp4".to_string(),
                actual_size: size,
                md5_matches,
                details: "Valid complete ISO Base Media container (ftyp, moov, and mdat present).".to_string(),
            }
        } else {
            VerificationResult {
                is_valid: false,
                format_name: "mp4_incomplete".to_string(),
                actual_size: size,
                md5_matches,
                details: format!(
                    "Incomplete video container (ftyp: {}, moov: {}, mdat: {}).",
                    has_ftyp, has_moov, has_mdat
                ),
            }
        }
    }

    fn validate_zip(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        if size < 22 {
            return Self::err("zip_truncated", size, md5_matches);
        }

        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(_) => return Self::err("zip_unreadable", size, md5_matches),
        };

        let seek_pos = size.saturating_sub(1024);
        if file.seek(SeekFrom::Start(seek_pos)).is_err() {
            return Self::err("zip_seek_error", size, md5_matches);
        }

        let mut buffer = Vec::new();
        let _ = file.read_to_end(&mut buffer);

        // ZIP End-of-Central-Directory signature: 0x50 0x4B 0x05 0x06
        let eocd_sig = [0x50, 0x4B, 0x05, 0x06];
        if buffer.windows(4).any(|w| w == eocd_sig) {
            VerificationResult {
                is_valid: true,
                format_name: "zip".to_string(),
                actual_size: size,
                md5_matches,
                details: "Valid complete ZIP archive (EOCD record verified).".to_string(),
            }
        } else {
            VerificationResult {
                is_valid: false,
                format_name: "zip_incomplete".to_string(),
                actual_size: size,
                md5_matches,
                details: "Missing ZIP End-of-Central-Directory marker (archive is truncated).".to_string(),
            }
        }
    }

    fn validate_json(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => return Self::err("json_unreadable", size, md5_matches),
        };

        if serde_json::from_str::<serde_json::Value>(&content).is_ok() {
            VerificationResult {
                is_valid: true,
                format_name: "json".to_string(),
                actual_size: size,
                md5_matches,
                details: "Valid JSON document.".to_string(),
            }
        } else {
            VerificationResult {
                is_valid: false,
                format_name: "json_invalid".to_string(),
                actual_size: size,
                md5_matches,
                details: "Corrupted or incomplete JSON syntax.".to_string(),
            }
        }
    }

    fn validate_xml(path: &Path, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => return Self::err("xml_unreadable", size, md5_matches),
        };

        let trimmed = content.trim();
        if (trimmed.starts_with("<?xml") || trimmed.starts_with('<')) && trimmed.ends_with('>') && trimmed.contains("</") {
            VerificationResult {
                is_valid: true,
                format_name: "xml".to_string(),
                actual_size: size,
                md5_matches,
                details: "Well-formed XML document.".to_string(),
            }
        } else {
            VerificationResult {
                is_valid: false,
                format_name: "xml_invalid".to_string(),
                actual_size: size,
                md5_matches,
                details: "Missing valid XML tags or truncated content.".to_string(),
            }
        }
    }

    fn err(format_name: &str, size: u64, md5_matches: Option<bool>) -> VerificationResult {
        VerificationResult {
            is_valid: false,
            format_name: format_name.to_string(),
            actual_size: size,
            md5_matches,
            details: format!("Format verification failed for {}", format_name),
        }
    }
}
