use crate::commands::identifiers::{mark_lease_remote_released_inner, PendingIdentifier};
use crate::db;
use chrono::Utc;
use reqwest::multipart;
use reqwest::tls::Version;
use rusqlite::{params, Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

// ============================================================
// Identifier sync — grouping for fiscal/non-fiscal batches
// ============================================================

#[derive(Debug, Clone)]
pub struct IdentifierSyncBatch {
    pub lease_id: Option<String>,
    pub items: Vec<PendingIdentifier>,
    pub idempotency_key: String,
}

fn fetch_pending_identifiers(conn: &Connection) -> Result<Vec<PendingIdentifier>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, idempotency_key, category_id, device_id, identifier, sequence,
                    lease_id, issued_to, description, visibility, origin, sector_id,
                    status, attempts, last_error, conflict_reason, created_at
             FROM local_pending_identifiers
             WHERE status = 'pending'
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_pending_identifier)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn row_to_pending_identifier(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingIdentifier> {
    Ok(PendingIdentifier {
        id: row.get(0)?,
        idempotency_key: row.get(1)?,
        category_id: row.get(2)?,
        device_id: row.get(3)?,
        identifier: row.get(4)?,
        sequence: row.get(5)?,
        lease_id: row.get(6)?,
        issued_to: row.get(7)?,
        description: row.get(8)?,
        visibility: row.get(9)?,
        origin: row.get(10)?,
        sector_id: row.get(11)?,
        status: row.get(12)?,
        attempts: row.get(13)?,
        last_error: row.get(14)?,
        conflict_reason: row.get(15)?,
        created_at: row.get(16)?,
    })
}

fn group_identifier_batches(items: Vec<PendingIdentifier>) -> Vec<IdentifierSyncBatch> {
    let mut fiscal: HashMap<String, Vec<PendingIdentifier>> = HashMap::new();
    let mut non_fiscal: Vec<PendingIdentifier> = Vec::new();

    for item in items {
        if let Some(ref lease_id) = item.lease_id {
            fiscal.entry(lease_id.clone()).or_default().push(item);
        } else {
            non_fiscal.push(item);
        }
    }

    let mut batches: Vec<IdentifierSyncBatch> = fiscal
        .into_iter()
        .map(|(lease_id, items)| {
            let idempotency_key = items
                .first()
                .map(|i| i.idempotency_key.clone())
                .unwrap_or_default();
            IdentifierSyncBatch {
                lease_id: Some(lease_id),
                items,
                idempotency_key,
            }
        })
        .collect();

    // Sort fiscal batches by earliest item creation time (deterministic order)
    batches.sort_by(|a, b| {
        let a_first = a.items.first().map(|i| &i.created_at);
        let b_first = b.items.first().map(|i| &i.created_at);
        a_first.cmp(&b_first)
    });

    // Non-fiscal — each item is its own batch
    for item in non_fiscal {
        let key = item.idempotency_key.clone();
        batches.push(IdentifierSyncBatch {
            lease_id: None,
            items: vec![item],
            idempotency_key: key,
        });
    }

    batches
}

// ============================================================
// Identifier sync — HTTP calls
// ============================================================

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FiscalBatchPayload {
    device_id: String,
    idempotency_key: String,
    lease_id: String,
    identifiers: Vec<IdentifierPayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LooseIdentifierPayload {
    device_id: String,
    category_id: String,
    idempotency_key: String,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: String,
    origin: String,
    sector_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentifierPayload {
    sequence: i32,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: String,
    origin: String,
}

#[derive(Debug)]
pub enum SyncBatchError {
    Backend { code: String, message: String },
    Network(String),
    Validation(String),
}

struct BackendErrorInfo {
    code: String,
    message: String,
}

fn parse_backend_error(body: &str, status_code: u16) -> BackendErrorInfo {
    if let Ok(err) = serde_json::from_str::<serde_json::Value>(body) {
        let code = err
            .get("error")
            .and_then(|e| e.get("code"))
            .and_then(|c| c.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();
        let message = err
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Erro desconhecido")
            .to_string();
        BackendErrorInfo { code, message }
    } else {
        BackendErrorInfo {
            code: "HTTP_ERROR".to_string(),
            message: format!("HTTP {status_code}: {body}"),
        }
    }
}

async fn sync_identifier_batch_http(
    api_base_url: &str,
    token: &str,
    batch: &IdentifierSyncBatch,
) -> Result<serde_json::Value, SyncBatchError> {
    let client = build_tls_client(30).map_err(|e| SyncBatchError::Network(e))?;

    match &batch.lease_id {
        Some(lease_id) => {
            let device_id = &batch.items[0].device_id;
            for item in &batch.items[1..] {
                if &item.device_id != device_id {
                    return Err(SyncBatchError::Validation(format!(
                        "Fiscal batch items have inconsistent device_id: expected {device_id}, got {}",
                        item.device_id
                    )));
                }
            }

            let identifiers: Result<Vec<IdentifierPayload>, SyncBatchError> = batch
                .items
                .iter()
                .map(|item| {
                    let seq = item.sequence.ok_or_else(|| {
                        SyncBatchError::Validation(
                            "Fiscal pending item missing sequence: invalid state".to_string(),
                        )
                    })?;
                    Ok(IdentifierPayload {
                        sequence: seq,
                        issued_to: item.issued_to.clone(),
                        description: item.description.clone(),
                        visibility: item.visibility.clone(),
                        origin: item.origin.clone(),
                    })
                })
                .collect();
            let identifiers = identifiers?;

            let payload = FiscalBatchPayload {
                device_id: device_id.clone(),
                idempotency_key: batch.idempotency_key.clone(),
                lease_id: lease_id.clone(),
                identifiers,
            };

            let res = client
                .post(format!("{api_base_url}/identifiers/register-offline"))
                .bearer_auth(token)
                .json(&payload)
                .send()
                .await
                .map_err(|e| SyncBatchError::Network(e.to_string()))?;

            let status = res.status();
            let body = res.text().await.unwrap_or_default();

            if status.is_success() {
                serde_json::from_str(&body)
                    .map_err(|e| SyncBatchError::Network(format!("Erro a parsear resposta: {e}")))
            } else {
                let err = parse_backend_error(&body, status.as_u16());
                Err(SyncBatchError::Backend {
                    code: err.code,
                    message: err.message,
                })
            }
        }
        None => {
            let item = &batch.items[0];
            let payload = LooseIdentifierPayload {
                device_id: item.device_id.clone(),
                category_id: item.category_id.clone(),
                idempotency_key: batch.idempotency_key.clone(),
                issued_to: item.issued_to.clone(),
                description: item.description.clone(),
                visibility: item.visibility.clone(),
                origin: item.origin.clone(),
                sector_id: item.sector_id.clone(),
            };

            let res = client
                .post(format!("{api_base_url}/identifiers/register-offline-loose"))
                .bearer_auth(token)
                .json(&payload)
                .send()
                .await
                .map_err(|e| SyncBatchError::Network(e.to_string()))?;

            let status = res.status();
            let body = res.text().await.unwrap_or_default();

            if status.is_success() {
                serde_json::from_str(&body)
                    .map_err(|e| SyncBatchError::Network(format!("Erro a parsear resposta: {e}")))
            } else {
                let err = parse_backend_error(&body, status.as_u16());
                Err(SyncBatchError::Backend {
                    code: err.code,
                    message: err.message,
                })
            }
        }
    }
}

// ============================================================
// Identifier sync — response handling
// ============================================================

#[derive(Debug, Clone, PartialEq)]
enum BackendErrorKind {
    OutOfOrder,
    LeaseInactive,
    OtherBackendError,
}

fn classify_backend_error(message: &str) -> BackendErrorKind {
    let lower = message.to_lowercase();
    if lower.contains("fora de ordem") {
        BackendErrorKind::OutOfOrder
    } else if lower.contains("lease") {
        BackendErrorKind::LeaseInactive
    } else {
        BackendErrorKind::OtherBackendError
    }
}

fn apply_identifier_error(
    conn: &mut Connection,
    batch: &IdentifierSyncBatch,
    message: &str,
    terminal: bool,
) -> Result<usize, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &batch.items {
        let new_attempts = item.attempts + 1;
        let new_status = if terminal {
            "failed"
        } else if new_attempts >= MAX_ATTEMPTS {
            "failed"
        } else {
            "pending"
        };
        tx.execute(
            "UPDATE local_pending_identifiers SET status = ?1, attempts = ?2, last_error = ?3 WHERE id = ?4",
            params![new_status, new_attempts, message, item.id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(0)
}

fn handle_identifier_response(
    conn: &mut Connection,
    state: &SyncState,
    batch: &IdentifierSyncBatch,
    result: Result<serde_json::Value, SyncBatchError>,
) -> Result<usize, String> {
    match result {
        Ok(_) => {
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for item in &batch.items {
                tx.execute(
                    "UPDATE local_pending_identifiers SET status = 'synced', attempts = 0, last_error = NULL WHERE id = ?1",
                    params![item.id],
                ).map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(batch.items.len())
        }
        Err(SyncBatchError::Backend { code: _, message }) => {
            match classify_backend_error(&message) {
                BackendErrorKind::OutOfOrder => {
                    let tx = conn.transaction().map_err(|e| e.to_string())?;
                    for item in &batch.items {
                        tx.execute(
                            "UPDATE local_pending_identifiers SET status = 'conflict', conflict_reason = 'OUT_OF_ORDER', last_error = ?1 WHERE id = ?2",
                            params![message, item.id],
                        ).map_err(|e| e.to_string())?;
                    }
                    tx.commit().map_err(|e| e.to_string())?;
                    Ok(0)
                }
                BackendErrorKind::LeaseInactive => {
                    match &batch.lease_id {
                        Some(lease_id) => {
                            match mark_lease_remote_released_inner(state, lease_id.clone()) {
                                Ok(_) => Ok(0),
                                Err(e) => apply_identifier_error(
                                    conn,
                                    batch,
                                    &format!("LeaseInactive handler error: {e}"),
                                    false,
                                ),
                            }
                        }
                        None => apply_identifier_error(conn, batch, &message, false),
                    }
                }
                BackendErrorKind::OtherBackendError => {
                    apply_identifier_error(conn, batch, &message, false)
                }
            }
        }
        Err(SyncBatchError::Network(msg)) => {
            apply_identifier_error(conn, batch, &msg, false)
        }
        Err(SyncBatchError::Validation(msg)) => {
            apply_identifier_error(conn, batch, &msg, true)
        }
    }
}

async fn process_identifier_batch(
    conn: &mut Connection,
    state: &SyncState,
    api_base_url: &str,
    token: &str,
    batch: &IdentifierSyncBatch,
) -> Result<usize, String> {
    let http_result = sync_identifier_batch_http(api_base_url, token, batch).await;
    handle_identifier_response(conn, state, batch, http_result)
}

async fn sync_pending_identifiers(
    state: &SyncState,
    api_base_url: &str,
    token: &str,
) -> Result<usize, String> {
    let mut conn = state.conn()?;
    let items = fetch_pending_identifiers(&conn)?;
    if items.is_empty() {
        return Ok(0);
    }
    let batches = group_identifier_batches(items);
    let mut synced = 0usize;
    for batch in &batches {
        synced += process_identifier_batch(&mut conn, state, api_base_url, token, batch).await?;
    }
    Ok(synced)
}

// ============================================================
// Piece 4 — Lease renewal (20% threshold or exhausted)
// ============================================================

#[derive(Debug, Clone)]
pub struct LeaseInfo {
    pub id: String,
    pub category_id: String,
    pub device_id: String,
    pub sector_id: String,
    pub start_seq: i32,
    pub end_seq: i32,
    pub next_to_use: i32,
    pub status: String,
    pub created_at: String,
}

fn fetch_active_leases(conn: &Connection) -> Result<Vec<LeaseInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at
             FROM local_identifier_lease
             WHERE status = 'active'
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LeaseInfo {
                id: row.get(0)?,
                category_id: row.get(1)?,
                device_id: row.get(2)?,
                sector_id: row.get(3)?,
                start_seq: row.get(4)?,
                end_seq: row.get(5)?,
                next_to_use: row.get(6)?,
                status: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn lease_needs_renewal(lease: &LeaseInfo) -> bool {
    if lease.next_to_use > lease.end_seq {
        return true;
    }
    let total = lease.end_seq - lease.start_seq + 1;
    if total <= 0 {
        return true;
    }
    let used = lease.next_to_use - lease.start_seq;
    used * 100 / total >= 80
}

struct NewLeaseData {
    id: String,
    category_id: String,
    device_id: String,
    sector_id: String,
    start_seq: i32,
    end_seq: i32,
    created_at: String,
}

fn apply_lease_renewal(
    conn: &mut Connection,
    old_lease_id: &str,
    new_lease: &NewLeaseData,
) -> Result<bool, String> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;

    let updated = tx
        .execute(
            "UPDATE local_identifier_lease SET status = 'exhausted' WHERE id = ?1 AND status = 'active'",
            params![old_lease_id],
        )
        .map_err(|e| e.to_string())?;

    if updated == 0 {
        tx.commit().map_err(|e| e.to_string())?;
        return Ok(false);
    }

    tx.execute(
        "INSERT INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8)",
        params![
            new_lease.id,
            new_lease.category_id,
            new_lease.device_id,
            new_lease.sector_id,
            new_lease.start_seq,
            new_lease.end_seq,
            new_lease.start_seq,
            new_lease.created_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

async fn renew_exhausted_leases(state: &SyncState) -> Result<usize, String> {
    let api_base_url = state
        .api_base_url
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let token = state
        .auth_token
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "Sessão não autenticada.".to_string())?;

    if !check_online(&api_base_url).await {
        return Ok(0);
    }

    let conn = state.conn()?;
    let leases = fetch_active_leases(&conn)?;
    let mut renewed = 0usize;

    for lease in leases {
        if !lease_needs_renewal(&lease) {
            continue;
        }

        let client = match build_tls_client(30) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Erro ao criar cliente HTTP para renovar lease: {e}");
                continue;
            }
        };

        let body = serde_json::json!({
            "deviceId": lease.device_id,
            "categoryId": lease.category_id,
            "sectorId": lease.sector_id,
        });

        let resp = match client
            .post(format!("{api_base_url}/identifiers/lease"))
            .bearer_auth(&token)
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Falha de rede ao renovar lease {}: {e}", lease.id);
                continue;
            }
        };

        let status = resp.status();
        let response_body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            let msg = serde_json::from_str::<serde_json::Value>(&response_body)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()).map(|s| s.to_string()))
                .unwrap_or_else(|| format!("HTTP {status}: {response_body}"));
            eprintln!("Servidor rejeitou renovação do lease {}: {msg}", lease.id);
            continue;
        }

        let server_lease: serde_json::Value = match serde_json::from_str(&response_body) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("Resposta inválida do servidor ao renovar lease {}: {e}", lease.id);
                continue;
            }
        };

        let data = server_lease.get("data").unwrap_or(&server_lease);
        let new_id = match data.get("id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                eprintln!("Resposta do servidor sem id ao renovar lease {}", lease.id);
                continue;
            }
        };

        let start_seq = match data
            .get("startSeq")
            .or_else(|| data.get("start_seq"))
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
        {
            Some(v) => v,
            None => {
                eprintln!("Resposta do servidor sem startSeq ao renovar lease {}", lease.id);
                continue;
            }
        };
        let end_seq = match data
            .get("endSeq")
            .or_else(|| data.get("end_seq"))
            .and_then(|v| v.as_i64())
            .map(|v| v as i32)
        {
            Some(v) => v,
            None => {
                eprintln!("Resposta do servidor sem endSeq ao renovar lease {}", lease.id);
                continue;
            }
        };
        let now = chrono::Utc::now().to_rfc3339();

        let new_lease = NewLeaseData {
            id: new_id,
            category_id: lease.category_id.clone(),
            device_id: lease.device_id.clone(),
            sector_id: lease.sector_id.clone(),
            start_seq,
            end_seq,
            created_at: now,
        };
        let mut conn = state.conn()?;
        match apply_lease_renewal(&mut conn, &lease.id, &new_lease) {
            Ok(true) => renewed += 1,
            Ok(false) => {
                // Race lost: another process already renewed this lease
                eprintln!("Corrida ao renovar lease {} — outro processo já renovou", lease.id);
            }
            Err(e) => {
                eprintln!("Erro de BD ao renovar lease {}: {e}", lease.id);
            }
        }
    }

    Ok(renewed)
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

    // Piece 4: Renew leases that are exhausted or below 20% capacity
    let renewed = renew_exhausted_leases(state).await.unwrap_or(0);

    // Sync pending identifiers (fiscal batches + non-fiscal items)
    let identifiers_synced = sync_pending_identifiers(state, &api_base_url, &token)
        .await
        .unwrap_or(0);

    let total_renewed_or_synced = renewed + identifiers_synced;

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
        return Ok(total_renewed_or_synced);
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

    Ok(total_renewed_or_synced + uploaded)
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

    // ============================================================
    // Helpers for identifier grouping tests
    // ============================================================

    fn make_pending(
        id: &str,
        lease_id: Option<&str>,
        idempotency_key: &str,
        created_at: &str,
        attempts: i32,
    ) -> PendingIdentifier {
        PendingIdentifier {
            id: id.to_string(),
            idempotency_key: idempotency_key.to_string(),
            category_id: "cat-f".into(),
            device_id: "dev-1".into(),
            identifier: format!("TST-{id}"),
            sequence: None,
            lease_id: lease_id.map(|s| s.to_string()),
            issued_to: None,
            description: None,
            visibility: "public".into(),
            origin: "physical".into(),
            sector_id: "s1".into(),
            status: "pending".into(),
            attempts,
            last_error: None,
            conflict_reason: None,
            created_at: created_at.to_string(),
        }
    }

    // ============================================================
    // Test 1: Same lease → same batch
    // ============================================================
    #[test]
    fn same_lease_same_batch() {
        let items = vec![
            make_pending("a", Some("L1"), "k-a", "2026-07-21T12:00:01Z", 0),
            make_pending("b", Some("L1"), "k-b", "2026-07-21T12:00:02Z", 0),
            make_pending("c", Some("L1"), "k-c", "2026-07-21T12:00:03Z", 0),
        ];
        let batches = group_identifier_batches(items);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].lease_id.as_deref(), Some("L1"));
        assert_eq!(batches[0].items.len(), 3);
        assert_eq!(batches[0].idempotency_key, "k-a");
    }

    // ============================================================
    // Test 2: Different lease → different batches
    // ============================================================
    #[test]
    fn different_lease_different_batch() {
        let items = vec![
            make_pending("a", Some("L1"), "k-a", "2026-07-21T12:00:01Z", 0),
            make_pending("b", Some("L2"), "k-b", "2026-07-21T12:00:02Z", 0),
            make_pending("c", Some("L1"), "k-c", "2026-07-21T12:00:03Z", 0),
        ];
        let batches = group_identifier_batches(items);
        assert_eq!(batches.len(), 2);
        // L1 batch has items [a, c], key = first item (a) = k-a
        let l1 = batches.iter().find(|b| b.lease_id.as_deref() == Some("L1")).unwrap();
        assert_eq!(l1.items.len(), 2);
        assert_eq!(l1.idempotency_key, "k-a");
        // L2 batch has item [b], key = k-b
        let l2 = batches.iter().find(|b| b.lease_id.as_deref() == Some("L2")).unwrap();
        assert_eq!(l2.items.len(), 1);
        assert_eq!(l2.idempotency_key, "k-b");
    }

    // ============================================================
    // Test 3: Non-fiscal → one batch per item, never grouped
    // ============================================================
    #[test]
    fn non_fiscal_one_per_batch() {
        let items = vec![
            make_pending("a", None, "k-a", "2026-07-21T12:00:01Z", 0),
            make_pending("b", None, "k-b", "2026-07-21T12:00:02Z", 0),
            make_pending("c", None, "k-c", "2026-07-21T12:00:03Z", 0),
        ];
        let batches = group_identifier_batches(items);
        assert_eq!(batches.len(), 3);
        for batch in batches.iter() {
            assert!(batch.lease_id.is_none());
            assert_eq!(batch.items.len(), 1);
        }
        // Idempotency keys are per-item
        assert_eq!(batches[0].idempotency_key, "k-a");
        assert_eq!(batches[1].idempotency_key, "k-b");
        assert_eq!(batches[2].idempotency_key, "k-c");
    }

    // ============================================================
    // Test 4: Deterministic ordering — multiple runs, same result
    // ============================================================
    #[test]
    fn deterministic_ordering() {
        let items = vec![
            make_pending("z", Some("L-late"), "k-z", "2026-07-21T12:00:05Z", 0),
            make_pending("a", Some("L-early"), "k-a", "2026-07-21T12:00:01Z", 0),
            make_pending("m", Some("L-mid"), "k-m", "2026-07-21T12:00:03Z", 0),
        ];

        // First pass
        let first = group_identifier_batches(items.clone());
        // Second pass (items in reverse order should still group the same)
        let mut reversed = items.clone();
        reversed.reverse();
        let second = group_identifier_batches(reversed);

        // Both must have same number of batches
        assert_eq!(first.len(), second.len());

        // Batches should be sorted by first item's created_at: L-early, L-mid, L-late
        let lease_order: Vec<Option<&str>> = first
            .iter()
            .map(|b| b.lease_id.as_deref())
            .collect();
        assert_eq!(
            lease_order,
            vec![Some("L-early"), Some("L-mid"), Some("L-late")],
            "batches must be sorted by earliest item created_at"
        );

        // Second run must produce identical batches
        for (a, b) in first.iter().zip(second.iter()) {
            assert_eq!(a.lease_id, b.lease_id);
            assert_eq!(a.idempotency_key, b.idempotency_key);
            assert_eq!(a.items.len(), b.items.len());
            for (ia, ib) in a.items.iter().zip(b.items.iter()) {
                assert_eq!(ia.id, ib.id);
            }
        }
    }

    // ============================================================
    // Test 5: Retry stability — demonstrates the problem
    // ============================================================
    #[test]
    fn retry_idempotency_key_changes_when_first_item_synced() {
        let items = vec![
            make_pending("a", Some("L1"), "k-a", "2026-07-21T12:00:01Z", 0),
            make_pending("b", Some("L1"), "k-b", "2026-07-21T12:00:02Z", 0),
            make_pending("c", Some("L1"), "k-c", "2026-07-21T12:00:03Z", 0),
        ];

        let batches = group_identifier_batches(items);
        assert_eq!(batches.len(), 1);
        let first_key = batches[0].idempotency_key.clone();
        assert_eq!(first_key, "k-a");

        let remaining = vec![
            make_pending("b", Some("L1"), "k-b", "2026-07-21T12:00:02Z", 0),
            make_pending("c", Some("L1"), "k-c", "2026-07-21T12:00:03Z", 0),
        ];
        let retry_batches = group_identifier_batches(remaining);
        assert_eq!(retry_batches.len(), 1);
        let retry_key = retry_batches[0].idempotency_key.clone();

        assert_eq!(retry_key, "k-b");

        assert_ne!(
            first_key, retry_key,
            "BUG: idempotency key changed from {first_key} to {retry_key}"
        );
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

    // ============================================================
    // Helpers for identifier response tests
    // ============================================================

    fn identifier_test_env() -> (PathBuf, SyncState, Connection) {
        let dir = std::env::temp_dir().join(format!("docid_test_idresp_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        crate::db::open(&db_path).unwrap();

        let state = SyncState {
            db_path: db_path.clone(),
            uploads_dir: dir.clone(),
            api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
            auth_token: std::sync::Mutex::new(None),
            syncing: std::sync::Mutex::new(false),
        };

        let conn = crate::db::open(&db_path).unwrap();
        (dir, state, conn)
    }

    fn ensure_category(conn: &Connection) {
        conn.execute(
            "INSERT OR IGNORE INTO local_category_cache (category_id, prefix, requires_sequential, last_synced_at)
             VALUES ('cat-f', 'FISC', 1, '2026-07-21T12:00:00Z')",
            [],
        )
        .unwrap();
    }

    fn ensure_lease(conn: &Connection) {
        ensure_category(conn);
        conn.execute(
            "INSERT OR IGNORE INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('L1', 'cat-f', 'dev-1', 's1', 1, 50, 1, 'active', '2026-07-21T12:00:00Z')",
            [],
        )
        .unwrap();
    }

    fn seed_pending(
        conn: &Connection,
        id: &str,
        lease_id: Option<&str>,
        idempotency_key: &str,
        attempts: i32,
        status: &str,
    ) {
        conn.execute(
            "INSERT INTO local_pending_identifiers
                (id, idempotency_key, category_id, device_id, identifier, sequence, lease_id,
                 sector_id, status, attempts, created_at)
             VALUES (?1, ?2, 'cat-f', 'dev-1', 'TST-001', 1, ?3, 's1', ?4, ?5, '2026-07-21T12:00:00Z')",
            params![id, idempotency_key, lease_id, status, attempts],
        )
        .unwrap();
    }

    fn make_single_batch(item: PendingIdentifier) -> IdentifierSyncBatch {
        let key = item.idempotency_key.clone();
        IdentifierSyncBatch {
            lease_id: item.lease_id.clone(),
            items: vec![item],
            idempotency_key: key,
        }
    }

    // ============================================================
    // classify_backend_error tests
    // ============================================================
    #[test]
    fn classify_out_of_order() {
        assert_eq!(
            classify_backend_error("Sequência fora de ordem. Esperado 5, recebido 7."),
            BackendErrorKind::OutOfOrder
        );
        assert_eq!(
            classify_backend_error("fora de ordem"),
            BackendErrorKind::OutOfOrder
        );
    }

    #[test]
    fn classify_lease_inactive() {
        assert_eq!(
            classify_backend_error("Lease não encontrado."),
            BackendErrorKind::LeaseInactive
        );
        assert_eq!(
            classify_backend_error("Lease não está activo."),
            BackendErrorKind::LeaseInactive
        );
        assert_eq!(
            classify_backend_error("Lease já não está activo."),
            BackendErrorKind::LeaseInactive
        );
    }

    #[test]
    fn classify_other() {
        assert_eq!(
            classify_backend_error("Dispositivo não encontrado."),
            BackendErrorKind::OtherBackendError
        );
        assert_eq!(
            classify_backend_error("Categoria não encontrada."),
            BackendErrorKind::OtherBackendError
        );
        assert_eq!(
            classify_backend_error("Erro desconhecido."),
            BackendErrorKind::OtherBackendError
        );
    }

    // ============================================================
    // apply_identifier_error tests
    // ============================================================
    #[test]
    fn apply_error_terminal_marks_failed_immediately() {
        let (dir, _state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        apply_identifier_error(&mut conn, &batch, "erro de validação", true).unwrap();

        let (status, attempts, last_error): (String, i32, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "failed", "terminal error must mark as failed immediately");
        assert_eq!(attempts, 1);
        assert_eq!(last_error.as_deref(), Some("erro de validação"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_error_non_terminal_stays_pending_within_limit() {
        let (dir, _state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        apply_identifier_error(&mut conn, &batch, "timeout", false).unwrap();

        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending", "non-terminal within limit must stay pending");
        assert_eq!(attempts, 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_error_non_terminal_hits_max_attempts() {
        let (dir, _state, mut conn) = identifier_test_env();
        // Start at attempt 2 so that +1 = 3 = MAX_ATTEMPTS
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 2, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 2)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        apply_identifier_error(&mut conn, &batch, "limite excedido", false).unwrap();

        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "failed", "must become failed when attempts >= MAX_ATTEMPTS");
        assert_eq!(attempts, 3);
        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // handle_identifier_response — state transitions
    // ============================================================
    #[test]
    fn response_ok_marks_synced() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Ok(serde_json::json!({"data": [{"id": "r1", "identifier": "TST-001"}]})),
        )
        .unwrap();

        let (status, attempts, last_error): (String, i32, Option<String>) = conn
            .query_row(
                "SELECT status, attempts, last_error FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "synced");
        assert_eq!(attempts, 0);
        assert_eq!(last_error, None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_ok_idempotent_retry_never_calls_classify() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        // First call succeeds
        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Ok(serde_json::json!({"data": [{"id": "r1"}]})),
        )
        .unwrap();

        // Second call also succeeds (backend returns cached result for same idempotencyKey)
        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Ok(serde_json::json!({"data": [{"id": "r1"}]})),
        )
        .unwrap();

        // Items remain synced
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_pending_identifiers WHERE status = 'synced' AND id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "idempotent retry must keep items synced");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_out_of_order_marks_conflict() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Backend {
                code: "REGISTER_OFFLINE_ERROR".into(),
                message: "Sequência fora de ordem. Esperado 5, recebido 7.".into(),
            }),
        )
        .unwrap();

        let (status, conflict_reason, last_error): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT status, conflict_reason, last_error FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "conflict");
        assert_eq!(conflict_reason.as_deref(), Some("OUT_OF_ORDER"));
        assert!(last_error.unwrap().contains("fora de ordem"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_other_backend_increments_attempts() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Backend {
                code: "REGISTER_OFFLINE_ERROR".into(),
                message: "Dispositivo não encontrado.".into(),
            }),
        )
        .unwrap();

        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending", "other backend error within limit stays pending");
        assert_eq!(attempts, 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_validation_terminal_marks_failed() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Validation(
                "Fiscal batch items have inconsistent device_id".into(),
            )),
        )
        .unwrap();

        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "failed", "Validation errors must be terminal");
        assert_eq!(attempts, 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_network_increments_attempts() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        seed_pending(&conn, "p1", None, "k-1", 0, "pending");
        let items = vec![make_pending("p1", None, "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Network("timeout".into())),
        )
        .unwrap();

        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(attempts, 1);
        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // LeaseInactive handler tests
    // ============================================================
    #[test]
    fn response_lease_inactive_calls_mark_released() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        ensure_lease(&conn);
        seed_pending(&conn, "p1", Some("L1"), "k-1", 0, "pending");
        let items = vec![make_pending("p1", Some("L1"), "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Backend {
                code: "REGISTER_OFFLINE_ERROR".into(),
                message: "Lease não está activo.".into(),
            }),
        )
        .unwrap();

        // Lease should be marked remote_released
        let lease_status: String = conn
            .query_row(
                "SELECT status FROM local_identifier_lease WHERE id = 'L1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lease_status, "remote_released");

        // Pending should be marked conflict
        let (status, conflict_reason): (String, Option<String>) = conn
            .query_row(
                "SELECT status, conflict_reason FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "conflict");
        assert_eq!(conflict_reason.as_deref(), Some("LEASE_FORCE_RELEASED"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn response_lease_inactive_fallback_on_error() {
        let (dir, state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        // Lease must exist for FK when inserting pending item, then we remove it
        ensure_lease(&conn);
        seed_pending(&conn, "p1", Some("L1"), "k-1", 0, "pending");
        // Remove lease row so mark_lease_remote_released_inner (which opens its own
        // connection) does not find it and returns Err.
        conn.execute("PRAGMA foreign_keys = OFF", []).unwrap();
        conn.execute("DELETE FROM local_identifier_lease WHERE id = 'L1'", [])
            .unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        let items = vec![make_pending("p1", Some("L1"), "k-1", "2026-07-21T12:00:00Z", 0)];
        let batch = make_single_batch(items.into_iter().next().unwrap());

        handle_identifier_response(
            &mut conn,
            &state,
            &batch,
            Err(SyncBatchError::Backend {
                code: "REGISTER_OFFLINE_ERROR".into(),
                message: "Lease não encontrado.".into(),
            }),
        )
        .unwrap();

        // mark_lease_remote_released_inner failed → fallback to apply_identifier_error
        let (status, attempts): (String, i32) = conn
            .query_row(
                "SELECT status, attempts FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending", "fallback must use error handling logic");
        assert_eq!(attempts, 1);
        // Last error should mention the fallback
        let last_error: Option<String> = conn
            .query_row(
                "SELECT last_error FROM local_pending_identifiers WHERE id = 'p1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            last_error.unwrap().contains("LeaseInactive handler error"),
            "fallback error must include LeaseInactive handler failure"
        );
        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // lease_needs_renewal tests
    // ============================================================

    fn make_lease(
        id: &str,
        start_seq: i32,
        end_seq: i32,
        next_to_use: i32,
    ) -> LeaseInfo {
        LeaseInfo {
            id: id.to_string(),
            category_id: "cat-f".into(),
            device_id: "dev-1".into(),
            sector_id: "s1".into(),
            start_seq,
            end_seq,
            next_to_use,
            status: "active".into(),
            created_at: "2026-07-21T12:00:00Z".into(),
        }
    }

    #[test]
    fn lease_renewal_exhausted() {
        let lease = make_lease("L1", 1, 50, 51);
        assert!(lease_needs_renewal(&lease), "next_to_use > end_seq must signal renewal");
    }

    #[test]
    fn lease_renewal_at_20_percent_threshold() {
        // 80% used of 100 = used 80, remaining 20
        let lease = make_lease("L1", 1, 100, 81);
        assert!(lease_needs_renewal(&lease), "80% used must signal renewal");
    }

    #[test]
    fn lease_renewal_just_under_threshold() {
        // 79% used of 100 = used 79, remaining 21
        let lease = make_lease("L1", 1, 100, 80);
        assert!(!lease_needs_renewal(&lease), "79% used must NOT signal renewal");
    }

    #[test]
    fn lease_renewal_fresh_lease() {
        let lease = make_lease("L1", 1, 50, 1);
        assert!(!lease_needs_renewal(&lease), "fresh lease must NOT signal renewal");
    }

    #[test]
    fn lease_renewal_single_item_lease() {
        // Batch size = 1 (end_seq == start_seq), just used the only number
        let lease = make_lease("L1", 42, 42, 43);
        assert!(lease_needs_renewal(&lease), "exhausted single-item lease must signal renewal");
    }

    #[test]
    fn lease_renewal_single_item_fresh() {
        // Batch size = 1, not yet used
        let lease = make_lease("L1", 42, 42, 42);
        assert!(!lease_needs_renewal(&lease), "fresh single-item lease must NOT signal renewal");
    }

    #[test]
    fn lease_renewal_exactly_at_end() {
        // next_to_use == end_seq, the last number is about to be used
        let lease = make_lease("L1", 1, 10, 10);
        // used = 9, total = 10, 9*100/10 = 90% >= 80
        assert!(lease_needs_renewal(&lease), "at last number (90% used) must signal renewal");
    }

    #[test]
    fn lease_renewal_large_lease_just_below() {
        // 199 used out of 250 = 79.6%, truncated to 79% by integer math
        let lease = make_lease("L1", 1, 250, 200);
        assert!(!lease_needs_renewal(&lease), "79.6%% used (integer 79%%) must NOT signal renewal");
    }

    #[test]
    fn lease_renewal_large_lease_at_threshold() {
        // 200 used out of 250 = exactly 80%
        let lease = make_lease("L1", 1, 250, 201);
        assert!(lease_needs_renewal(&lease), "80%% used must signal renewal");
    }

    // ============================================================
    // fetch_active_leases tests
    // ============================================================
    #[test]
    fn fetch_active_leases_returns_only_active() {
        let (dir, _state, conn) = identifier_test_env();
        ensure_category(&conn);

        // Insert two leases: one active, one exhausted
        conn.execute(
            "INSERT INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('L-active', 'cat-f', 'dev-1', 's1', 1, 50, 1, 'active', '2026-07-21T12:00:00Z')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('L-exhausted', 'cat-f', 'dev-1', 's1', 51, 100, 101, 'exhausted', '2026-07-21T12:00:01Z')",
            [],
        ).unwrap();

        let leases = fetch_active_leases(&conn).unwrap();
        assert_eq!(leases.len(), 1, "only active leases should be returned");
        assert_eq!(leases[0].id, "L-active");
        assert_eq!(leases[0].status, "active");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn fetch_active_leases_empty_when_none_active() {
        let (dir, _state, conn) = identifier_test_env();
        ensure_category(&conn);

        conn.execute(
            "INSERT INTO local_identifier_lease (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES ('L-ex', 'cat-f', 'dev-1', 's1', 1, 50, 51, 'exhausted', '2026-07-21T12:00:00Z')",
            [],
        ).unwrap();

        let leases = fetch_active_leases(&conn).unwrap();
        assert!(leases.is_empty(), "no active leases should return empty vec");
        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // apply_lease_renewal tests
    // ============================================================

    fn make_new_lease(id: &str, start_seq: i32, end_seq: i32) -> NewLeaseData {
        NewLeaseData {
            id: id.to_string(),
            category_id: "cat-f".into(),
            device_id: "dev-1".into(),
            sector_id: "s1".into(),
            start_seq,
            end_seq,
            created_at: "2026-07-21T12:00:00Z".into(),
        }
    }

    #[test]
    fn apply_renewal_success() {
        let (dir, _state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        ensure_lease(&conn); // creates lease 'L1' active, 1..50

        let new_lease = make_new_lease("L2", 51, 100);
        let applied = apply_lease_renewal(&mut conn, "L1", &new_lease).unwrap();
        assert!(applied, "renewal must succeed when old lease is active");

        // Old lease marked exhausted
        let old_status: String = conn
            .query_row(
                "SELECT status FROM local_identifier_lease WHERE id = 'L1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_status, "exhausted");

        // New lease inserted as active
        let (new_status, new_start, new_end): (String, i32, i32) = conn
            .query_row(
                "SELECT status, start_seq, end_seq FROM local_identifier_lease WHERE id = 'L2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(new_status, "active");
        assert_eq!(new_start, 51);
        assert_eq!(new_end, 100);

        // Only one active lease for cat-f/s1 (unique index enforced)
        let active_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_identifier_lease WHERE category_id = 'cat-f' AND sector_id = 's1' AND status = 'active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_count, 1, "exactly one active lease must exist after renewal");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_renewal_race_lost() {
        let (dir, _state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        ensure_lease(&conn);

        // Simulate another process already exhausting the lease
        conn.execute(
            "UPDATE local_identifier_lease SET status = 'exhausted' WHERE id = 'L1'",
            [],
        )
        .unwrap();

        let new_lease = make_new_lease("L2", 51, 100);
        let applied = apply_lease_renewal(&mut conn, "L1", &new_lease).unwrap();
        assert!(!applied, "must return false when old lease is already exhausted");

        // New lease must NOT have been inserted
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_identifier_lease WHERE id = 'L2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "new lease must not be inserted when race is lost");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_renewal_idempotent_same_new_lease() {
        let (dir, _state, mut conn) = identifier_test_env();
        ensure_category(&conn);
        ensure_lease(&conn);

        let new_lease = make_new_lease("L2", 51, 100);

        // First call succeeds
        let first = apply_lease_renewal(&mut conn, "L1", &new_lease).unwrap();
        assert!(first);

        // Second call with same old ID: old is already exhausted, race lost
        let second = apply_lease_renewal(&mut conn, "L1", &new_lease).unwrap();
        assert!(!second, "second call with exhausted old lease must lose race");

        // Still only one active lease
        let active_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_identifier_lease WHERE category_id = 'cat-f' AND sector_id = 's1' AND status = 'active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_count, 1, "unique index must prevent duplicate active leases");
        fs::remove_dir_all(&dir).ok();
    }
}
