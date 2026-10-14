use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("Path traversal detected! Attempted to access path outside destination root: '{0}'")]
    PathTraversal(String),
    #[error("Failed to create directory: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Invalid filename or destination: {0}")]
    InvalidPath(String),
}

/// Validates that a target relative path stays strictly within the destination root directory.
/// Prevents directory traversal (`..`, absolute root overrides, null bytes).
pub fn resolve_safe_path(dest_root: &Path, relative_path: &str) -> Result<PathBuf, FsError> {
    let clean_rel = relative_path.replace('\\', "/");
    let rel_path = Path::new(&clean_rel);

    // Prevent any component from being ParentDir (..) or Prefix
    for component in rel_path.components() {
        match component {
            Component::ParentDir => {
                return Err(FsError::PathTraversal(relative_path.to_string()));
            }
            Component::Prefix(_) | Component::RootDir => {
                // If it attempts to specify an absolute root, reject
                return Err(FsError::PathTraversal(relative_path.to_string()));
            }
            Component::CurDir | Component::Normal(_) => {}
        }
    }

    let joined = dest_root.join(rel_path);

    // Ensure parent directories exist
    if let Some(parent) = joined.parent() {
        std::fs::create_dir_all(parent)?;
    }

    Ok(joined)
}

/// Atomically replaces the final target file with the temporary .part file.
pub fn finalize_part_file(part_path: &Path, final_path: &Path) -> std::io::Result<()> {
    if final_path.exists() {
        let _ = std::fs::remove_file(final_path);
    }
    std::fs::rename(part_path, final_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_prevent_path_traversal() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        assert!(resolve_safe_path(root, "../secret.txt").is_err());
        assert!(resolve_safe_path(root, "folder/../../etc/passwd").is_err());
        assert!(resolve_safe_path(root, "/absolute/path").is_err());

        let safe = resolve_safe_path(root, "subfolder/document.pdf").unwrap();
        assert!(safe.starts_with(root));
    }
}
