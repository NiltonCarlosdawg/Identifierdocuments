use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannerDevice {
    pub name: String,
    pub vendor: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanOptions {
    pub resolution: u32,
    pub mode: String,
    pub format: String,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            resolution: 300,
            mode: "color".to_string(),
            format: "pdf".to_string(),
        }
    }
}

#[tauri::command]
pub async fn list_scanners() -> Result<Vec<ScannerDevice>, String> {
    #[cfg(target_os = "linux")]
    {
        scan_sane().await
    }
    #[cfg(target_os = "windows")]
    {
        scan_twain().await
    }
    #[cfg(target_os = "macos")]
    {
        Ok(vec![ScannerDevice {
            name: "Mock Scanner".to_string(),
            vendor: "Verano Labs".to_string(),
            model: "Simulado".to_string(),
        }])
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn scan_document(scanner_name: String, options: Option<ScanOptions>) -> Result<Vec<u8>, String> {
    let opts = options.unwrap_or_default();
    #[cfg(target_os = "linux")]
    {
        scan_sane_document(&scanner_name, &opts).await
    }
    #[cfg(target_os = "windows")]
    {
        scan_twain_document(&scanner_name, &opts).await
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Err("Scanner não suportado neste SO.".to_string())
    }
    #[cfg(target_os = "macos")]
    {
        // Return a mock scan for macOS
        Ok(vec![0u8; 1024])
    }
}

#[cfg(target_os = "linux")]
async fn scan_sane() -> Result<Vec<ScannerDevice>, String> {
    // Attempt to call `scanimage -L` via command
    let output = tokio::process::Command::new("scanimage")
        .arg("-L")
        .output()
        .await
        .map_err(|e| format!("SANE não encontrado: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let devices: Vec<ScannerDevice> = stdout
        .lines()
        .filter_map(|line| {
            if line.contains("device") {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 3 {
                    Some(ScannerDevice {
                        name: parts[1].to_string(),
                        vendor: parts.get(3).unwrap_or(&"desconhecido").to_string(),
                        model: parts.get(5).unwrap_or(&"desconhecido").to_string(),
                    })
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    Ok(devices)
}

#[cfg(target_os = "linux")]
async fn scan_sane_document(scanner_name: &str, opts: &ScanOptions) -> Result<Vec<u8>, String> {
    let format_arg = match opts.format.as_str() {
        "png" => "png",
        _ => "pdf",
    };
    let mode_arg = match opts.mode.as_str() {
        "gray" | "cinzento" => "Gray",
        "bw" | "black" | "B&W" => "Lineart",
        _ => "Color",
    };

    let output = tokio::process::Command::new("scanimage")
        .arg("--device")
        .arg(scanner_name)
        .arg("--resolution")
        .arg(opts.resolution.to_string())
        .arg("--mode")
        .arg(mode_arg)
        .arg("--format")
        .arg(format_arg)
        .output()
        .await
        .map_err(|e| format!("Erro ao digitalizar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Erro do scanner: {}", stderr));
    }

    Ok(output.stdout)
}

// Windows: a versão anterior lançava o PowerShell e nunca funcionou —
// `Win32_Scanner` não é uma classe WMI do Windows (a lista vinha sempre vazia) e
// `ReadAllBytes($d)` recebia um objecto COM WIA.ImageFile, não um caminho.
// Lançar o PowerShell a partir da app é também um dos principais motivos de alertas
// do Windows Defender. Até existir integração WIA nativa (COM via crate `windows`,
// testada com scanners reais), o Windows usa o fluxo que já funciona: digitalizar
// com o software do scanner (ou a app "Digitalizar" do Windows) para uma pasta
// vigiada pelo DocID, que detecta o documento automaticamente.
#[cfg(target_os = "windows")]
pub const WINDOWS_SCAN_GUIDANCE: &str = "A digitalização directa ainda não está disponível no Windows. \
Digitalize com o programa do scanner (ou a app \"Digitalizar\" do Windows) para uma pasta vigiada \
pelo DocID (Configurações → Pastas Vigiladas): o documento é detectado automaticamente.";

#[cfg(target_os = "windows")]
async fn scan_twain() -> Result<Vec<ScannerDevice>, String> {
    // Erro em vez de lista vazia: a página Digitalizar mostra esta orientação ao utilizador.
    Err(WINDOWS_SCAN_GUIDANCE.to_string())
}

#[cfg(target_os = "windows")]
async fn scan_twain_document(_scanner_name: &str, _opts: &ScanOptions) -> Result<Vec<u8>, String> {
    Err(WINDOWS_SCAN_GUIDANCE.to_string())
}
