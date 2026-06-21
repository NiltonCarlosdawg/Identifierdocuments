use crate::db;
use chrono::Utc;
use reqwest::multipart;
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

pub async fn check_online(api_base_url: &str) -> bool {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_default();
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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

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
        let mut base = state.api_base_url.lock().map_err(|e| e.to_string())?;
        *base = url.trim_end_matches('/').to_string();
    }
    let mut auth = state.auth_token.lock().map_err(|e| e.to_string())?;
    *auth = Some(token);
    Ok(())
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

    let filename = source
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("documento")
        .to_string();

    std::fs::create_dir_all(&state.uploads_dir).map_err(|e| e.to_string())?;
    let dest = state.uploads_dir.join(format!("{}_{}", Uuid::new_v4(), filename));
    std::fs::copy(&source, &dest).map_err(|e| e.to_string())?;

    let conn = state.conn()?;
    insert_item(&conn, &dest, &filename, &identifier, &tenant_id, &user_id)
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
    let dest = state.uploads_dir.join(format!("{}_{}", Uuid::new_v4(), filename));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let conn = state.conn()?;
    insert_item(&conn, &dest, &filename, &identifier, &tenant_id, &user_id)
}

#[tauri::command]
pub fn get_queue(state: State<'_, SyncState>) -> Result<Vec<QueueItem>, String> {
    let conn = state.conn()?;
    fetch_all(&conn)
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
        std::fs::remove_file(path).ok();
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
        std::fs::remove_file(p).ok();
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
