use crate::commands::text_extraction::{extract_text_from_pdf, extract_text_from_txt};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use regex::Regex;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

static IDENTIFIER_RE: OnceLock<Regex> = OnceLock::new();

fn identifier_re() -> &'static Regex {
    IDENTIFIER_RE.get_or_init(|| Regex::new(r"[A-Z]{1,6}-[A-Z]{2,5}-\d{4}-\d{4}-\d{3}").unwrap())
}

pub fn find_identifier(text: &str) -> Option<String> {
    identifier_re().find(text).map(|m| m.as_str().to_string())
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

        while state.running.load(Ordering::SeqCst) {
            tokio::select! {
                Some(event) = rx.recv() => {
                    if let EventKind::Create(_) = event.kind {
                        for path in &event.paths {
                            let ext = path.extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            match ext.as_str() {
                                "pdf" | "txt" | "md" | "csv" => {
                                    let text_result = if ext == "pdf" {
                                        extract_text_from_pdf(path)
                                    } else {
                                        extract_text_from_txt(path)
                                    };
                                    match text_result {
                                        Ok(text) => {
                                            if let Some(identifier) = find_identifier(&text) {
                                                let _ = app_clone.emit("watcher:identifier_found", serde_json::json!({
                                                    "path": path.to_string_lossy(),
                                                    "identifier": identifier,
                                                    "ext": ext,
                                                }));
                                            } else {
                                                let _ = app_clone.emit("watcher:file_detected", serde_json::json!({
                                                    "path": path.to_string_lossy(),
                                                    "ext": ext,
                                                }));
                                            }
                                        }
                                        Err(_) => {
                                            let _ = app_clone.emit("watcher:file_detected", serde_json::json!({
                                                "path": path.to_string_lossy(),
                                                "ext": ext,
                                            }));
                                        }
                                    }
                                }
                                "docx" | "xlsx" | "png" | "jpg" | "jpeg" => {
                                    let _ = app_clone.emit("watcher:file_detected", serde_json::json!({
                                        "path": path.to_string_lossy(),
                                        "ext": ext,
                                    }));
                                }
                                _ => {}
                            }
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
