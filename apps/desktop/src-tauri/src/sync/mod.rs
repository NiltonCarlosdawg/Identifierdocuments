use crate::db;
use chrono::Utc;
use reqwest::multipart;
use reqwest::tls::Version;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const MAX_ATTEMPTS: i32 = 3;

#[derive(Debug, Clone, PartialEq)]
pub struct UploadOutcome {
    pub new_status: String,
    pub new_attempts: i32,
    pub new_last_error: Option<String>,
}

fn compute_upload_outcome(item: &QueueItem, upload_result: &Result<(), String>) -> UploadOutcome {
    match upload_result {
        Ok(()) => UploadOutcome {
            new_status: "uploaded".to_string(),
            new_attempts: item.attempts,
            new_last_error: None,
        },
        Err(err) => {
            let attempts = item.attempts + 1;
            let status = if attempts >= MAX_ATTEMPTS {
                "failed"
            } else {
                "pending"
            };
            UploadOutcome {
                new_status: status.to_string(),
                new_attempts: attempts,
                new_last_error: Some(err.clone()),
            }
        }
    }
}

fn reset_stuck_items(conn: &Connection) -> Result<usize, String> {
    let count = conn
        .execute("UPDATE upload_queue SET status = 'pending' WHERE status = 'uploading'", [])
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub file_path: String,
    pub filename: String,
    pub identifier: String,
    pub tenant_id: String,
    pub user_id: String,
    pub status: String,
    pub attempts: i32,
    pub last_error: Option<String>,
    pub created_at: String,
}

pub struct SyncState {
    pub db_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub api_base_url: Mutex<String>,
    pub auth_token: Mutex<Option<String>>,
    pub syncing: Mutex<bool>,
}

impl SyncState {
    pub(crate) fn conn(&self) -> Result<Connection, String> {
        db::open(&self.db_path).map_err(|e| e.to_string())
    }
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueueItem> {
    Ok(QueueItem {
        id: row.get(0)?,
        file_path: row.get(1)?,
        filename: row.get(2)?,
        identifier: row.get(3)?,
        tenant_id: row.get(4)?,
        user_id: row.get(5)?,
        status: row.get(6)?,
        attempts: row.get(7)?,
        last_error: row.get(8)?,
        created_at: row.get(9)?,
    })
}

fn fetch_all(conn: &Connection) -> Result<Vec<QueueItem>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, file_path, filename, identifier, tenant_id, user_id, status, attempts, last_error, created_at
             FROM upload_queue ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_item)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn insert_item(
    conn: &Connection,
    file_path: &Path,
    filename: &str,
    identifier: &str,
    tenant_id: &str,
    user_id: &str,
) -> Result<QueueItem, String> {
    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO upload_queue (id, file_path, filename, identifier, tenant_id, user_id, status, attempts, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7)",
        params![id, file_path.to_string_lossy(), filename, identifier, tenant_id, user_id, created_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(QueueItem {
        id,
        file_path: file_path.to_string_lossy().to_string(),
        filename: filename.to_string(),
        identifier: identifier.to_string(),
        tenant_id: tenant_id.to_string(),
        user_id: user_id.to_string(),
        status: "pending".to_string(),
        attempts: 0,
        last_error: None,
        created_at,
    })
}

fn build_tls_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .use_rustls_tls()
        .min_tls_version(Version::TLS_1_2)
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {e}"))
}

fn build_tls_client_default(timeout_secs: u64) -> reqwest::Client {
    build_tls_client(timeout_secs).unwrap_or_default()
}

