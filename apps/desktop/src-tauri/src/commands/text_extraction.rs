use std::path::Path;

pub fn extract_text_from_pdf(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Erro ao ler PDF: {e}"))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Erro ao extrair texto do PDF: {e}"))?;
    Ok(text)
}

pub fn extract_text_from_txt(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Erro ao ler ficheiro: {e}"))
}

#[tauri::command]
pub fn extract_text_command(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Ficheiro não encontrado.".to_string());
    }
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("pdf") => extract_text_from_pdf(p),
        Some("txt" | "md" | "csv") => extract_text_from_txt(p),
        // .docx pendente — decidir entre docx-rs ou quick-xml
        Some(other) => Err(format!("Formato não suportado: .{other}")),
        None => Err("Ficheiro sem extensão.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_file(content: &str, extension: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("teste.{extension}"));
        fs::write(&path, content).unwrap();
        let path_str = path.to_string_lossy().to_string();
        (dir, path_str)
    }

    #[test]
    fn extract_txt_returns_content() {
        let (_dir, path) = tmp_file("conteúdo de teste\nlinha 2", "txt");
        let result = extract_text_command(path);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "conteúdo de teste\nlinha 2");
    }

    #[test]
    fn extract_md_returns_content() {
        let (_dir, path) = tmp_file("# Markdown\n**teste**", "md");
        let result = extract_text_command(path);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Markdown\n**teste**");
    }

    #[test]
    fn extract_csv_returns_content() {
        let (_dir, path) = tmp_file("a,b,c\n1,2,3", "csv");
        let result = extract_text_command(path);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "a,b,c\n1,2,3");
    }

    #[test]
    fn extract_nonexistent_file_returns_error() {
        let result = extract_text_command("/tmp/docid_test_nonexistent_file_xyz.pdf".to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Ficheiro não encontrado.");
    }

    #[test]
    fn extract_unsupported_extension_returns_error() {
        let (_dir, path) = tmp_file("{}", "json");
        let result = extract_text_command(path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Formato não suportado"));
    }

    #[test]
    fn extract_no_extension_returns_error() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sem_extensao");
        fs::write(&path, "conteúdo").unwrap();
        let result = extract_text_command(path.to_string_lossy().to_string());
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Ficheiro sem extensão.");
    }
}
