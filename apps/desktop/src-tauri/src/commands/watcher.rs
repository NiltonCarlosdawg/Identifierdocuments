use crate::commands::text_extraction::{extract_text_from_pdf, extract_text_from_txt};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
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

fn check_and_emit(path: &Path, app: &AppHandle, seen: &mut HashMap<String, u64>, app_data: &Path) {
    let canonical = match path.canonicalize() { Ok(c) => c, Err(_) => return };
    let mtime = match file_mtime(&canonical) { Some(m) => m, None => return };
    let key = canonical.to_string_lossy().to_string();
    if seen.get(&key) == Some(&mtime) { return; }
    seen.insert(key, mtime);
    save_seen(app_data, seen);

    let ext = canonical.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !supported_ext(&ext) { return; }

    match ext.as_str() {
        "pdf" | "txt" | "md" | "csv" => {
            let text = if ext == "pdf" { extract_text_from_pdf(&canonical) } else { extract_text_from_txt(&canonical) };
            match text {
                Ok(t) => {
                    if let Some(id) = find_identifier(&t) {
                        let _ = app.emit("watcher:identifier_found", serde_json::json!({"path": canonical.to_string_lossy(), "identifier": id, "ext": ext}));
                    } else {
                        let _ = app.emit("watcher:file_detected", serde_json::json!({"path": canonical.to_string_lossy(), "ext": ext}));
                    }
                }
                Err(_) => { let _ = app.emit("watcher:file_detected", serde_json::json!({"path": canonical.to_string_lossy(), "ext": ext})); }
            }
        }
        _ => { let _ = app.emit("watcher:file_detected", serde_json::json!({"path": canonical.to_string_lossy(), "ext": ext})); }
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
                check_and_emit(&f, &app_clone, &mut seen, &app_data);
            }
        }

        while state.running.load(Ordering::SeqCst) {
            tokio::select! {
                Some(event) = rx.recv() => {
                    if let EventKind::Create(_) = event.kind {
                        for path in &event.paths {
                            check_and_emit(path, &app_clone, &mut seen, &app_data);
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
    let mut folders = state.folders.lock().await;
    folders.retain(|f| f != &p);
    Ok(format!("Pasta removida: {}", path))
}

#[tauri::command]
pub async fn get_watched_folders(state: tauri::State<'_, WatcherState>) -> Result<Vec<String>, String> {
    let folders = state.folders.lock().await;
    Ok(folders.iter().map(|f| f.to_string_lossy().to_string()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

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