pub async fn check_online(api_base_url: &str) -> bool {
    let client = build_tls_client_default(5);
    client
        .get(format!("{api_base_url}/"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn upload_document(
    api_base_url: &str,
    token: &str,
    file_path: &str,
    filename: &str,
    identifier: &str,
    upload_source: &str,
) -> Result<serde_json::Value, String> {
    let bytes = std::fs::read(file_path).map_err(|e| e.to_string())?;
    let part = multipart::Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("identifier", identifier.to_string())
        .text("uploadSource", upload_source.to_string())
        .part("file", part);

    let client = build_tls_client(120)?;

    let res = client
        .post(format!("{api_base_url}/documents/attach"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    if status.is_success() {
        serde_json::from_str(&body).map_err(|e| e.to_string())
    } else if body.is_empty() {
        Err("Upload falhou".to_string())
    } else {
        Err(body)
    }
}

async fn upload_item(
    api_base_url: &str,
    token: &str,
    item: &QueueItem,
) -> Result<(), String> {
    upload_document(
        api_base_url,
        token,
        &item.file_path,
        &item.filename,
        &item.identifier,
        "sync",
    )
    .await
    .map(|_| ())
}

pub async fn run_sync_cycle(app: &AppHandle, state: &SyncState) -> Result<usize, String> {
    {
        let mut syncing = state.syncing.lock().map_err(|e| e.to_string())?;
        if *syncing {
            return Ok(0);
        }
        *syncing = true;
    }

    let result = run_sync_cycle_inner(app, state).await;

    if let Ok(mut syncing) = state.syncing.lock() {
        *syncing = false;
    }

    result
}

async fn run_sync_cycle_inner(app: &AppHandle, state: &SyncState) -> Result<usize, String> {
    let api_base_url = state.api_base_url.lock().map_err(|e| e.to_string())?.clone();
    let token = state
        .auth_token
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let token = match token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(0),
    };

    if !check_online(&api_base_url).await {
        return Ok(0);
    }

    let conn = state.conn()?;

    // Crash recovery: reset items stuck in 'uploading' back to 'pending'
    let _ = reset_stuck_items(&conn);

    let items: Vec<QueueItem> = conn
        .prepare(
            "SELECT id, file_path, filename, identifier, tenant_id, user_id, status, attempts, last_error, created_at
             FROM upload_queue
             WHERE status IN ('pending', 'failed') AND attempts < ?1
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?
        .query_map(params![MAX_ATTEMPTS], row_to_item)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if items.is_empty() {
        return Ok(0);
    }

    let total = items.len();
    let mut uploaded = 0usize;

    for (index, item) in items.iter().enumerate() {
        conn.execute(
            "UPDATE upload_queue SET status = 'uploading' WHERE id = ?1",
            params![item.id],
        )
        .map_err(|e| e.to_string())?;

        let _ = app.emit(
            "sync:progress",
            serde_json::json!({
                "id": item.id,
                "identifier": item.identifier,
                "filename": item.filename,
                "status": "uploading",
                "current": index + 1,
                "total": total,
            }),
        );

        let upload_result = upload_item(&api_base_url, &token, item).await;
        let outcome = compute_upload_outcome(item, &upload_result);

        conn.execute(
            "UPDATE upload_queue SET status = ?1, attempts = ?2, last_error = ?3 WHERE id = ?4",
            params![outcome.new_status, outcome.new_attempts, outcome.new_last_error, item.id],
        )
        .map_err(|e| e.to_string())?;

        if outcome.new_status == "uploaded" {
            uploaded += 1;
            let _ = app.emit(
                "sync:progress",
                serde_json::json!({
                    "id": item.id,
                    "identifier": item.identifier,
                    "filename": item.filename,
                    "status": "uploaded",
                    "current": index + 1,
                    "total": total,
                }),
            );
        } else if outcome.new_status == "failed" {
            let err = upload_result.unwrap_err();
            let _ = app.emit(
                "sync:failed",
                serde_json::json!({
                    "id": item.id,
                    "identifier": item.identifier,
                    "filename": item.filename,
                    "error": err,
                    "attempts": outcome.new_attempts,
                }),
            );
        } else {
            let _ = app.emit(
                "sync:progress",
                serde_json::json!({
                    "id": item.id,
                    "identifier": item.identifier,
                    "filename": item.filename,
                    "status": "pending",
                    "current": index + 1,
                    "total": total,
                }),
            );
            // backoff exponencial
            let backoff = Duration::from_secs(2u64.pow(outcome.new_attempts as u32));
            tokio::time::sleep(backoff).await;
        }
    }

    let remaining: i32 = conn
        .query_row(
            "SELECT COUNT(*) FROM upload_queue WHERE status IN ('pending', 'uploading', 'failed') AND attempts < ?1",
            params![MAX_ATTEMPTS],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if remaining == 0 {
        let _ = app.emit(
            "sync:complete",
            serde_json::json!({ "uploaded": uploaded }),
        );
    }

    Ok(uploaded)
}

pub fn start_background_sync(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut was_offline = true;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;

            let Some(state) = app.try_state::<SyncState>() else {
                continue;
            };

            let api_base_url = state.api_base_url.lock().ok().map(|u| u.clone()).unwrap_or_default();
            let online = check_online(&api_base_url).await;

            if online && was_offline {
                let _ = run_sync_cycle(&app, &state).await;
            } else if online {
                let conn = state.conn().ok();
                let has_pending = conn
                    .and_then(|c| {
                        c.query_row(
                            "SELECT COUNT(*) FROM upload_queue WHERE status IN ('pending', 'failed') AND attempts < ?1",
                            params![MAX_ATTEMPTS],
                            |row| row.get::<_, i32>(0),
                        )
                        .ok()
                    })
                    .unwrap_or(0)
                    > 0;

                if has_pending {
                    let _ = run_sync_cycle(&app, &state).await;
                }
            }

            was_offline = !online;
        }
    });
}

#[tauri::command]
pub fn set_sync_credentials(
    state: State<'_, SyncState>,
    token: String,
    api_base_url: Option<String>,
) -> Result<(), String> {
    if let Some(url) = api_base_url {
        let clean = url.trim_end_matches('/').to_string();
        if !clean.starts_with("https://") && !clean.starts_with("http://") {
            return Err("URL deve começar com http:// ou https://".to_string());
        }
        if clean.starts_with("http://") && !clean.contains("localhost") && !clean.contains("127.0.0.1") {
            return Err("HTTP só permitido para localhost. Use HTTPS para outros endereços.".to_string());
        }
        let mut base = state.api_base_url.lock().map_err(|e| e.to_string())?;
        *base = clean;
    }
    let mut auth = state.auth_token.lock().map_err(|e| e.to_string())?;
    *auth = Some(token);
    Ok(())
}

#[tauri::command]
pub fn set_api_base_url(state: State<'_, SyncState>, url: String) -> Result<(), String> {
    let clean = url.trim_end_matches('/').to_string();
    if !clean.starts_with("https://") && !clean.starts_with("http://") {
        return Err("URL deve começar com http:// ou https://".to_string());
    }
    if clean.starts_with("http://") && !clean.contains("localhost") && !clean.contains("127.0.0.1") {
        return Err("HTTP só permitido para localhost. Use HTTPS para outros endereços.".to_string());
    }
    let mut base = state.api_base_url.lock().map_err(|e| e.to_string())?;
    *base = clean;
    Ok(())
}

#[tauri::command]
pub fn get_api_base_url(state: State<'_, SyncState>) -> Result<String, String> {
    let base = state.api_base_url.lock().map_err(|e| e.to_string())?;
    Ok(base.clone())
}

#[tauri::command]
pub fn clear_sync_credentials(state: State<'_, SyncState>) -> Result<(), String> {
    let mut auth = state.auth_token.lock().map_err(|e| e.to_string())?;
    *auth = None;
    Ok(())
}

#[tauri::command]
pub async fn is_online(state: State<'_, SyncState>) -> Result<bool, String> {
    let api_base_url = state.api_base_url.lock().map_err(|e| e.to_string())?.clone();
    Ok(check_online(&api_base_url).await)
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|&c| c.is_alphanumeric() || c == '.' || c == '-' || c == '_')
        .collect::<String>()
        .chars()
        .take(255)
        .collect()
}

fn safe_dest_path(uploads_dir: &PathBuf, filename: &str) -> Result<PathBuf, String> {
    let safe_name = sanitize_filename(filename);
    if safe_name.is_empty() {
        return Err("Nome de ficheiro inválido.".to_string());
    }
    let uploads_canonical = uploads_dir.canonicalize().map_err(|_| "Erro ao resolver diretório.".to_string())?;
    let dest = uploads_canonical.join(format!("{}_{}", Uuid::new_v4(), safe_name));
    Ok(dest)
}

#[tauri::command]
pub fn enqueue_upload(
    state: State<'_, SyncState>,
    source_path: String,
    identifier: String,
    tenant_id: String,
    user_id: String,
) -> Result<QueueItem, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() {
        return Err("Ficheiro não encontrado.".to_string());
    }

    let source_canonical = source.canonicalize().map_err(|_| "Caminho inválido.".to_string())?;

    let filename = source_canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("documento")
        .to_string();

    std::fs::create_dir_all(&state.uploads_dir).map_err(|e| e.to_string())?;
    let dest = safe_dest_path(&state.uploads_dir, &filename)?;
    std::fs::copy(&source_canonical, &dest).map_err(|e| e.to_string())?;

    let conn = state.conn()?;
    let safe_name = sanitize_filename(&filename);
    insert_item(&conn, &dest, &safe_name, &identifier, &tenant_id, &user_id)
}

#[tauri::command]
pub fn enqueue_upload_bytes(
    state: State<'_, SyncState>,
    filename: String,
    bytes: Vec<u8>,
    identifier: String,
    tenant_id: String,
    user_id: String,
) -> Result<QueueItem, String> {
    std::fs::create_dir_all(&state.uploads_dir).map_err(|e| e.to_string())?;
    let dest = safe_dest_path(&state.uploads_dir, &filename)?;

    if bytes.len() > 52_428_800 {
        return Err("Ficheiro demasiado grande. Máximo: 50MB.".to_string());
    }
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let conn = state.conn()?;
    let safe_name = sanitize_filename(&filename);
    insert_item(&conn, &dest, &safe_name, &identifier, &tenant_id, &user_id)
}

#[tauri::command]
pub fn get_queue(state: State<'_, SyncState>) -> Result<Vec<QueueItem>, String> {
    let conn = state.conn()?;
    fetch_all(&conn)
}

fn is_safe_path(uploads_dir: &PathBuf, path: &str) -> bool {
    if let (Ok(canonical), Ok(uploads_canonical)) =
        (std::fs::canonicalize(path), uploads_dir.canonicalize())
    {
        canonical.starts_with(&uploads_canonical)
    } else {
        false
    }
}

fn clear_uploaded_raw(conn: &Connection, uploads_dir: &PathBuf) -> Result<usize, String> {
    let items: Vec<(String, String)> = conn
        .prepare("SELECT id, file_path FROM upload_queue WHERE status = 'uploaded'")
        .map_err(|e| e.to_string())?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (_, path) in &items {
        if is_safe_path(uploads_dir, &path) {
            std::fs::remove_file(&path).ok();
        }
    }

    let count = conn
        .execute("DELETE FROM upload_queue WHERE status = 'uploaded'", [])
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn clear_uploaded(state: State<'_, SyncState>) -> Result<usize, String> {
    let conn = state.conn()?;
    clear_uploaded_raw(&conn, &state.uploads_dir)
}

fn remove_queue_item_raw(conn: &Connection, id: &str, uploads_dir: &PathBuf) -> Result<(), String> {
    let path: Option<String> = conn
        .query_row(
            "SELECT file_path FROM upload_queue WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .ok();

    conn.execute("DELETE FROM upload_queue WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    if let Some(p) = path {
        if is_safe_path(uploads_dir, &p) {
            std::fs::remove_file(p).ok();
        }
    }
    Ok(())
}

fn retry_queue_item_raw(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE upload_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn remove_queue_item(state: State<'_, SyncState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    remove_queue_item_raw(&conn, &id, &state.uploads_dir)
}

#[tauri::command]
pub fn retry_queue_item(state: State<'_, SyncState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    retry_queue_item_raw(&conn, &id)
}

#[tauri::command]
pub async fn force_sync(app: AppHandle, state: State<'_, SyncState>) -> Result<usize, String> {
    run_sync_cycle(&app, &state).await
}

#[tauri::command]
pub async fn attach_document_native(
    state: State<'_, SyncState>,
    path: String,
    identifier: String,
    upload_source: Option<String>,
) -> Result<serde_json::Value, String> {
    let api_base_url = state.api_base_url.lock().map_err(|e| e.to_string())?.clone();
    let token = state
        .auth_token
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Sessão não autenticada.".to_string())?;

    let p = std::path::Path::new(&path);
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("documento");
    let source = upload_source.as_deref().unwrap_or("manual");

    upload_document(&api_base_url, &token, &path, filename, &identifier, source).await
}

#[cfg(test)]
mod tests {
    // NOTA: Os testes full_cycle_{success,failure}_* testam a função pura
    // compute_upload_outcome() mais as queries SQL replicadas manualmente no
    // teste — NÃO testam run_sync_cycle_inner() directamente (que depende de
    // AppHandle + SyncState do Tauri, difíceis de instanciar em teste unitário).
    // Se run_sync_cycle_inner() for alterado de forma a desalinhar-se de
    // compute_upload_outcome() ou das queries SQL, estes testes NÃO detectam a
    // regressão. Uma sessão futura pode querer adicionar teste de integração
    // com Tauri (ex.: tauri::test::mock_app()) para cobrir run_sync_cycle_inner.
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_uploads() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn tmp_db() -> (PathBuf, Connection) {
        let dir = tmp_uploads();
        let db_path = dir.join("test.db");
        let conn = db::open(&db_path).unwrap();
        (dir, conn)
    }

    // --- safe_dest_path ---

    #[test]
    fn test_safe_dest_path_ok() {
        let dir = tmp_uploads();
        let result = safe_dest_path(&dir, "relatorio.pdf");
        assert!(result.is_ok());
        let path = result.unwrap();
        assert!(path.starts_with(&dir.canonicalize().unwrap()));
        assert!(path.to_string_lossy().ends_with("relatorio.pdf"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_safe_dest_path_empty_filename() {
        let dir = tmp_uploads();
        let result = safe_dest_path(&dir, "");
        assert!(result.is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_safe_dest_path_nonexistent_dir() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        let result = safe_dest_path(&dir, "foo.pdf");
        assert!(result.is_err());
    }

    // --- sanitize_filename ---

    #[test]
    fn test_sanitize_filename_removes_bad_chars() {
        assert_eq!(sanitize_filename("hello world"), "helloworld");
        assert_eq!(sanitize_filename("a/b\\c:d"), "abcd");
        assert_eq!(sanitize_filename("file.tar.gz"), "file.tar.gz");
        assert_eq!(sanitize_filename(""), "");
    }

    #[test]
    fn test_sanitize_filename_truncates() {
        let long = "a".repeat(300);
        let result = sanitize_filename(&long);
        assert_eq!(result.len(), 255);
    }

    #[test]
    fn test_sanitize_filename_unicode() {
        let result = sanitize_filename("contrato_final_v2.pdf");
        assert_eq!(result, "contrato_final_v2.pdf");
    }

    #[test]
    fn test_sanitize_filename_only_invalid() {
        let result = sanitize_filename("  /  \\  ");
        assert_eq!(result, "");
    }

    // --- is_safe_path ---

    #[test]
    fn test_is_safe_path_valid() {
        let dir = tmp_uploads();
        let dest = safe_dest_path(&dir, "seguro.pdf").unwrap();
        fs::write(&dest, "dummy").unwrap();
        assert!(is_safe_path(&dir, &dest.to_string_lossy()));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_is_safe_path_outside_dir() {
        let dir = tmp_uploads();
        let outside = std::env::temp_dir().join("fora.pdf");
        fs::write(&outside, "dummy").unwrap();
        assert!(!is_safe_path(&dir, &outside.to_string_lossy()));
        fs::remove_file(&outside).ok();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_is_safe_path_nonexistent() {
        let dir = tmp_uploads();
        assert!(!is_safe_path(&dir, "/tmp/nao_existe.pdf"));
        fs::remove_dir_all(&dir).ok();
    }

    // --- DB operations ---

    #[test]
    fn test_insert_item_and_fetch_all() {
        let (dir, conn) = tmp_db();
        let file_path = dir.join("doc.pdf");
        fs::write(&file_path, "dummy").unwrap();

        let item = insert_item(&conn, &file_path, "doc.pdf", "TST-001", "t1", "u1").unwrap();
        assert_eq!(item.status, "pending");
        assert_eq!(item.filename, "doc.pdf");
        assert_eq!(item.identifier, "TST-001");

        let all = fetch_all(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].identifier, "TST-001");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn test_insert_item_duplicate_id() {
        let (dir, conn) = tmp_db();
        let file_path = dir.join("doc.pdf");
        fs::write(&file_path, "dummy").unwrap();

        insert_item(&conn, &file_path, "doc.pdf", "TST-001", "t1", "u1").unwrap();

        // second insert (different path, same identifier) should succeed (no unique constraint on identifier alone)
        let file_path2 = dir.join("doc2.pdf");
        fs::write(&file_path2, "dummy2").unwrap();
        let result = insert_item(&conn, &file_path2, "doc2.pdf", "TST-002", "t1", "u1");
        assert!(result.is_ok());

        let all = fetch_all(&conn).unwrap();
        assert_eq!(all.len(), 2);

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn test_clear_uploaded() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("ok.pdf");
        fs::write(&fp, "ok").unwrap();
        insert_item(&conn, &fp, "ok.pdf", "TST-001", "t1", "u1").unwrap();

        // manually mark as uploaded
        conn.execute(
            "UPDATE upload_queue SET status = 'uploaded' WHERE identifier = 'TST-001'",
            [],
        )
        .unwrap();

        let count = clear_uploaded_raw(&conn, &dir).unwrap();
        assert_eq!(count, 1);

        let remaining = fetch_all(&conn).unwrap();
        assert_eq!(remaining.len(), 0);

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn test_remove_queue_item() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("remover.pdf");
        fs::write(&fp, "remover").unwrap();
        let item = insert_item(&conn, &fp, "remover.pdf", "TST-001", "t1", "u1").unwrap();

        remove_queue_item_raw(&conn, &item.id, &dir).unwrap();

        let remaining = fetch_all(&conn).unwrap();
        assert_eq!(remaining.len(), 0);
        // file should also be deleted
        assert!(!fp.exists());

        fs::remove_dir_all(dir).ok();
    }

    // --- compute_upload_outcome ---

    #[test]
    fn outcome_success_returns_uploaded() {
        let item = QueueItem { id: "x".into(), file_path: "".into(), filename: "".into(), identifier: "".into(), tenant_id: "".into(), user_id: "".into(), status: "uploading".into(), attempts: 2, last_error: Some("erro anterior".into()), created_at: "".into() };
        let outcome = compute_upload_outcome(&item, &Ok(()));
        assert_eq!(outcome.new_status, "uploaded");
        assert_eq!(outcome.new_attempts, 2);
        assert_eq!(outcome.new_last_error, None);
    }

    #[test]
    fn outcome_first_failure_is_pending() {
        let item = QueueItem { id: "x".into(), file_path: "".into(), filename: "".into(), identifier: "".into(), tenant_id: "".into(), user_id: "".into(), status: "uploading".into(), attempts: 0, last_error: None, created_at: "".into() };
        let outcome = compute_upload_outcome(&item, &Err("timeout".into()));
        assert_eq!(outcome.new_status, "pending");
        assert_eq!(outcome.new_attempts, 1);
        assert_eq!(outcome.new_last_error, Some("timeout".into()));
    }

    #[test]
    fn outcome_second_failure_is_pending() {
        let item = QueueItem { id: "x".into(), file_path: "".into(), filename: "".into(), identifier: "".into(), tenant_id: "".into(), user_id: "".into(), status: "uploading".into(), attempts: 1, last_error: Some("timeout".into()), created_at: "".into() };
        let outcome = compute_upload_outcome(&item, &Err("erro rede".into()));
        assert_eq!(outcome.new_status, "pending");
        assert_eq!(outcome.new_attempts, 2);
    }

    #[test]
    fn outcome_third_failure_is_failed() {
        let item = QueueItem { id: "x".into(), file_path: "".into(), filename: "".into(), identifier: "".into(), tenant_id: "".into(), user_id: "".into(), status: "uploading".into(), attempts: 2, last_error: Some("timeout".into()), created_at: "".into() };
        let outcome = compute_upload_outcome(&item, &Err("limite excedido".into()));
        assert_eq!(outcome.new_status, "failed");
        assert_eq!(outcome.new_attempts, 3);
        assert_eq!(outcome.new_last_error, Some("limite excedido".into()));
    }

    // --- reset_stuck_items ---

    #[test]
    fn reset_stuck_items_reverts_uploading_to_pending() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("stuck.pdf");
        fs::write(&fp, "stuck").unwrap();

        let item = insert_item(&conn, &fp, "stuck.pdf", "TST-STUCK", "t1", "u1").unwrap();
        // simulate crash mid-upload
        conn.execute("UPDATE upload_queue SET status = 'uploading' WHERE id = ?1", params![item.id]).unwrap();

        let count = reset_stuck_items(&conn).unwrap();
        assert_eq!(count, 1);

        let status: String = conn.query_row("SELECT status FROM upload_queue WHERE id = ?1", params![item.id], |row| row.get(0)).unwrap();
        assert_eq!(status, "pending");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn reset_stuck_items_does_not_affect_other_statuses() {
        let (dir, conn) = tmp_db();
        fs::write(&dir.join("a.pdf"), "a").unwrap();
        fs::write(&dir.join("b.pdf"), "b").unwrap();

        let a = insert_item(&conn, &dir.join("a.pdf"), "a.pdf", "TST-A", "t1", "u1").unwrap();
        let b = insert_item(&conn, &dir.join("b.pdf"), "b.pdf", "TST-B", "t1", "u1").unwrap();

        conn.execute("UPDATE upload_queue SET status = 'uploading' WHERE id = ?1", params![a.id]).unwrap();
        conn.execute("UPDATE upload_queue SET status = 'uploaded' WHERE id = ?1", params![b.id]).unwrap();

        let count = reset_stuck_items(&conn).unwrap();
        assert_eq!(count, 1); // only reverted the 'uploading' one

        let status_a: String = conn.query_row("SELECT status FROM upload_queue WHERE id = ?1", params![a.id], |row| row.get(0)).unwrap();
        let status_b: String = conn.query_row("SELECT status FROM upload_queue WHERE id = ?1", params![b.id], |row| row.get(0)).unwrap();
        assert_eq!(status_a, "pending");
        assert_eq!(status_b, "uploaded");

        fs::remove_dir_all(dir).ok();
    }

    // --- cycle simulation (state machine integration) ---

    #[test]
    fn full_cycle_success_path() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("ok.pdf");
        fs::write(&fp, "ok").unwrap();

        let item = insert_item(&conn, &fp, "ok.pdf", "TST-OK", "t1", "u1").unwrap();
        assert_eq!(item.status, "pending");

        // simulate the cycle logic manually (same as run_sync_cycle_inner does per item)
        conn.execute("UPDATE upload_queue SET status = 'uploading' WHERE id = ?1", params![item.id]).unwrap();

        let outcome = compute_upload_outcome(&item, &Ok(()));
        conn.execute(
            "UPDATE upload_queue SET status = ?1, attempts = ?2, last_error = ?3 WHERE id = ?4",
            params![outcome.new_status, outcome.new_attempts, outcome.new_last_error, item.id],
        ).unwrap();

        let final_status: String = conn.query_row("SELECT status FROM upload_queue WHERE id = ?1", params![item.id], |row| row.get(0)).unwrap();
        assert_eq!(final_status, "uploaded");

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn full_cycle_failure_reaches_max_attempts() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("fail.pdf");
        fs::write(&fp, "fail").unwrap();

        let item = insert_item(&conn, &fp, "fail.pdf", "TST-FAIL", "t1", "u1").unwrap();

        // simulate 3 upload attempts, all failing
        for attempt in 1..=3 {
            conn.execute("UPDATE upload_queue SET status = 'uploading' WHERE id = ?1", params![item.id]).unwrap();
            let current = conn.query_row("SELECT attempts FROM upload_queue WHERE id = ?1", params![item.id], |row| row.get::<_, i32>(0)).unwrap();
            let fake_item = QueueItem { attempts: current, ..item.clone() };
            let outcome = compute_upload_outcome(&fake_item, &Err("rede indisponível".into()));
            conn.execute(
                "UPDATE upload_queue SET status = ?1, attempts = ?2, last_error = ?3 WHERE id = ?4",
                params![outcome.new_status, outcome.new_attempts, outcome.new_last_error, item.id],
            ).unwrap();

            if attempt < 3 {
                assert_eq!(outcome.new_status, "pending");
            } else {
                assert_eq!(outcome.new_status, "failed");
            }
        }

        let (final_status, final_attempts): (String, i32) = conn.query_row(
            "SELECT status, attempts FROM upload_queue WHERE id = ?1", params![item.id], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(final_status, "failed");
        assert_eq!(final_attempts, 3);

        let last_err: Option<String> = conn.query_row(
            "SELECT last_error FROM upload_queue WHERE id = ?1", params![item.id], |row| row.get(0),
        ).unwrap();
        assert_eq!(last_err, Some("rede indisponível".into()));

        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn test_retry_queue_item() {
        let (dir, conn) = tmp_db();
        let fp = dir.join("retry.pdf");
        fs::write(&fp, "retry").unwrap();
        let item = insert_item(&conn, &fp, "retry.pdf", "TST-001", "t1", "u1").unwrap();

        conn.execute(
            "UPDATE upload_queue SET status = 'failed', attempts = 3, last_error = 'timeout' WHERE id = ?1",
            params![item.id],
        )
        .unwrap();

        retry_queue_item_raw(&conn, &item.id).unwrap();

        let updated: (String, i32, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error FROM upload_queue WHERE id = ?1",
                params![item.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(updated.0, "pending");
        assert_eq!(updated.1, 0);
        assert_eq!(updated.2, None);

        fs::remove_dir_all(dir).ok();
    }
}

