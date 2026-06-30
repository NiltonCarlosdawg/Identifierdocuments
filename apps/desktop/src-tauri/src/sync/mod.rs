use crate::db;
use chrono::Utc;
use reqwest::multipart;
use reqwest::tls::TlsVersion;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const MAX_ATTEMPTS: i32 = 3;

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
    pub fn conn(&self) -> Result<Connection, String> {
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
        .min_tls_version(TlsVersion::TLS_1_2)
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

async fn upload_item(
    api_base_url: &str,
    token: &str,
    item: &QueueItem,
) -> Result<(), String> {
    let bytes = std::fs::read(&item.file_path).map_err(|e| e.to_string())?;
    let part = multipart::Part::bytes(bytes)
        .file_name(item.filename.clone())
        .mime_str("application/octet-stream")
        .map_err(|e| e.to_string())?;

    let form = multipart::Form::new()
        .text("identifier", item.identifier.clone())
        .text("uploadSource", "sync")
        .part("file", part);

    let client = build_tls_client(120)?;

    let res = client
        .post(format!("{api_base_url}/documents/attach"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if res.status().is_success() {
        return Ok(());
    }

    let body = res.text().await.unwrap_or_default();
    Err(if body.is_empty() {
        "Upload falhou".to_string()
    } else {
        body
    })
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

        match upload_item(&api_base_url, &token, item).await {
            Ok(()) => {
                conn.execute(
                    "UPDATE upload_queue SET status = 'uploaded', last_error = NULL WHERE id = ?1",
                    params![item.id],
                )
                .map_err(|e| e.to_string())?;
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
            }
            Err(err) => {
                let attempts = item.attempts + 1;
                let status = if attempts >= MAX_ATTEMPTS {
                    "failed"
                } else {
                    "pending"
                };

                conn.execute(
                    "UPDATE upload_queue SET status = ?1, attempts = ?2, last_error = ?3 WHERE id = ?4",
                    params![status, attempts, err, item.id],
                )
                .map_err(|e| e.to_string())?;

                if status == "failed" {
                    let _ = app.emit(
                        "sync:failed",
                        serde_json::json!({
                            "id": item.id,
                            "identifier": item.identifier,
                            "filename": item.filename,
                            "error": err,
                            "attempts": attempts,
                        }),
                    );
                }

                if attempts < MAX_ATTEMPTS {
                    let backoff = Duration::from_secs(2u64.pow(attempts as u32));
                    tokio::time::sleep(backoff).await;
                }
            }
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
    let dest = uploads_dir.join(format!("{}_{}", Uuid::new_v4(), safe_name));
    let canonical = dest.canonicalize().map_err(|_| "Erro ao resolver caminho.".to_string())?;
    let uploads_canonical = uploads_dir.canonicalize().map_err(|_| "Erro ao resolver diretório.".to_string())?;
    if !canonical.starts_with(&uploads_canonical) {
        return Err("Path traversal detectado.".to_string());
    }
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

#[tauri::command]
pub fn clear_uploaded(state: State<'_, SyncState>) -> Result<usize, String> {
    let conn = state.conn()?;
    let items: Vec<(String, String)> = conn
        .prepare("SELECT id, file_path FROM upload_queue WHERE status = 'uploaded'")
        .map_err(|e| e.to_string())?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (_, path) in &items {
        if is_safe_path(&state.uploads_dir, &path) {
            std::fs::remove_file(&path).ok();
        }
    }

    let count = conn
        .execute("DELETE FROM upload_queue WHERE status = 'uploaded'", [])
        .map_err(|e| e.to_string())?;
    Ok(count)
}

#[tauri::command]
pub fn remove_queue_item(state: State<'_, SyncState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
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
        if is_safe_path(&state.uploads_dir, &p) {
            std::fs::remove_file(p).ok();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn retry_queue_item(state: State<'_, SyncState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "UPDATE upload_queue SET status = 'pending', attempts = 0, last_error = NULL WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn force_sync(app: AppHandle, state: State<'_, SyncState>) -> Result<usize, String> {
    run_sync_cycle(&app, &state).await
}
