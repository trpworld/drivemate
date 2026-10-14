use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetKind {
    Folder,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedTarget {
    pub id: String,
    pub kind: TargetKind,
    pub original_url: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Empty URL provided. Please paste a valid Google Drive link.")]
    EmptyUrl,
    #[error("Google Docs, Sheets, and Slides cannot be downloaded directly via public unauthenticated links. They require an active Google account to export.")]
    WorkspaceDocument(String),
    #[error("Invalid or unsupported Google Drive link: '{0}'. DriveMate supports public Google Drive folder and file links.")]
    UnsupportedUrl(String),
}

/// Parses a user-supplied link or ID into a verified Google Drive target.
pub fn parse_drive_url(input: &str) -> Result<ParsedTarget, ParseError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(ParseError::EmptyUrl);
    }

    // 1. Detect and cleanly reject Google Workspace Docs/Sheets/Slides
    if trimmed.contains("/document/d/") {
        return Err(ParseError::WorkspaceDocument("Google Doc".to_string()));
    }
    if trimmed.contains("/spreadsheets/d/") {
        return Err(ParseError::WorkspaceDocument("Google Sheet".to_string()));
    }
    if trimmed.contains("/presentation/d/") {
        return Err(ParseError::WorkspaceDocument("Google Slide".to_string()));
    }

    // 2. Folder patterns:
    // https://drive.google.com/drive/folders/1ABC...
    // https://drive.google.com/drive/u/0/folders/1ABC...
    // https://drive.google.com/open?id=1ABC... (with folder hint)
    let folder_re = Regex::new(r#"(?:drive/folders/|folders/|folder\?id=)([-_\w]{20,})"#).unwrap();
    if let Some(caps) = folder_re.captures(trimmed) {
        if let Some(m) = caps.get(1) {
            return Ok(ParsedTarget {
                id: m.as_str().to_string(),
                kind: TargetKind::Folder,
                original_url: trimmed.to_string(),
            });
        }
    }

    // 3. File patterns:
    // https://drive.google.com/file/d/1ABC.../view
    // https://drive.google.com/uc?id=1ABC...
    // https://drive.google.com/open?id=1ABC...
    let file_re = Regex::new(r#"(?:file/d/|uc\?id=|file\?id=)([-_\w]{20,})"#).unwrap();
    if let Some(caps) = file_re.captures(trimmed) {
        if let Some(m) = caps.get(1) {
            return Ok(ParsedTarget {
                id: m.as_str().to_string(),
                kind: TargetKind::File,
                original_url: trimmed.to_string(),
            });
        }
    }

    // 4. Generic open?id= query parameter
    let id_re = Regex::new(r#"[?&]id=([-_\w]{20,})"#).unwrap();
    if let Some(caps) = id_re.captures(trimmed) {
        if let Some(m) = caps.get(1) {
            let id = m.as_str().to_string();
            // If URL mentions "folder", treat as folder; otherwise default to folder for broad scanning
            let kind = if trimmed.to_lowercase().contains("folder") {
                TargetKind::Folder
            } else {
                TargetKind::Folder
            };
            return Ok(ParsedTarget {
                id,
                kind,
                original_url: trimmed.to_string(),
            });
        }
    }

    // 5. Bare alphanumeric Drive ID
    let bare_id_re = Regex::new(r#"^[-_\w]{20,}$"#).unwrap();
    if bare_id_re.is_match(trimmed) {
        return Ok(ParsedTarget {
            id: trimmed.to_string(),
            kind: TargetKind::Folder,
            original_url: trimmed.to_string(),
        });
    }

    Err(ParseError::UnsupportedUrl(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_folder_links() {
        let url1 = "https://drive.google.com/drive/folders/1w782y19N-VwPq2x189A?usp=sharing";
        let res1 = parse_drive_url(url1).unwrap();
        assert_eq!(res1.id, "1w782y19N-VwPq2x189A");
        assert_eq!(res1.kind, TargetKind::Folder);

        let url2 = "https://drive.google.com/drive/u/0/folders/1ABC_def-GHI123456789";
        let res2 = parse_drive_url(url2).unwrap();
        assert_eq!(res2.id, "1ABC_def-GHI123456789");
        assert_eq!(res2.kind, TargetKind::Folder);
    }

    #[test]
    fn test_parse_file_links() {
        let url = "https://drive.google.com/file/d/1XyZ987_654321AbCdEfGhIj/view?usp=drivesdk";
        let res = parse_drive_url(url).unwrap();
        assert_eq!(res.id, "1XyZ987_654321AbCdEfGhIj");
        assert_eq!(res.kind, TargetKind::File);
    }

    #[test]
    fn test_reject_workspace_docs() {
        let doc = "https://docs.google.com/document/d/1234567890abcdefghijklmn/edit";
        assert!(parse_drive_url(doc).is_err());
    }

    #[test]
    fn test_bare_id() {
        let bare = "1w782y19N-VwPq2x189A_test";
        let res = parse_drive_url(bare).unwrap();
        assert_eq!(res.id, bare);
        assert_eq!(res.kind, TargetKind::Folder);
    }
}
