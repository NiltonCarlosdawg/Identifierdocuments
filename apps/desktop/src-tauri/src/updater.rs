//! Actualizações da app desktop via `tauri-plugin-updater`.
//!
//! A chave privada de assinatura NÃO vive no repositório. Em CI/release:
//! `TAURI_SIGNING_PRIVATE_KEY` (+ password opcional). A pubkey está em
//! `tauri.conf.json` → `plugins.updater.pubkey`.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Verifica actualizações e pergunta ao utilizador se quer instalar.
/// Em falha de rede / 204 / sem release, termina em silêncio.
/// Só é chamada em builds release (`lib.rs`); em debug/test fica unused.
#[allow(dead_code)]
pub async fn check_and_prompt(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let update = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|e| e.to_string())?,
        Err(e) => return Err(e.to_string()),
    };

    let Some(update) = update else {
        return Ok(());
    };

    let version = update.version.clone();
    let notes = update.body.clone().unwrap_or_default();
    let prompt = if notes.is_empty() {
        format!("Está disponível a versão {version}. Deseja instalar agora?")
    } else {
        format!("Está disponível a versão {version}.\n\n{notes}\n\nDeseja instalar agora?")
    };

    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    app.dialog()
        .message(prompt)
        .title("Actualização DocID")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Instalar".to_string(),
            "Mais tarde".to_string(),
        ))
        .show(move |answer| {
            let _ = tx.send(answer);
        });

    let accepted = rx.await.unwrap_or(false);
    if !accepted {
        return Ok(());
    }

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e: tauri_plugin_updater::Error| e.to_string())?;

    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

/// Verificação manual a partir da UI (Settings).
#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    let Some(update) = update else {
        return Ok("A aplicação está actualizada.".to_string());
    };

    let version = update.version.clone();
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e: tauri_plugin_updater::Error| e.to_string())?;

    Ok(format!("Versão {version} instalada. A aplicação vai reiniciar."))
}
