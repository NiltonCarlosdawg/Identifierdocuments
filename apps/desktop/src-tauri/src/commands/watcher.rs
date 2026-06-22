use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

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

    let folders = state.folders.lock().await;
    if folders.is_empty() {
        return Err("Nenhuma pasta configurada para monitorizar.".to_string());
    }

    state.running.store(true, Ordering::SeqCst);

    let app_clone = app.clone();
    let folders_clone = folders.clone();
    let running = Arc::new(AtomicBool::new(true));

    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::channel(256);

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.try_send(event);
                }
            },
            Config::default(),
        )
        .expect("Falha ao criar watcher");

        for folder in &folders_clone {
            if let Err(e) = watcher.watch(folder, RecursiveMode::Recursive) {
                eprintln!("Erro ao monitorizar {:?}: {}", folder, e);
            }
        }

        while running.load(Ordering::SeqCst) {
            tokio::select! {
                Some(event) = rx.recv() => {
                    if let EventKind::Create(_) = event.kind {
                        for path in &event.paths {
                            let ext = path.extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("")
                                .to_lowercase();
                            if matches!(ext.as_str(), "pdf" | "docx" | "xlsx" | "png" | "jpg" | "jpeg") {
                                let _ = app_clone.emit("watcher:file_detected", serde_json::json!({
                                    "path": path.to_string_lossy(),
                                    "ext": ext,
                                }));
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
    let mut folders = state.folders.lock().await;
    if !folders.contains(&p) {
        folders.push(p.clone());
    }
    Ok(format!("Pasta adicionada: {}", path))
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
