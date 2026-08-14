use crate::commands::text_extraction::{extract_text_from_docx, extract_text_from_pdf, extract_text_from_txt};
use crate::db;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use rusqlite::params;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::SystemTime;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

static IDENTIFIER_RE: OnceLock<Regex> = OnceLock::new();
const SEEN_FILE: &str = "watcher_seen.json";

fn identifier_re() -> &'static Regex {
    IDENTIFIER_RE.get_or_init(|| Regex::new(r"[A-Z]{1,6}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3}").unwrap())
}

pub fn find_identifier(text: &str) -> Option<String> {
    identifier_re().find(text).map(|m| m.as_str().to_string())
}

fn load_seen(app_data: &Path) -> HashMap<String, u64> {
    let p = app_data.join(SEEN_FILE);
    if p.exists() {
        std::fs::read_to_string(&p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    } else {
        HashMap::new()
    }
}

fn save_seen(app_data: &Path, seen: &HashMap<String, u64>) {
    if let Ok(json) = serde_json::to_string(seen) {
        let p = app_data.join(SEEN_FILE);
        let tmp = p.with_extension("tmp");
        if std::fs::write(&tmp, &json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

fn file_mtime(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn walk_files(dir: &Path, max_depth: u32) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(dir.to_path_buf(), 0)];
    while let Some((cur, depth)) = stack.pop() {
        if depth >= max_depth { continue; }
        if let Ok(entries) = std::fs::read_dir(&cur) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() { stack.push((p, depth + 1)); } else { out.push(p); }
            }
        }
    }
    out
}

fn supported_ext(ext: &str) -> bool {
    matches!(ext, "pdf" | "txt" | "md" | "csv" | "docx" | "xlsx" | "png" | "jpg" | "jpeg")
}

fn app_db_path(app_data: &Path) -> PathBuf {
    app_data.join("offline.db")
}

/// Insere ou actualiza o registo de um ficheiro detectado (upsert por path).
/// Devolve `true` se o ficheiro está em `detected` (novo ou ainda por decidir)
/// e deve emitir evento; `false` se o utilizador já escolheu pending/added/ignored.
fn upsert_watcher_file(
    app_data: &Path,
    path: &Path,
    mtime: u64,
    identifier: Option<&str>,
) -> rusqlite::Result<bool> {
    let conn = db::open(&app_db_path(app_data))?;
    let now = chrono::Utc::now().to_rfc3339();
    // Não reseta um "mais tarde"/ignorado/adicionado se o ficheiro for re-detectado.
    conn.execute(
        "INSERT INTO watcher_files (path, mtime, status, kind, identifier, created_at, updated_at)
         VALUES (?1, ?2, 'detected', ?3, ?4, ?5, ?5)
         ON CONFLICT(path) DO UPDATE SET
            mtime = excluded.mtime,
            kind = excluded.kind,
            identifier = COALESCE(excluded.identifier, watcher_files.identifier),
            updated_at = excluded.updated_at",
        params![
            path.to_string_lossy(),
            mtime,
            if identifier.is_some() { "identifier_found" } else { "file_detected" },
            identifier,
            now,
        ],
    )?;
    let status: String = conn.query_row(
        "SELECT status FROM watcher_files WHERE path = ?1",
        params![path.to_string_lossy()],
        |r| r.get(0),
    )?;
    Ok(status == "detected")
}

fn check_and_emit(path: &Path, app: &AppHandle, seen: &mut HashMap<String, u64>, app_data: &Path, allowed_roots: &[PathBuf]) {
    let canonical = match path.canonicalize() { Ok(c) => c, Err(_) => return };

    // Ensure the canonical path is within one of the allowed watched folders to avoid
    // following symlinks outside the monitored tree.
    let mut allowed = false;
    for root in allowed_roots {
        if let Ok(root_can) = root.canonicalize() {
            if canonical.starts_with(&root_can) { allowed = true; break; }
        } else if canonical.starts_with(root) {
            allowed = true; break;
        }
    }
    if !allowed { return; }

    let mtime = match file_mtime(&canonical) { Some(m) => m, None => return };
    let key = canonical.to_string_lossy().to_string();
    let is_new = seen.get(&key) != Some(&mtime);
    if !is_new { return; }
    seen.insert(key, mtime);
    save_seen(app_data, seen);

    let ext = canonical.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !supported_ext(&ext) { return; }

    let (kind, identifier) = match ext.as_str() {
        "pdf" | "txt" | "md" | "csv" | "docx" => {
            let text = match ext.as_str() {
                "pdf" => extract_text_from_pdf(&canonical),
                "docx" => extract_text_from_docx(&canonical),
                _ => extract_text_from_txt(&canonical),
            };
            match text {
                Ok(t) => {
                    if let Some(id) = find_identifier(&t) {
                        ("identifier_found", Some(id))
                    } else {
                        ("file_detected", None)
                    }
                }
                Err(_) => ("file_detected", None),
            }
        }
        _ => ("file_detected", None),
    };

    let should_emit = upsert_watcher_file(app_data, &canonical, mtime, identifier.as_deref()).unwrap_or(true);
    if !should_emit { return; }

    let payload = serde_json::json!({
        "path": canonical.to_string_lossy(),
        "ext": ext,
        "identifier": identifier,
    });
    match kind {
        "identifier_found" => { let _ = app.emit("watcher:identifier_found", payload); }
        _ => { let _ = app.emit("watcher:file_detected", payload); }
    }
}

pub struct WatcherState {
    pub running: AtomicBool,
    pub folders: Mutex<Vec<PathBuf>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            folders: Mutex::new(Vec::new()),
        }
    }
}

