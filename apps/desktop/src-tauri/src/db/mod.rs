use rusqlite::{Connection, Result};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

pub fn open(db_path: &Path) -> Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let conn = Connection::open(db_path)?;
    // Restrict file permissions to owner-only (0o600)
    if db_path.parent().is_some() {
        std::fs::set_permissions(db_path, std::fs::Permissions::from_mode(0o600)).ok();
    }
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS upload_queue (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            identifier TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS upload_queue_status_idx ON upload_queue(status);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn init_schema_creates_upload_queue() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let conn = open(&db_path).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'upload_queue'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        conn.execute(
            "INSERT INTO upload_queue (id, file_path, filename, identifier, tenant_id, user_id, status, attempts, created_at)
             VALUES ('1', '/tmp/f.pdf', 'f.pdf', 'TST-PROP-2026-0101-001', 't1', 'u1', 'pending', 0, '2026-01-01')",
            [],
        )
        .unwrap();

        let status: String = conn
            .query_row(
                "SELECT status FROM upload_queue WHERE id = '1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "pending");

        fs::remove_dir_all(dir).ok();
    }
}
