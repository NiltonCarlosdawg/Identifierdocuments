use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;
use crate::sync::SyncState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PrinterDevice {
    pub name: String,
}

pub fn printer_name_ok(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 200
        && !trimmed.chars().any(|c| {
            matches!(c, '\n' | '\r' | ';' | '|' | '&' | '$' | '`' | '"' | '\0' | '<' | '>')
        })
}

fn assert_printable_path(state: &SyncState, path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Caminho inválido ou ficheiro inexistente.".to_string())?;
    if !canonical.is_file() {
        return Err("O caminho não é um ficheiro.".to_string());
    }
    let downloads = state
        .downloads_dir
        .canonicalize()
        .unwrap_or_else(|_| state.downloads_dir.clone());
    let uploads = state
        .uploads_dir
        .canonicalize()
        .unwrap_or_else(|_| state.uploads_dir.clone());
    let temp = std::env::temp_dir()
        .canonicalize()
        .unwrap_or_else(|_| std::env::temp_dir());
    if canonical.starts_with(&downloads)
        || canonical.starts_with(&uploads)
        || canonical.starts_with(&temp)
    {
        return Ok(canonical);
    }
    Err("Só é permitido imprimir ficheiros da cache local DocID ou temporários.".to_string())
}

pub fn parse_lpstat(stdout: &str) -> Vec<PrinterDevice> {
    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("printer ") {
            let name = rest.split_whitespace().next().unwrap_or("");
            if printer_name_ok(name) {
                out.push(PrinterDevice { name: name.to_string() });
            }
        } else if line.contains(" accepting requests") {
            let name = line.split_whitespace().next().unwrap_or("");
            if printer_name_ok(name) && !out.iter().any(|p| p.name == name) {
                out.push(PrinterDevice { name: name.to_string() });
            }
        }
    }
    out
}

#[tauri::command]
pub async fn list_printers() -> Result<Vec<PrinterDevice>, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let output = tokio::process::Command::new("lpstat")
            .arg("-p")
            .output()
            .await
            .map_err(|e| format!("CUPS/lpstat não encontrado: {e}"))?;
        Ok(parse_lpstat(&String::from_utf8_lossy(&output.stdout)))
    }
    #[cfg(target_os = "windows")]
    {
        let output = tokio::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name",
            ])
            .output()
            .await
            .map_err(|e| format!("Erro ao listar impressoras: {e}"))?;
        let names = String::from_utf8_lossy(&output.stdout);
        Ok(names
            .lines()
            .map(|l| l.trim())
            .filter(|n| printer_name_ok(n))
            .map(|name| PrinterDevice { name: name.to_string() })
            .collect())
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Ok(vec![])
    }
}

async fn print_path(printer: &str, path: &Path) -> Result<String, String> {
    if !printer_name_ok(printer) {
        return Err("Nome de impressora inválido.".to_string());
    }
    if !path.exists() {
        return Err("Ficheiro a imprimir não encontrado.".to_string());
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let output = tokio::process::Command::new("lp")
            .arg("-d")
            .arg(printer)
            .arg(path)
            .output()
            .await
            .map_err(|e| format!("Erro ao imprimir: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "Erro da impressora: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        return Ok("Enviado para a impressora.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let path_str = path.to_string_lossy().replace('\'', "''");
        let printer_str = printer.replace('\'', "''");
        let script = format!(
            "Get-CimInstance Win32_Printer | Where-Object {{ $_.Name -eq '{printer_str}' }} | Out-Null; \
             Start-Process -LiteralPath '{path_str}' -Verb Print"
        );
        let output = tokio::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .await
            .map_err(|e| format!("Erro ao imprimir: {e}"))?;
        if !output.status.success() {
            return Err("Impressão cancelada ou falhou.".to_string());
        }
        return Ok("Enviado para a impressora.".to_string());
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (printer, path);
        Err("Impressão não suportada neste SO.".to_string())
    }
}

#[tauri::command]
pub async fn print_file(
    state: State<'_, SyncState>,
    printer: String,
    path: String,
) -> Result<String, String> {
    let safe = assert_printable_path(&state, Path::new(&path))?;
    print_path(&printer, &safe).await
}

#[tauri::command]
const MAX_PRINT_BYTES: usize = 10_485_760; // 10MB

pub async fn print_bytes(printer: String, bytes: Vec<u8>, format: String) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("Nada para imprimir.".to_string());
    }
    if bytes.len() > MAX_PRINT_BYTES {
        return Err("Conteúdo para impressão demasiado grande (máx. 10MB).".to_string());
    }
    let ext = match format.as_str() {
        "png" => "png",
        "pdf" => "pdf",
        other => {
            return Err(format!("Formato não suportado para impressão: {other}"));
        }
    };
    let dir = std::env::temp_dir().join("docid_print");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Erro a criar pasta temporária: {e}"))?;
    let path: PathBuf = dir.join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    std::fs::write(&path, &bytes).map_err(|e| format!("Erro a gravar ficheiro temporário: {e}"))?;
    let result = print_path(&printer, &path).await;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::fs::remove_file(&path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_injection_in_printer_name() {
        assert!(!printer_name_ok("lp; rm -rf /"));
        assert!(!printer_name_ok("a|b"));
        assert!(!printer_name_ok(""));
        assert!(printer_name_ok("HP LaserJet"));
        assert!(printer_name_ok("CUPS-PDF"));
    }

    #[test]
    fn parse_lpstat_printer_lines() {
        let out = parse_lpstat(
            "printer HP_LaserJet is idle.  enabled since Qui 13 Ago 2026 10:00:00\n\
             printer CUPS-PDF is idle.  enabled since Qui 13 Ago 2026 10:00:00\n",
        );
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "HP_LaserJet");
        assert_eq!(out[1].name, "CUPS-PDF");
    }
}