#[tauri::command]
pub async fn start_watcher(app: AppHandle, state: tauri::State<'_, WatcherState>) -> Result<String, String> {
    if state.running.load(Ordering::SeqCst) {
        return Err("Watcher já está em execução.".to_string());
    }

    {
        let folders = state.folders.lock().await;
        if folders.is_empty() {
            return Err("Nenhuma pasta configurada para monitorizar.".to_string());
        }
    }

    state.running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();

    tokio::spawn(async move {
        let state = app_clone.state::<WatcherState>();
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);
        let app_data = app_clone.path().app_data_dir().expect("app data dir");

        let folders = state.folders.lock().await;
        let folders_vec = folders.clone();
        drop(folders);

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.try_send(event);
                }
            },
            Config::default(),
        )
        .expect("Falha ao criar watcher");

        for folder in &folders_vec {
            if let Err(e) = watcher.watch(folder, RecursiveMode::Recursive) {
                eprintln!("Erro ao monitorizar {:?}: {}", folder, e);
            }
        }

        let mut seen = load_seen(&app_data);

        for folder in &folders_vec {
            for f in walk_files(folder, 32) {
                check_and_emit(&f, &app_clone, &mut seen, &app_data, &folders_vec);
            }
        }

        while state.running.load(Ordering::SeqCst) {
            tokio::select! {
                Some(event) = rx.recv() => {
                    if let EventKind::Create(_) = event.kind {
                        for path in &event.paths {
                            check_and_emit(path, &app_clone, &mut seen, &app_data, &folders_vec);
                        }
                    }
                }
                else => break,
            }
        }

        state.running.store(false, Ordering::SeqCst);
    });

    Ok("Watcher iniciado com sucesso.".to_string())
}

#[tauri::command]
pub async fn stop_watcher(state: tauri::State<'_, WatcherState>) -> Result<String, String> {
    state.running.store(false, Ordering::SeqCst);
    Ok("Watcher parado.".to_string())
}

