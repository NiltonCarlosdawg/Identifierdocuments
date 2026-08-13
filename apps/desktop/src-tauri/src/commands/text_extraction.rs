use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn extract_text_from_pdf(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Erro ao ler PDF: {e}"))?;
    let text = pdf_extract::extract_text_from_mem(&bytes)
        .map_err(|e| format!("Erro ao extrair texto do PDF: {e}"))?;
    Ok(text)
}

pub fn extract_text_from_txt(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("Erro ao ler ficheiro: {e}"))
}

pub fn extract_text_from_docx(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Erro ao ler DOCX: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("DOCX inválido: {e}"))?;
    let mut document = archive
        .by_name("word/document.xml")
        .map_err(|_| "DOCX sem word/document.xml.".to_string())?;
    let mut xml = String::new();
    document
        .read_to_string(&mut xml)
        .map_err(|e| format!("Erro ao ler document.xml: {e}"))?;
    Ok(docx_xml_to_text(&xml))
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

/// Extrai o texto visível de um `word/document.xml` (`<w:t>`), com quebra de
/// parágrafo em `</w:p>`.
fn docx_xml_to_text(xml: &str) -> String {
    let mut out = String::new();
    let mut pos = 0;
    while pos < xml.len() {
        let rest = &xml[pos..];
        let t_at = rest.find("<w:t");
        let p_at = rest.find("</w:p>");
        match (t_at, p_at) {
            (Some(t), Some(p)) if p < t => {
                out.push('\n');
                pos += p + 6;
            }
            (Some(t), _) => {
                let after_tag = t + 4;
                let slice = &rest[after_tag..];
                let Some(gt) = slice.find('>') else { break };
                if slice[..gt].ends_with('/') {
                    pos += after_tag + gt + 1;
                    continue;
                }
                let content_start = after_tag + gt + 1;
                let after_content = &rest[content_start..];
                let Some(end) = after_content.find("</w:t>") else { break };
                out.push_str(&decode_xml_entities(&after_content[..end]));
                pos += content_start + end + 6;
            }
            (None, Some(p)) => {
                out.push('\n');
                pos += p + 6;
            }
            (None, None) => break,
        }
    }
    out.split('\n')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn path_under_root(canonical: &Path, root: &Path) -> bool {
    match root.canonicalize() {
        Ok(r) => canonical.starts_with(&r),
        Err(_) => canonical.starts_with(root),
    }
}

fn assert_readable_user_file(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "Caminho inválido ou ficheiro inexistente.".to_string())?;
    if !canonical.is_file() {
        return Err("O caminho não é um ficheiro.".to_string());
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().app_data_dir() {
        roots.push(p);
    }
    if let Ok(p) = app.path().document_dir() {
        roots.push(p);
    }
    if let Ok(p) = app.path().download_dir() {
        roots.push(p);
    }
    if let Ok(p) = app.path().home_dir() {
        roots.push(p);
    }
    roots.push(std::env::temp_dir());

    if roots.iter().any(|r| path_under_root(&canonical, r)) {
        return Ok(canonical);
    }
    Err("Leitura não permitida fora das pastas do utilizador / app DocID.".to_string())
}

fn extract_text_from_path(path: &Path) -> Result<String, String> {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .as_deref()
    {
        Some("pdf") => extract_text_from_pdf(path),
        Some("txt" | "md" | "csv") => extract_text_from_txt(path),
        Some("docx") => extract_text_from_docx(path),
        Some(other) => Err(format!("Formato não suportado: .{other}")),
        None => Err("Ficheiro sem extensão.".to_string()),
    }
}

#[tauri::command]
pub fn extract_text_command(app: AppHandle, path: String) -> Result<String, String> {
    let canonical = assert_readable_user_file(&app, Path::new(&path))?;
    extract_text_from_path(&canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use uuid::Uuid;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn tmp_file(content: &str, extension: &str) -> (std::path::PathBuf, String) {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("teste.{extension}"));
        fs::write(&path, content).unwrap();
        let path_str = path.to_string_lossy().to_string();
        (dir, path_str)
    }

    fn write_minimal_docx(path: &Path, inner_xml: &str) {
        let file = fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("[Content_Types].xml", opts).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>"#).unwrap();
        zip.start_file("word/document.xml", opts).unwrap();
        zip.write_all(inner_xml.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn extract_txt_returns_content() {
        let (_dir, path) = tmp_file("conteúdo de teste\nlinha 2", "txt");
        let result = extract_text_from_path(Path::new(&path));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "conteúdo de teste\nlinha 2");
    }

    #[test]
    fn extract_md_returns_content() {
        let (_dir, path) = tmp_file("# Markdown\n**teste**", "md");
        let result = extract_text_from_path(Path::new(&path));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Markdown\n**teste**");
    }

    #[test]
    fn extract_csv_returns_content() {
        let (_dir, path) = tmp_file("a,b,c\n1,2,3", "csv");
        let result = extract_text_from_path(Path::new(&path));
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "a,b,c\n1,2,3");
    }

    #[test]
    fn extract_nonexistent_file_returns_error() {
        let result = extract_text_from_path(Path::new("/tmp/docid_test_nonexistent_file_xyz.pdf"));
        assert!(result.is_err());
    }

    #[test]
    fn extract_unsupported_extension_returns_error() {
        let (_dir, path) = tmp_file("{}", "json");
        let result = extract_text_from_path(Path::new(&path));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Formato não suportado"));
    }

    #[test]
    fn extract_no_extension_returns_error() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sem_extensao");
        fs::write(&path, "conteúdo").unwrap();
        let result = extract_text_from_path(&path);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Ficheiro sem extensão.");
    }

    #[test]
    fn docx_xml_extracts_wt_and_paragraphs() {
        let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>VL-PROP-2026-0725-001</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Contrato &amp; anexo</w:t></w:r></w:p></w:body></w:document>"#;
        let text = docx_xml_to_text(xml);
        assert!(text.contains("VL-PROP-2026-0725-001"));
        assert!(text.contains("Contrato & anexo"));
        assert!(text.contains('\n'));
    }

    #[test]
    fn extract_docx_returns_document_text() {
        let dir = std::env::temp_dir().join(format!("docid_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("contrato.docx");
        write_minimal_docx(
            &path,
            r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Identificador VL-FAT-2026-0813-002 no corpo</w:t></w:r></w:p></w:body></w:document>"#,
        );
        let result = extract_text_from_path(&path);
        assert!(result.is_ok(), "{result:?}");
        assert!(result.unwrap().contains("VL-FAT-2026-0813-002"));
        fs::remove_dir_all(&dir).ok();
    }
}
