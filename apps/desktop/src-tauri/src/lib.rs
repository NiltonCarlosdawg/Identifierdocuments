mod commands;
mod db;
mod sync;
mod updater;

use commands::{identifiers, printer, scanner, text_extraction, watcher};
use sync::{start_background_sync, SyncState};
use tauri::Manager;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WatcherState::new())
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app data dir");
            let db_path = app_data.join("offline.db");
            let uploads_dir = app_data.join("uploads");
            let downloads_dir = app_data.join("downloads");

            app.manage(SyncState {
                db_path,
                uploads_dir,
                downloads_dir,
                api_base_url: std::sync::Mutex::new("http://localhost:3000".to_string()),
                // Note: A16 requires HTTPS validation — URL setters in sync/mod.rs
                // already validate scheme at runtime (see set_api_base_url).
                auth_token: std::sync::Mutex::new(None),
                syncing: std::sync::Mutex::new(false),
            });

            start_background_sync(app.handle().clone());

            // Verificação silenciosa de actualizações (só em builds release)
            #[cfg(all(desktop, not(debug_assertions)))]
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    if let Err(e) = crate::updater::check_and_prompt(handle).await {
                        eprintln!("updater: {e}");
                    }
                });
            }

            #[cfg(debug_assertions)]
            if std::env::var("DOCID_DEVTOOLS").as_deref() != Ok("0") {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            identifiers::cache_categories,
            identifiers::cache_tenant_state,
            identifiers::get_pending_identifiers,
            identifiers::clear_synced_identifier,
            identifiers::reset_pending_identifier,
            identifiers::delete_pending_identifier,
            identifiers::mark_lease_remote_released,
            identifiers::get_leases,
            identifiers::generate_offline_identifier,
            identifiers::request_lease,
            identifiers::ensure_offline_lease,
            identifiers::get_or_register_device_id,
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
            sync::enqueue_write,
            sync::get_write_queue,
            sync::remove_write_item,
            sync::retry_write_item,
            sync::force_sync,
            sync::attach_document_native,
            sync::download_document_offline,
            sync::is_document_cached,
            sync::open_local_file,
            text_extraction::extract_text_command,
            watcher::start_watcher,
            watcher::stop_watcher,
            watcher::is_watcher_running,
            watcher::add_watched_folder,
            watcher::remove_watched_folder,
            watcher::get_watched_folders,
            watcher::watcher_get_files,
            watcher::watcher_set_file_status,
            watcher::watcher_get_reminders,
            watcher::watcher_get_report,
            scanner::list_scanners,
            scanner::scan_document,
            printer::list_printers,
            printer::print_file,
            printer::print_bytes,
            updater::check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar DocID");
}