#[tauri::command]
pub async fn is_watcher_running(state: tauri::State<'_, WatcherState>) -> Result<bool, String> {
    Ok(state.running.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn add_watched_folder(path: String, state: tauri::State<'_, WatcherState>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err("Pasta não encontrada.".to_string());
    }
    let canonical = p.canonicalize().map_err(|_| "Erro ao resolver caminho.".to_string())?;
    let mut folders = state.folders.lock().await;
    if !folders.contains(&canonical) {
        folders.push(canonical.clone());
    }
    Ok(format!("Pasta adicionada: {}", canonical.to_string_lossy()))
}

#[tauri::command]
pub async fn remove_watched_folder(path: String, state: tauri::State<'_, WatcherState>) -> Result<String, String> {
    let p = PathBuf::from(&path);
    let canonical = p.canonicalize().unwrap_or(p);
    let mut folders = state.folders.lock().await;
    folders.retain(|f| f != &canonical);
    Ok(format!("Pasta removida: {}", canonical.to_string_lossy()))
}

#[tauri::command]
pub async fn get_watched_folders(state: tauri::State<'_, WatcherState>) -> Result<Vec<String>, String> {
    let folders = state.folders.lock().await;
    Ok(folders.iter().map(|f| f.to_string_lossy().to_string()).collect())
}

#[derive(Serialize)]
pub struct WatcherFileRow {
    pub path: String,
    pub status: String,
    pub kind: String,
    pub identifier: Option<String>,
    pub mtime: i64,
    pub created_at: String,
    pub updated_at: String,
}

fn open_watcher_db(app: &AppHandle) -> Result<rusqlite::Connection, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    db::open(&app_db_path(&app_data)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watcher_get_files(app: AppHandle, status: Option<String>) -> Result<Vec<WatcherFileRow>, String> {
    let conn = open_watcher_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT path, status, kind, identifier, mtime, created_at, updated_at
         FROM watcher_files
         WHERE (?1 IS NULL OR status = ?1)
         ORDER BY updated_at DESC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![status], |r| Ok(WatcherFileRow {
        path: r.get(0)?, status: r.get(1)?, kind: r.get(2)?,
        identifier: r.get(3)?, mtime: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?,
    })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub async fn watcher_set_file_status(app: AppHandle, path: String, status: String) -> Result<(), String> {
    let valid = matches!(status.as_str(), "detected" | "pending" | "added" | "ignored");
    if !valid {
        return Err("Status inválido. Use detected, pending, added ou ignored.".to_string());
    }
    let conn = open_watcher_db(&app)?;
    let now = chrono::Utc::now().to_rfc3339();
    let rows = conn.execute(
        "UPDATE watcher_files SET status = ?1, updated_at = ?2 WHERE path = ?3",
        params![status, now, path],
    ).map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err("Ficheiro não encontrado no registo do watcher.".to_string());
    }
    app.emit("watcher:status_changed", serde_json::json!({"path": path, "status": status})).ok();
    Ok(())
}

#[tauri::command]
pub async fn watcher_get_reminders(app: AppHandle) -> Result<Vec<WatcherFileRow>, String> {
    let conn = open_watcher_db(&app)?;
    let mut stmt = conn.prepare(
        "SELECT path, status, kind, identifier, mtime, created_at, updated_at
         FROM watcher_files WHERE status = 'pending' ORDER BY updated_at DESC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(WatcherFileRow {
        path: r.get(0)?, status: r.get(1)?, kind: r.get(2)?,
        identifier: r.get(3)?, mtime: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?,
    })).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(rows)
}

#[derive(Serialize)]
pub struct WatcherReport {
    pub detected: i64,
    pub pending: i64,
    pub added: i64,
    pub ignored: i64,
    pub identifier_found: i64,
    pub file_detected: i64,
}

#[tauri::command]
pub async fn watcher_get_report(app: AppHandle) -> Result<WatcherReport, String> {
    let conn = open_watcher_db(&app)?;
    let mut out = WatcherReport { detected: 0, pending: 0, added: 0, ignored: 0, identifier_found: 0, file_detected: 0 };
    let statuses = ["detected", "pending", "added", "ignored"];
    for s in statuses {
        let v: i64 = conn.query_row(
            "SELECT COUNT(*) FROM watcher_files WHERE status = ?1",
            params![s],
            |r| r.get(0),
        ).unwrap_or(0);
        match s {
            "detected" => out.detected = v,
            "pending" => out.pending = v,
            "added" => out.added = v,
            "ignored" => out.ignored = v,
            _ => {}
        }
    }
    let kinds = ["identifier_found", "file_detected"];
    for k in kinds {
        let v: i64 = conn.query_row(
            "SELECT COUNT(*) FROM watcher_files WHERE kind = ?1",
            params![k],
            |r| r.get(0),
        ).unwrap_or(0);
        match k {
            "identifier_found" => out.identifier_found = v,
            "file_detected" => out.file_detected = v,
            _ => {}
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;

    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("docid_watcher_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // Regista um ficheiro via upsert, marca como "pending", reabre a BD (simula
    // reinício) e confirma que o lembrete persiste.
    #[test]
    fn pending_reminder_survives_restart() {
        let dir = tmp_dir();
        let path = dir.join("docs").join("contrato.pdf");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "VL-PROP-2026-0725-001").unwrap();
        let mtime = file_mtime(&path).unwrap();

        // Sessão 1: detectar + marcar "mais tarde"
        {
            upsert_watcher_file(&dir, &path, mtime, Some("VL-PROP-2026-0725-001")).unwrap();
            let conn = db::open(&dir.join("offline.db")).unwrap();
            conn.execute(
                "UPDATE watcher_files SET status = 'pending' WHERE path = ?1",
                params![path.to_string_lossy()],
            ).unwrap();
        }

        // Sessão 2 (reabrir): lembrete deve persistir
        {
            let conn = db::open(&dir.join("offline.db")).unwrap();
            let status: String = conn.query_row(
                "SELECT status FROM watcher_files WHERE path = ?1",
                params![path.to_string_lossy()],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(status, "pending");
            let kind: String = conn.query_row(
                "SELECT kind FROM watcher_files WHERE path = ?1",
                params![path.to_string_lossy()],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(kind, "identifier_found");
            let identifier: Option<String> = conn.query_row(
                "SELECT identifier FROM watcher_files WHERE path = ?1",
                params![path.to_string_lossy()],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(identifier.as_deref(), Some("VL-PROP-2026-0725-001"));
        }

        fs::remove_dir_all(&dir).ok();
    }

    // Upsert re-detecto não reseta o status 'pending' (o utilizador pediu "mais tarde").
    #[test]
    fn upsert_keeps_pending_on_redetect() {
        let dir = tmp_dir();
        let path = dir.join("nota.txt");
        fs::write(&path, "sem identificador").unwrap();
        let mtime = file_mtime(&path).unwrap();

        upsert_watcher_file(&dir, &path, mtime, None).unwrap();
        {
            let conn = db::open(&dir.join("offline.db")).unwrap();
            conn.execute(
                "UPDATE watcher_files SET status = 'pending' WHERE path = ?1",
                params![path.to_string_lossy()],
            ).unwrap();
        }
        // Re-detecta o mesmo ficheiro (mesmo mtime → mesmo path, mas upsert corre).
        let should_emit = upsert_watcher_file(&dir, &path, mtime, None).unwrap();
        assert!(!should_emit, "re-detecto de lembrete não deve emitir de novo");
        {
            let conn = db::open(&dir.join("offline.db")).unwrap();
            let status: String = conn.query_row(
                "SELECT status FROM watcher_files WHERE path = ?1",
                params![path.to_string_lossy()],
                |r| r.get(0),
            ).unwrap();
            assert_eq!(status, "pending", "re-detecto não deve descartar o lembrete");
        }

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn find_1char_prefix() {
        assert_eq!(find_identifier("A-PROP-2026-0725-001"), Some("A-PROP-2026-0725-001".into()));
    }

    #[test]
    fn find_6char_prefix() {
        assert_eq!(find_identifier("VERANO-PROP-2026-0725-001"), Some("VERANO-PROP-2026-0725-001".into()));
    }

    #[test]
    fn find_no_identifier() {
        assert_eq!(find_identifier("texto sem identificador nenhum aqui"), None);
    }

    #[test]
    fn find_invalid_mmdd_still_matches() {
        assert_eq!(find_identifier("VL-PROP-2026-9999-001"), Some("VL-PROP-2026-9999-001".into()));
    }

    #[test]
    fn find_multiple_returns_first() {
        let text = "primeiro VL-PROP-2026-0101-001 e depois VL-NDA-2026-0202-002";
        assert_eq!(find_identifier(text), Some("VL-PROP-2026-0101-001".into()));
    }

    #[test]
    fn find_identifier_embedded_in_text() {
        let text = "Documento com o id VL-FAT-2026-1231-042 anexo.";
        assert_eq!(find_identifier(text), Some("VL-FAT-2026-1231-042".into()));
    }
}
