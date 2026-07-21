use crate::db::{build_identifier_string, IDENTIFIER_FORMAT_VERSION};
use crate::sync::SyncState;
use chrono::{Datelike, Local};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

// ============================================================
// Structs públicas
// ============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineIdentifierResult {
    pub id: String,
    pub idempotency_key: String,
    pub identifier: String,
    pub sequence: u32,
    pub fiscal: bool,
    pub format_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingIdentifier {
    pub id: String,
    pub idempotency_key: String,
    pub category_id: String,
    pub device_id: String,
    pub identifier: String,
    pub sequence: Option<i32>,
    pub lease_id: Option<String>,
    pub issued_to: Option<String>,
    pub description: Option<String>,
    pub visibility: String,
    pub origin: String,
    pub sector_id: String,
    pub status: String,
    pub attempts: i32,
    pub last_error: Option<String>,
    pub conflict_reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeaseItem {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheCategoryInput {
    pub category_id: String,
    pub prefix: String,
    pub requires_sequential: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteLeaseReleaseResult {
    pub lease_id: String,
    pub affected_pending: usize,
}

// ============================================================
// cache_categories — upsert categorias na cache local
// ============================================================
#[tauri::command]
pub fn cache_categories(
    state: State<'_, SyncState>,
    categories: Vec<CacheCategoryInput>,
) -> Result<(), String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().to_rfc3339();

    for cat in &categories {
        conn.execute(
            "INSERT INTO local_category_cache (category_id, prefix, requires_sequential, last_synced_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(category_id) DO UPDATE SET
                prefix = excluded.prefix,
                requires_sequential = excluded.requires_sequential,
                last_synced_at = excluded.last_synced_at",
            params![
                cat.category_id,
                cat.prefix,
                cat.requires_sequential as i32,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ============================================================
// cache_tenant_state — guarda/actualiza estado do tenant
// ============================================================
#[tauri::command]
pub fn cache_tenant_state(
    state: State<'_, SyncState>,
    tenant_id: String,
    org_prefix: String,
    lease_batch_size: Option<i32>,
) -> Result<(), String> {
    let conn = state.conn()?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO local_tenant_state (tenant_id, org_prefix, lease_batch_size, last_sync_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(tenant_id) DO UPDATE SET
            org_prefix = excluded.org_prefix,
            lease_batch_size = COALESCE(excluded.lease_batch_size, local_tenant_state.lease_batch_size),
            last_sync_at = excluded.last_sync_at",
        params![tenant_id, org_prefix, lease_batch_size.unwrap_or(50), now],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================
// get_pending_identifiers — lista fila de pendentes
// ============================================================
pub fn get_pending_identifiers_inner(state: &SyncState) -> Result<Vec<PendingIdentifier>, String> {
    let conn = state.conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, idempotency_key, category_id, device_id, identifier, sequence,
                    lease_id, issued_to, description, visibility, origin, sector_id,
                    status, attempts, last_error, conflict_reason, created_at
             FROM local_pending_identifiers
             WHERE status IN ('pending', 'conflict', 'failed')
             ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_pending)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

#[tauri::command]
pub fn get_pending_identifiers(
    state: State<'_, SyncState>,
) -> Result<Vec<PendingIdentifier>, String> {
    get_pending_identifiers_inner(state.inner())
}

fn row_to_pending(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingIdentifier> {
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

// ============================================================
// clear_synced_identifier — remove após sync bem-sucedido
// ============================================================
#[tauri::command]
pub fn clear_synced_identifier(state: State<'_, SyncState>, id: String) -> Result<(), String> {
    let conn = state.conn()?;
    conn.execute(
        "DELETE FROM local_pending_identifiers WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_lease_remote_released_inner(
    state: &SyncState,
    lease_id: String,
) -> Result<RemoteLeaseReleaseResult, String> {
    let mut conn = state.conn()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let affected_lease = tx
        .execute(
            "UPDATE local_identifier_lease
             SET status = 'remote_released'
             WHERE id = ?1 AND status != 'remote_released'",
            params![lease_id],
        )
        .map_err(|e| e.to_string())?;

    if affected_lease == 0 {
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM local_identifier_lease WHERE id = ?1",
                params![lease_id],
                |row| row.get::<_, i32>(0),
            )
            .map(|count| count > 0)
            .map_err(|e| e.to_string())?;

        if !exists {
            return Err("Lease não encontrado.".to_string());
        }
    }

    let affected_pending = tx
        .execute(
            "UPDATE local_pending_identifiers
             SET status = 'conflict',
                 conflict_reason = 'LEASE_FORCE_RELEASED',
                 last_error = 'Lease revogado. Reconecte para obter um novo lease.'
             WHERE lease_id = ?1 AND status = 'pending'",
            params![lease_id],
        )
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(RemoteLeaseReleaseResult {
        lease_id,
        affected_pending,
    })
}

#[tauri::command]
pub fn mark_lease_remote_released(
    state: State<'_, SyncState>,
    lease_id: String,
) -> Result<RemoteLeaseReleaseResult, String> {
    mark_lease_remote_released_inner(state.inner(), lease_id)
}

// ============================================================
// get_leases — lista leases activos
// ============================================================
#[tauri::command]
pub fn get_leases(state: State<'_, SyncState>) -> Result<Vec<LeaseItem>, String> {
    let conn = state.conn()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, category_id, device_id, sector_id, start_seq, end_seq,
                    next_to_use, status, created_at
             FROM local_identifier_lease
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], row_to_lease)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}

fn row_to_lease(row: &rusqlite::Row<'_>) -> rusqlite::Result<LeaseItem> {
    Ok(LeaseItem {
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
}

// ============================================================
// generate_offline_identifier — ponto de entrada único
// ============================================================
pub fn generate_offline_identifier_inner(
    state: &SyncState,
    category_id: String,
    device_id: String,
    sector_id: String,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    origin: Option<String>,
) -> Result<OfflineIdentifierResult, String> {
    let mut conn = state.conn()?;

    // 1. Ler categoria da cache local
    let cat = conn
        .query_row(
            "SELECT prefix, requires_sequential FROM local_category_cache WHERE category_id = ?1",
            params![category_id],
            |row| {
                let prefix: String = row.get(0)?;
                let seq: i32 = row.get(1)?;
                Ok((prefix, seq != 0))
            },
        )
        .map_err(|_| {
            "Categoria não encontrada na cache local. Sincronize categorias enquanto online."
                .to_string()
        })?;

    let (cat_prefix, requires_sequential) = cat;

    // 2. Ler org_prefix do tenant
    let org_prefix: String = conn
        .query_row(
            "SELECT org_prefix FROM local_tenant_state LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "VL".to_string());

    // 3. Data local para montar o identificador
    let now = Local::now();
    let year = now.year();
    let month = now.month();
    let day = now.day();

    // 4. Gerar UUIDs para o registo
    let pending_id = Uuid::new_v4().to_string();
    let idempotency_key = Uuid::new_v4().to_string();

    if requires_sequential {
        generate_fiscal(
            &mut conn,
            &category_id,
            &device_id,
            &sector_id,
            &cat_prefix,
            &org_prefix,
            year,
            month,
            day,
            &pending_id,
            &idempotency_key,
            issued_to,
            description,
            visibility,
            origin,
        )
    } else {
        generate_non_fiscal(
            &mut conn,
            &category_id,
            &device_id,
            &sector_id,
            &cat_prefix,
            &org_prefix,
            year,
            month,
            day,
            &pending_id,
            &idempotency_key,
            issued_to,
            description,
            visibility,
            origin,
        )
    }
}

#[tauri::command]
pub fn generate_offline_identifier(
    state: State<'_, SyncState>,
    category_id: String,
    device_id: String,
    sector_id: String,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    origin: Option<String>,
) -> Result<OfflineIdentifierResult, String> {
    generate_offline_identifier_inner(
        state.inner(),
        category_id,
        device_id,
        sector_id,
        issued_to,
        description,
        visibility,
        origin,
    )
}

fn generate_fiscal(
    conn: &mut rusqlite::Connection,
    category_id: &str,
    device_id: &str,
    sector_id: &str,
    cat_prefix: &str,
    org_prefix: &str,
    year: i32,
    month: u32,
    day: u32,
    pending_id: &str,
    idempotency_key: &str,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    origin: Option<String>,
) -> Result<OfflineIdentifierResult, String> {
    let lease = conn
        .query_row(
            "SELECT id, start_seq, end_seq, next_to_use, status
             FROM local_identifier_lease
             WHERE category_id = ?1 AND sector_id = ?2
             ORDER BY CASE status
                WHEN 'active' THEN 0
                WHEN 'remote_released' THEN 1
                WHEN 'exhausted' THEN 2
                ELSE 3
             END
             LIMIT 1",
            params![category_id, sector_id],
            |row| {
                let id: String = row.get(0)?;
                let start_seq: i32 = row.get(1)?;
                let end_seq: i32 = row.get(2)?;
                let next_to_use: i32 = row.get(3)?;
                let status: String = row.get(4)?;
                Ok((id, start_seq, end_seq, next_to_use, status))
            },
        )
        .map_err(|_| {
            "Sem lease activo para esta categoria. Use o comando request_lease primeiro."
                .to_string()
        })?;

    let (lease_id, _start_seq, end_seq, next_to_use, status) = lease;

    match status.as_str() {
        "active" => {}
        "remote_released" => {
            return Err("Lease revogado. Reconecte para obter um novo lease.".to_string());
        }
        "exhausted" => {
            return Err("Lease esgotado. Reconecte para reservar mais números.".to_string());
        }
        _ => return Err("Estado de lease inválido.".to_string()),
    }

    // Validar estado do lease
    if next_to_use > end_seq {
        return Err("Lease esgotado. Reconecte para reservar mais números.".to_string());
    }

    let sequence = next_to_use as u32;

    // Transacção atómica
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE local_identifier_lease SET next_to_use = next_to_use + 1 WHERE id = ?1",
        params![lease_id],
    )
    .map_err(|e| e.to_string())?;

    let identifier = build_identifier_string(org_prefix, cat_prefix, year, month, day, sequence);

    insert_pending(
        &tx,
        pending_id,
        idempotency_key,
        category_id,
        device_id,
        &identifier,
        Some(sequence as i32),
        Some(&lease_id),
        sector_id,
        issued_to,
        description,
        visibility,
        origin,
    )?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(OfflineIdentifierResult {
        id: pending_id.to_string(),
        idempotency_key: idempotency_key.to_string(),
        identifier,
        sequence,
        fiscal: true,
        format_version: IDENTIFIER_FORMAT_VERSION,
    })
}

fn generate_non_fiscal(
    conn: &mut rusqlite::Connection,
    category_id: &str,
    device_id: &str,
    sector_id: &str,
    cat_prefix: &str,
    org_prefix: &str,
    year: i32,
    month: u32,
    day: u32,
    pending_id: &str,
    idempotency_key: &str,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    origin: Option<String>,
) -> Result<OfflineIdentifierResult, String> {
    // Transacção atómica: ler contador, actualizar, inserir pending
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Inserir contador se não existir (next_seq = 1)
    tx.execute(
        "INSERT OR IGNORE INTO local_loose_counters (category_id, sector_id, next_seq)
         VALUES (?1, ?2, 1)",
        params![category_id, sector_id],
    )
    .map_err(|e| e.to_string())?;

    let next_seq: i32 = tx
        .query_row(
            "SELECT next_seq FROM local_loose_counters
             WHERE category_id = ?1 AND sector_id = ?2",
            params![category_id, sector_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let sequence = next_seq as u32;

    tx.execute(
        "UPDATE local_loose_counters SET next_seq = next_seq + 1
         WHERE category_id = ?1 AND sector_id = ?2",
        params![category_id, sector_id],
    )
    .map_err(|e| e.to_string())?;

    let identifier = build_identifier_string(org_prefix, cat_prefix, year, month, day, sequence);

    insert_pending(
        &tx,
        pending_id,
        idempotency_key,
        category_id,
        device_id,
        &identifier,
        Some(sequence as i32),
        None, // sem lease_id
        sector_id,
        issued_to,
        description,
        visibility,
        origin,
    )?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(OfflineIdentifierResult {
        id: pending_id.to_string(),
        idempotency_key: idempotency_key.to_string(),
        identifier,
        sequence,
        fiscal: false,
        format_version: IDENTIFIER_FORMAT_VERSION,
    })
}

fn insert_pending(
    tx: &rusqlite::Transaction<'_>,
    id: &str,
    idempotency_key: &str,
    category_id: &str,
    device_id: &str,
    identifier: &str,
    sequence: Option<i32>,
    lease_id: Option<&str>,
    sector_id: &str,
    issued_to: Option<String>,
    description: Option<String>,
    visibility: Option<String>,
    origin: Option<String>,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let vis = visibility.unwrap_or_else(|| "public".to_string());
    let orig = origin.unwrap_or_else(|| "physical".to_string());

    tx.execute(
        "INSERT INTO local_pending_identifiers
            (id, idempotency_key, category_id, device_id, identifier, sequence, lease_id,
             issued_to, description, visibility, origin, sector_id, status, attempts, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', 0, ?13)",
        params![
            id,
            idempotency_key,
            category_id,
            device_id,
            identifier,
            sequence,
            lease_id,
            issued_to,
            description,
            vis,
            orig,
            sector_id,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ============================================================
// request_lease — pede lease ao servidor e guarda localmente
// ============================================================
#[tauri::command]
pub async fn request_lease(
    state: State<'_, SyncState>,
    category_id: String,
    device_id: String,
    sector_id: String,
) -> Result<LeaseItem, String> {
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

    // Verificar se categoria existe na cache
    {
        let conn = state.conn()?;
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM local_category_cache WHERE category_id = ?1",
                params![category_id],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if !exists {
            return Err(
                "Categoria não encontrada na cache local. Sincronize categorias primeiro."
                    .to_string(),
            );
        }
    }

    // Chamar servidor
    let body = serde_json::json!({
        "deviceId": device_id,
        "categoryId": category_id,
        "sectorId": sector_id,
    });

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| format!("Erro ao criar cliente HTTP: {e}"))?;

    let resp = client
        .post(format!("{api_base_url}/identifiers/lease"))
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Sem resposta do servidor (timeout). Verifique a ligação.".to_string()
            } else if e.is_connect() {
                "Sem ligação ao servidor. Verifique se está online.".to_string()
            } else {
                format!("Erro de rede: {e}")
            }
        })?;

    let status = resp.status();
    let response_body = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        // Tentar extrair mensagem de erro do corpo
        if let Ok(err) = serde_json::from_str::<serde_json::Value>(&response_body) {
            let msg = err
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
                .unwrap_or("Erro desconhecido do servidor.");
            return Err(msg.to_string());
        }
        return Err(response_body);
    }

    // Parse resposta
    let server_lease: serde_json::Value =
        serde_json::from_str(&response_body).map_err(|e| e.to_string())?;

    // A resposta pode vir como { data: { id, ... } } ou directamente
    let data = server_lease.get("data").unwrap_or(&server_lease).clone();

    let lease_id = data
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Resposta do servidor não inclui id do lease.".to_string())?;

    let start_seq: i32 = data
        .get("startSeq")
        .or_else(|| data.get("start_seq"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .ok_or_else(|| "Resposta do servidor não inclui startSeq.".to_string())?;

    let end_seq: i32 = data
        .get("endSeq")
        .or_else(|| data.get("end_seq"))
        .and_then(|v| v.as_i64())
        .map(|v| v as i32)
        .ok_or_else(|| "Resposta do servidor não inclui endSeq.".to_string())?;

    let now = chrono::Utc::now().to_rfc3339();

    // Guardar localmente
    let conn = state.conn()?;
    conn.execute(
        "INSERT INTO local_identifier_lease
            (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8)
         ON CONFLICT(id) DO UPDATE SET
            end_seq = excluded.end_seq,
            next_to_use = CASE WHEN excluded.next_to_use < local_identifier_lease.next_to_use
                               THEN local_identifier_lease.next_to_use
                               ELSE excluded.next_to_use END,
            status = 'active'",
        params![
            lease_id,
            category_id,
            device_id,
            sector_id,
            start_seq,
            end_seq,
            start_seq,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(LeaseItem {
        id: lease_id.to_string(),
        category_id,
        device_id,
        sector_id,
        start_seq,
        end_seq,
        next_to_use: start_seq,
        status: "active".to_string(),
        created_at: now,
    })
}

// ============================================================
// Testes
// ============================================================
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn setup() -> (PathBuf, SyncState) {
        let dir = std::env::temp_dir().join(format!("docid_test_idents_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        // open once to create tables
        crate::db::open(&db_path).unwrap();

        let state = SyncState {
            db_path: db_path.clone(),
            uploads_dir: dir.clone(),
            api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
            auth_token: std::sync::Mutex::new(None),
            syncing: std::sync::Mutex::new(false),
        };
        (dir, state)
    }

    fn seed_category(state: &SyncState, id: &str, prefix: &str, seq: bool) {
        let conn = state.conn().unwrap();
        conn.execute(
            "INSERT INTO local_category_cache (category_id, prefix, requires_sequential, last_synced_at)
             VALUES (?1, ?2, ?3, '2026-07-21T12:00:00Z')",
            params![id, prefix, seq as i32],
        )
        .unwrap();
    }

    fn seed_lease(state: &SyncState, lease_id: &str, cat: &str, start: i32, end: i32, next: i32) {
        let conn = state.conn().unwrap();
        conn.execute(
            "INSERT INTO local_identifier_lease
                (id, category_id, device_id, sector_id, start_seq, end_seq, next_to_use, status, created_at)
             VALUES (?1, ?2, 'dev-1', 's1', ?3, ?4, ?5, 'active', '2026-07-21T12:00:00Z')",
            params![lease_id, cat, start, end, next],
        )
        .unwrap();
    }

    fn seed_tenant(state: &SyncState, prefix: &str) {
        let conn = state.conn().unwrap();
        conn.execute(
            "INSERT INTO local_tenant_state (tenant_id, org_prefix, lease_batch_size, last_sync_at)
             VALUES ('t1', ?1, 50, '2026-07-21T12:00:00Z')",
            params![prefix],
        )
        .unwrap();
    }

    // ============================================================
    // Teste 2: fiscal_uses_lease
    // ============================================================
    #[test]
    fn generate_fiscal_consumes_lease() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 50, 1);

        let r = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert!(r.fiscal);
        assert_eq!(r.sequence, 1);
        assert_eq!(r.format_version, IDENTIFIER_FORMAT_VERSION);
        assert!(r.identifier.contains("FISC"));
        assert!(r.identifier.ends_with("-001"));

        // Segunda chamada
        let r2 = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r2.sequence, 2);
        assert!(r2.identifier.ends_with("-002"));

        // Verificar next_to_use
        let conn = state.conn().unwrap();
        let ntu: i32 = conn
            .query_row(
                "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ntu, 3);
    }

    // ============================================================
    // Teste 3: non_fiscal_uses_counter
    // ============================================================
    #[test]
    fn generate_non_fiscal_increments_counter() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-nf", "LOOSE", false);

        let r = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert!(!r.fiscal);
        assert_eq!(r.sequence, 1);

        // Segunda chamada — mesmo (category_id, sector_id)
        let r2 = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r2.sequence, 2);

        // Contador isolado por sector
        let r3 = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s2".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r3.sequence, 1); // novo sector começa em 1
    }

    // ============================================================
    // Teste 5: lease_exhausted
    // ============================================================
    #[test]
    fn fiscal_lease_exhausted_returns_error() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 1, 1); // apenas [1, 1]

        // Consumir a única sequência
        let r = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r.sequence, 1);

        // Segunda chamada deve falhar
        let err = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(
            err.contains("esgotado"),
            "Erro deve mencionar esgotado: {err}"
        );
    }

    // ============================================================
    // Teste 6: idempotency_key_generated
    // ============================================================
    #[test]
    fn each_generation_has_unique_idempotency_key() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-nf", "LOOSE", false);

        let r1 = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let r2 = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_ne!(r1.idempotency_key, r2.idempotency_key);
        assert_ne!(r1.id, r2.id);
    }

    // ============================================================
    // Teste 7: conflict_reason_persisted — via get_pending_identifiers
    // ============================================================
    #[test]
    fn pending_identifiers_show_conflict_reason() {
        let (_dir, state) = setup();
        seed_category(&state, "cat-f", "FISC", true);

        let conn = state.conn().unwrap();
        conn.execute(
            "INSERT INTO local_pending_identifiers
                (id, idempotency_key, category_id, device_id, identifier, sequence, lease_id,
                 sector_id, status, conflict_reason, created_at)
             VALUES ('x', 'y', 'cat-f', 'dev-1', 'TST', 1, NULL,
                     's1', 'conflict', 'LEASE_FORCE_RELEASED', '2026-07-21T12:00:00Z')",
            [],
        )
        .unwrap();

        let pending = get_pending_identifiers_inner(&state).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(
            pending[0].conflict_reason.as_deref(),
            Some("LEASE_FORCE_RELEASED")
        );
        assert_eq!(pending[0].status, "conflict");
    }

    // ============================================================
    // Teste 8: state_survives_reopen (counter + pending)
    // ============================================================
    #[test]
    fn loose_counter_and_pending_survive_reopen() {
        let dir = std::env::temp_dir().join(format!("docid_test_reopen_{}", Uuid::new_v4()));
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

        seed_tenant(&state, "VL");
        seed_category(&state, "cat-nf", "LOOSE", false);

        // Gerar 3 identificadores
        for _ in 0..3 {
            generate_offline_identifier_inner(
                &state,
                "cat-nf".into(),
                "dev-1".into(),
                "s1".into(),
                None,
                None,
                None,
                None,
            )
            .unwrap();
        }
        drop(state); // fechar

        // Reabrir
        let state2 = SyncState {
            db_path,
            uploads_dir: dir.clone(),
            api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
            auth_token: std::sync::Mutex::new(None),
            syncing: std::sync::Mutex::new(false),
        };

        // Contador deve estar em 4
        let conn = state2.conn().unwrap();
        let next: i32 = conn
            .query_row(
                "SELECT next_seq FROM local_loose_counters WHERE category_id = 'cat-nf' AND sector_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next, 4);

        // Devem existir 3 pending
        let pending = get_pending_identifiers_inner(&state2).unwrap();
        assert_eq!(pending.len(), 3);

        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // Teste 9: generation_atomic_after_crash (fiscal)
    // ============================================================
    #[test]
    fn fiscal_generation_rollback_does_not_advance_next_to_use() {
        let dir = std::env::temp_dir().join(format!("docid_test_crash_{}", Uuid::new_v4()));
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

        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 50, 1);
        drop(state);

        // Reabrir, fazer transacção parcial e rollback
        let _state2 = SyncState {
            db_path: db_path.clone(),
            uploads_dir: dir.clone(),
            api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
            auth_token: std::sync::Mutex::new(None),
            syncing: std::sync::Mutex::new(false),
        };

        {
            let mut conn = crate::db::open(&db_path).unwrap();
            let tx = conn.transaction().unwrap();
            tx.execute(
                "UPDATE local_identifier_lease SET next_to_use = 43 WHERE id = 'l1'",
                [],
            )
            .unwrap();
            // Rollback — simula crash antes de inserir pending
            tx.rollback().unwrap();
        }

        // Verificar que next_to_use reverteu
        {
            let conn = crate::db::open(&db_path).unwrap();
            let ntu: i32 = conn
                .query_row(
                    "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l1'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(ntu, 1, "ROLLBACK deve reverter next_to_use");

            let count: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM local_pending_identifiers",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "ROLLBACK não deve deixar pending");
        }

        fs::remove_dir_all(&dir).ok();
    }

    // ============================================================
    // Teste 10: lease inexistente (erro claro)
    // ============================================================
    #[test]
    fn fiscal_no_active_lease_returns_clear_error() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        // Não criar lease

        let err = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(
            err.contains("request_lease"),
            "Erro deve sugerir request_lease: {err}"
        );
    }

    // ============================================================
    // Teste de integração 1: comando fiscal via &SyncState
    // ============================================================
    #[test]
    fn generate_offline_identifier_integration_like_fiscal() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 50, 1);

        let r = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert!(r.fiscal);
        assert_eq!(r.sequence, 1);
        assert!(r.identifier.contains("FISC"));

        // Segunda geração avança next_to_use
        let r2 = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r2.sequence, 2);

        // next_to_use no SQLite
        let conn = state.conn().unwrap();
        let ntu: i32 = conn
            .query_row(
                "SELECT next_to_use FROM local_identifier_lease WHERE id = 'l1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(ntu, 3);

        // pending registado
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_pending_identifiers",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    // ============================================================
    // Teste de integração 2: comando não fiscal via &SyncState
    // ============================================================
    #[test]
    fn generate_offline_identifier_integration_like_non_fiscal() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-nf", "LOOSE", false);

        let r = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert!(!r.fiscal);
        assert_eq!(r.sequence, 1);

        // Segunda geração incrementa contador
        let r2 = generate_offline_identifier_inner(
            &state,
            "cat-nf".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r2.sequence, 2);

        // Contador persistiu
        let conn = state.conn().unwrap();
        let next: i32 = conn
            .query_row(
                "SELECT next_seq FROM local_loose_counters
                 WHERE category_id = 'cat-nf' AND sector_id = 's1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(next, 3);
    }

    // ============================================================
    // Teste de integração 3: force-release bloqueia geração
    // ============================================================
    #[test]
    fn force_release_blocks_generation_end_to_end() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 50, 1);

        // Gerar 1 identificador com lease activo
        let r = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(r.sequence, 1);

        let release = mark_lease_remote_released_inner(&state, "l1".into()).unwrap();
        assert_eq!(release.lease_id, "l1");
        assert_eq!(release.affected_pending, 1);

        // Tentar gerar deve falhar com erro específico
        let err = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(
            err.contains("revogado"),
            "Erro deve mencionar lease revogado: {err}"
        );
    }

    #[test]
    fn force_release_marks_pending_and_blocks_generation() {
        let (_dir, state) = setup();
        seed_tenant(&state, "VL");
        seed_category(&state, "cat-f", "FISC", true);
        seed_lease(&state, "l1", "cat-f", 1, 50, 1);

        let first = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let second = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(first.sequence, 1);
        assert_eq!(second.sequence, 2);

        let release = mark_lease_remote_released_inner(&state, "l1".into()).unwrap();
        assert_eq!(release.affected_pending, 2);

        let conn = state.conn().unwrap();
        let lease_status: String = conn
            .query_row(
                "SELECT status FROM local_identifier_lease WHERE id = 'l1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lease_status, "remote_released");

        let conflicted: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM local_pending_identifiers
                 WHERE lease_id = 'l1'
                   AND status = 'conflict'
                   AND conflict_reason = 'LEASE_FORCE_RELEASED'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(conflicted, 2);

        let pending = get_pending_identifiers_inner(&state).unwrap();
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().all(|item| item.status == "conflict"));
        assert!(pending
            .iter()
            .all(|item| { item.conflict_reason.as_deref() == Some("LEASE_FORCE_RELEASED") }));

        let err = generate_offline_identifier_inner(
            &state,
            "cat-f".into(),
            "dev-1".into(),
            "s1".into(),
            None,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert_eq!(err, "Lease revogado. Reconecte para obter um novo lease.");
    }
}
