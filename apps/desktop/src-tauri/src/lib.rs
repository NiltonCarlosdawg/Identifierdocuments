mod commands;
mod db;
mod sync;

use commands::{scanner, watcher};
use sync::{start_background_sync, SyncState};
use tauri::Manager;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(WatcherState::new())
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app data dir");
            let db_path = app_data.join("offline.db");
            let uploads_dir = app_data.join("uploads");

            app.manage(SyncState {
                db_path,
                uploads_dir,
                api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
                // Note: A16 requires HTTPS validation — URL setters in sync/mod.rs
                // already validate scheme at runtime (see set_api_base_url).
                auth_token: std::sync::Mutex::new(None),
                syncing: std::sync::Mutex::new(false),
            });

            start_background_sync(app.handle().clone());

            #[cfg(debug_assertions)]
            if std::env::var("DOCID_DEVTOOLS").as_deref() != Ok("0") {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync::set_sync_credentials,
            sync::set_api_base_url,
            sync::get_api_base_url,
            sync::clear_sync_credentials,
            sync::is_online,
            sync::enqueue_upload,
            sync::enqueue_upload_bytes,
            sync::get_queue,
            sync::clear_uploaded,
            sync::remove_queue_item,
            sync::retry_queue_item,
            sync::force_sync,
            watcher::start_watcher,
            watcher::stop_watcher,
            watcher::add_watched_folder,
            watcher::remove_watched_folder,
            watcher::get_watched_folders,
            scanner::list_scanners,
            scanner::scan_document,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar DocID");
}
