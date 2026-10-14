use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbJob {
    pub id: String,
    pub source_url: String,
    pub root_folder_name: String,
    pub destination_path: String,
    pub concurrency: u32,
    pub skip_existing: bool,
    pub status: String,
    pub total_files: usize,
    pub completed_files: usize,
    pub failed_files: usize,
    pub skipped_files: usize,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbJobFile {
    pub id: String,
    pub job_id: String,
    pub name: String,
    pub relative_path: String,
    pub expected_size: u64,
    pub downloaded_bytes: u64,
    pub md5_checksum: Option<String>,
    pub mime_type: String,
    pub status: String,
    pub verification_status: String,
    pub format_name: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Internal storage lock error")]
    LockError,
}

#[derive(Clone)]
pub struct Storage {
    conn: Arc<Mutex<Connection>>,
}

impl Storage {
    pub fn new(db_path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = db_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let conn = Connection::open(db_path)?;

        // Configure pragmas for crash resilience, concurrent access, and foreign keys
        let _ = conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;"
        );

        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        storage.run_migrations()?;
        Ok(storage)
    }

    pub fn in_memory() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        let _ = conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;"
        );
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.run_migrations()?;
        Ok(storage)
    }

    fn run_migrations(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS download_jobs (
                id TEXT PRIMARY KEY,
                source_url TEXT NOT NULL,
                root_folder_name TEXT NOT NULL,
                destination_path TEXT NOT NULL,
                concurrency INTEGER NOT NULL DEFAULT 16,
                skip_existing INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL,
                total_files INTEGER NOT NULL DEFAULT 0,
                completed_files INTEGER NOT NULL DEFAULT 0,
                failed_files INTEGER NOT NULL DEFAULT 0,
                skipped_files INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                downloaded_bytes INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME
            );

            CREATE INDEX IF NOT EXISTS idx_jobs_status ON download_jobs(status);
            CREATE INDEX IF NOT EXISTS idx_jobs_created ON download_jobs(created_at DESC);

            CREATE TABLE IF NOT EXISTS job_files (
                id TEXT NOT NULL,
                job_id TEXT NOT NULL,
                name TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                expected_size INTEGER DEFAULT 0,
                downloaded_bytes INTEGER DEFAULT 0,
                md5_checksum TEXT,
                mime_type TEXT,
                status TEXT NOT NULL,
                verification_status TEXT NOT NULL,
                format_name TEXT,
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (job_id, id),
                FOREIGN KEY (job_id) REFERENCES download_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_files_job_status ON job_files(job_id, status);

            CREATE TABLE IF NOT EXISTS diagnostic_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            ",
        )?;

        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let mut stmt = conn.prepare("SELECT value FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn insert_job(&self, job: &DbJob) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "INSERT INTO download_jobs (
                id, source_url, root_folder_name, destination_path, concurrency, skip_existing,
                status, total_files, completed_files, failed_files, skipped_files, total_bytes,
                downloaded_bytes, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            params![
                job.id,
                job.source_url,
                job.root_folder_name,
                job.destination_path,
                job.concurrency,
                if job.skip_existing { 1 } else { 0 },
                job.status,
                job.total_files,
                job.completed_files,
                job.failed_files,
                job.skipped_files,
                job.total_bytes,
                job.downloaded_bytes
            ],
        )?;
        Ok(())
    }

    pub fn insert_job_files(&self, files: &[DbJobFile]) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR REPLACE INTO job_files (
                    id, job_id, name, relative_path, expected_size, downloaded_bytes,
                    md5_checksum, mime_type, status, verification_status, format_name,
                    error_message, retry_count
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            )?;

            for f in files {
                stmt.execute(params![
                    f.id,
                    f.job_id,
                    f.name,
                    f.relative_path,
                    f.expected_size,
                    f.downloaded_bytes,
                    f.md5_checksum,
                    f.mime_type,
                    f.status,
                    f.verification_status,
                    f.format_name,
                    f.error_message,
                    f.retry_count
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_job_status(&self, job_id: &str, status: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "UPDATE download_jobs SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
            params![status, job_id],
        )?;
        Ok(())
    }

    pub fn update_job_progress(
        &self,
        job_id: &str,
        completed: usize,
        failed: usize,
        skipped: usize,
        downloaded_bytes: u64,
        status: &str,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "UPDATE download_jobs SET 
                completed_files = ?1,
                failed_files = ?2,
                skipped_files = ?3,
                downloaded_bytes = ?4,
                status = ?5,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?6",
            params![completed, failed, skipped, downloaded_bytes, status, job_id],
        )?;
        Ok(())
    }

    pub fn update_file_completion(
        &self,
        job_id: &str,
        file_id: &str,
        status: &str,
        bytes: u64,
        verification: &str,
        format_name: Option<&str>,
        error_msg: Option<&str>,
    ) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "UPDATE job_files SET 
                status = ?1,
                downloaded_bytes = ?2,
                verification_status = ?3,
                format_name = ?4,
                error_message = ?5,
                updated_at = CURRENT_TIMESTAMP
             WHERE job_id = ?6 AND id = ?7",
            params![status, bytes, verification, format_name, error_msg, job_id, file_id],
        )?;
        Ok(())
    }

    pub fn get_all_jobs(&self) -> Result<Vec<DbJob>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT id, source_url, root_folder_name, destination_path, concurrency,
                    skip_existing, status, total_files, completed_files, failed_files,
                    skipped_files, total_bytes, downloaded_bytes, created_at, updated_at, completed_at
             FROM download_jobs ORDER BY created_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            let skip_val: i64 = row.get(5)?;
            Ok(DbJob {
                id: row.get(0)?,
                source_url: row.get(1)?,
                root_folder_name: row.get(2)?,
                destination_path: row.get(3)?,
                concurrency: row.get(4)?,
                skip_existing: skip_val == 1,
                status: row.get(6)?,
                total_files: row.get(7)?,
                completed_files: row.get(8)?,
                failed_files: row.get(9)?,
                skipped_files: row.get(10)?,
                total_bytes: row.get(11)?,
                downloaded_bytes: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
                completed_at: row.get(15)?,
            })
        })?;

        let mut jobs = Vec::new();
        for r in rows {
            jobs.push(r?);
        }
        Ok(jobs)
    }

    pub fn get_job_files(&self, job_id: &str) -> Result<Vec<DbJobFile>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT id, job_id, name, relative_path, expected_size, downloaded_bytes,
                    md5_checksum, mime_type, status, verification_status, format_name,
                    error_message, retry_count
             FROM job_files WHERE job_id = ?1 ORDER BY name ASC",
        )?;

        let rows = stmt.query_map(params![job_id], |row| {
            Ok(DbJobFile {
                id: row.get(0)?,
                job_id: row.get(1)?,
                name: row.get(2)?,
                relative_path: row.get(3)?,
                expected_size: row.get(4)?,
                downloaded_bytes: row.get(5)?,
                md5_checksum: row.get(6)?,
                mime_type: row.get(7)?,
                status: row.get(8)?,
                verification_status: row.get(9)?,
                format_name: row.get(10)?,
                error_message: row.get(11)?,
                retry_count: row.get(12)?,
            })
        })?;

        let mut files = Vec::new();
        for r in rows {
            files.push(r?);
        }
        Ok(files)
    }

    pub fn log_diagnostic(&self, job_id: Option<&str>, level: &str, message: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        conn.execute(
            "INSERT INTO diagnostic_logs (job_id, level, message, created_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)",
            params![job_id, level, message],
        )?;
        Ok(())
    }

    pub fn get_bytes_downloaded_today(&self) -> Result<u64, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(SUM(downloaded_bytes), 0) FROM download_jobs WHERE date(created_at) = date('now')"
        )?;
        let bytes: i64 = stmt.query_row([], |r| r.get(0))?;
        Ok(bytes.max(0) as u64)
    }

    pub fn get_total_bytes_downloaded(&self) -> Result<u64, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::LockError)?;
        let mut stmt = conn.prepare(
            "SELECT COALESCE(SUM(downloaded_bytes), 0) FROM download_jobs"
        )?;
        let bytes: i64 = stmt.query_row([], |r| r.get(0))?;
        Ok(bytes.max(0) as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_storage_lifecycle() {
        let tmp = NamedTempFile::new().unwrap();
        let storage = Storage::new(tmp.path()).unwrap();

        storage.set_setting("theme", "dark").unwrap();
        assert_eq!(storage.get_setting("theme").unwrap(), Some("dark".to_string()));

        let job = DbJob {
            id: "test-job-1".to_string(),
            source_url: "https://drive.google.com/test".to_string(),
            root_folder_name: "TestFolder".to_string(),
            destination_path: "/tmp/downloads".to_string(),
            concurrency: 16,
            skip_existing: true,
            status: "RUNNING".to_string(),
            total_files: 10,
            completed_files: 0,
            failed_files: 0,
            skipped_files: 0,
            total_bytes: 1000,
            downloaded_bytes: 0,
            created_at: "".to_string(),
            updated_at: "".to_string(),
            completed_at: None,
        };

        storage.insert_job(&job).unwrap();
        let jobs = storage.get_all_jobs().unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, "test-job-1");
    }

    #[test]
    fn test_storage_nested_dir_auto_create() {
        let tmp = tempfile::tempdir().unwrap();
        let nested_db = tmp.path().join("nested").join("sub").join("test_v2.sqlite");
        assert!(!nested_db.parent().unwrap().exists());

        let storage = Storage::new(&nested_db).expect("Should create parent directories and initialize");
        storage.set_setting("app_version", "1.0.0").unwrap();
        assert_eq!(storage.get_setting("app_version").unwrap(), Some("1.0.0".to_string()));
    }

    #[test]
    fn test_storage_in_memory_persistence() {
        let storage = Storage::in_memory().expect("Should initialize in-memory SQLite storage");
        storage.set_setting("mode", "in_memory").unwrap();
        assert_eq!(storage.get_setting("mode").unwrap(), Some("in_memory".to_string()));
    }

    #[test]
    fn test_storage_data_persistence_across_reopen() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("persistent.sqlite");

        {
            let storage1 = Storage::new(&db_path).unwrap();
            storage1.set_setting("license_key", "DM-PRO-TEST-1234").unwrap();
            let job = DbJob {
                id: "persist-job".to_string(),
                source_url: "https://drive.google.com/test2".to_string(),
                root_folder_name: "PersistFolder".to_string(),
                destination_path: "/tmp/downloads2".to_string(),
                concurrency: 8,
                skip_existing: true,
                status: "COMPLETED".to_string(),
                total_files: 1,
                completed_files: 1,
                failed_files: 0,
                skipped_files: 0,
                total_bytes: 500,
                downloaded_bytes: 500,
                created_at: "".to_string(),
                updated_at: "".to_string(),
                completed_at: None,
            };
            storage1.insert_job(&job).unwrap();
        }

        // Reopen database
        let storage2 = Storage::new(&db_path).unwrap();
        assert_eq!(storage2.get_setting("license_key").unwrap(), Some("DM-PRO-TEST-1234".to_string()));
        let jobs = storage2.get_all_jobs().unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].id, "persist-job");
    }

    #[test]
    fn test_settings_roundtrip() {
        let storage = Storage::in_memory().unwrap();
        storage.set_setting("concurrency", "32").unwrap();
        storage.set_setting("theme", "light").unwrap();
        storage.set_setting("skip_existing", "true").unwrap();
        storage.set_setting("destination", "/Users/tester/Downloads").unwrap();

        assert_eq!(storage.get_setting("concurrency").unwrap(), Some("32".to_string()));
        assert_eq!(storage.get_setting("theme").unwrap(), Some("light".to_string()));
        assert_eq!(storage.get_setting("skip_existing").unwrap(), Some("true".to_string()));
        assert_eq!(storage.get_setting("destination").unwrap(), Some("/Users/tester/Downloads".to_string()));
    }
}
