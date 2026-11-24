//! Chamadas directas à API do Windows (shell32 / winspool / ole32).
//!
//! Substituem o `powershell.exe` e o `cmd /C start` que a app lançava para listar
//! impressoras, imprimir e abrir ficheiros. Lançar intérpretes de comandos a partir
//! de uma app é um dos sinais heurísticos mais fortes para o Windows Defender, abria
//! janelas de consola visíveis e permitia injecção através de nomes de ficheiro.
//!
//! As declarações são feitas à mão (sem crates) para não depender da API de uma versão
//! específica da crate `windows`; as bibliotecas de importação (shell32, winspool,
//! ole32) existem tanto no toolchain MSVC como no MinGW.

use std::ffi::{c_void, OsStr};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show_cmd: i32,
    ) -> *mut c_void;
}

#[link(name = "winspool")]
extern "system" {
    fn EnumPrintersW(
        flags: u32,
        name: *const u16,
        level: u32,
        printer_enum: *mut u8,
        buf_size: u32,
        needed: *mut u32,
        returned: *mut u32,
    ) -> i32;
}

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, co_init: u32) -> i32;
    fn CoUninitialize();
}

const SW_HIDE: i32 = 0;
const SW_SHOWNORMAL: i32 = 1;
const PRINTER_ENUM_LOCAL: u32 = 0x0000_0002;
const PRINTER_ENUM_CONNECTIONS: u32 = 0x0000_0004;
const COINIT_APARTMENTTHREADED: u32 = 0x2;
const COINIT_DISABLE_OLE1DDE: u32 = 0x4;
/// Nenhuma aplicação associada ao verbo pedido (ex.: "printto" para este tipo de ficheiro).
pub const SE_ERR_NOASSOC: isize = 31;

/// PRINTER_INFO_4W (nível 4: só nome, servidor e atributos; rápido, não contacta as impressoras).
#[repr(C)]
struct PrinterInfo4W {
    printer_name: *const u16,
    server_name: *const u16,
    attributes: u32,
}

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

fn wide_str(s: &str) -> Vec<u16> {
    wide(OsStr::new(s))
}

/// Lê uma string UTF-16 terminada em zero.
unsafe fn from_wide_ptr(p: *const u16) -> String {
    if p.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *p.add(len) != 0 {
        len += 1;
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(p, len))
}

/// Mensagem legível para os códigos de erro do ShellExecute (valores <= 32).
pub fn shell_error_message(code: isize) -> String {
    match code {
        0 => "O sistema ficou sem memória ou recursos.".into(),
        2 => "Ficheiro não encontrado.".into(),
        3 => "Caminho não encontrado.".into(),
        5 => "Acesso negado.".into(),
        26 => "Violação de partilha: o ficheiro está a ser usado por outro programa.".into(),
        27 | SE_ERR_NOASSOC => "Não há nenhum programa associado a este tipo de ficheiro.".into(),
        _ => format!("O Windows recusou a operação (código {code})."),
    }
}

/// `canonicalize()` no Windows devolve caminhos "verbatim" (`\\?\C:\...` ou
/// `\\?\UNC\servidor\partilha\...`). Muitos programas associados não aceitam esse
/// formato quando o recebem na linha de comando, por isso voltamos ao formato normal.
pub fn strip_verbatim(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        let b = rest.as_bytes();
        if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            rest.to_string()
        } else {
            path.to_string()
        }
    } else {
        path.to_string()
    }
}

/// Executa ShellExecuteW com COM inicializado (alguns handlers de ficheiros usam COM).
/// Devolve Ok(()) ou Err(código) quando o Windows devolve um valor <= 32.
fn shell_execute(verb: &str, file: &Path, params: Option<&str>, show: i32) -> Result<(), isize> {
    let verb_w = wide_str(verb);
    let file_w = wide(OsStr::new(&strip_verbatim(&file.to_string_lossy())));
    let params_w = params.map(wide_str);
    unsafe {
        let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let result = ShellExecuteW(
            std::ptr::null_mut(),
            verb_w.as_ptr(),
            file_w.as_ptr(),
            params_w.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
            std::ptr::null(),
            show,
        ) as isize;
        if hr >= 0 {
            CoUninitialize();
        }
        if result > 32 {
            Ok(())
        } else {
            Err(result)
        }
    }
}

/// Abre um ficheiro com o programa associado (equivalente a fazer duplo clique).
pub fn open_path(path: &Path) -> Result<(), String> {
    shell_execute("open", path, None, SW_SHOWNORMAL).map_err(shell_error_message)
}

/// Resultado da impressão: em que impressora ficou o trabalho.
#[derive(Debug, PartialEq, Eq)]
pub enum PrintOutcome {
    /// Enviado para a impressora escolhida (verbo "printto").
    ChosenPrinter,
    /// O programa associado não suporta escolher a impressora: foi para a predefinida.
    DefaultPrinter,
}

/// Imprime um ficheiro na impressora indicada através do programa associado ao tipo de
/// ficheiro. Tenta primeiro "printto" (impressora escolhida); se esse verbo não existir
/// para este tipo de ficheiro, usa "print" (impressora predefinida).
///
/// `printer` tem de ter passado por `printer_name_ok` (sem aspas), por isso pode ir entre aspas.
pub fn print_path(printer: &str, path: &Path) -> Result<PrintOutcome, String> {
    let quoted = format!("\"{printer}\"");
    match shell_execute("printto", path, Some(&quoted), SW_HIDE) {
        Ok(()) => Ok(PrintOutcome::ChosenPrinter),
        Err(code) if code == SE_ERR_NOASSOC || code == 27 => shell_execute("print", path, None, SW_HIDE)
            .map(|_| PrintOutcome::DefaultPrinter)
            .map_err(shell_error_message),
        Err(code) => Err(shell_error_message(code)),
    }
}

/// Lista as impressoras locais e as ligadas por rede (EnumPrintersW, nível 4).
pub fn list_printer_names() -> Result<Vec<String>, String> {
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed: u32 = 0;
    let mut returned: u32 = 0;
    unsafe {
        // 1.ª chamada: só para saber o tamanho do buffer.
        EnumPrintersW(flags, std::ptr::null(), 4, std::ptr::null_mut(), 0, &mut needed, &mut returned);
        if needed == 0 {
            return Ok(Vec::new());
        }
        // Buffer alinhado a 8 bytes: a estrutura contém ponteiros.
        let mut buf: Vec<u64> = vec![0; (needed as usize + 7) / 8];
        let ok = EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            buf.as_mut_ptr() as *mut u8,
            (buf.len() * 8) as u32,
            &mut needed,
            &mut returned,
        );
        if ok == 0 {
            return Err(format!(
                "Erro ao listar impressoras: {}",
                std::io::Error::last_os_error()
            ));
        }
        let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PrinterInfo4W, returned as usize);
        Ok(infos
            .iter()
            .map(|i| from_wide_ptr(i.printer_name))
            .filter(|n| !n.is_empty())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_termina_em_zero() {
        let w = wide_str("Olá");
        assert_eq!(w.last(), Some(&0));
        assert_eq!(unsafe { from_wide_ptr(w.as_ptr()) }, "Olá");
    }

    #[test]
    fn remove_prefixo_verbatim() {
        assert_eq!(strip_verbatim(r"\\?\C:\Users\a\doc.pdf"), r"C:\Users\a\doc.pdf");
        assert_eq!(strip_verbatim(r"\\?\UNC\srv\share\doc.pdf"), r"\\srv\share\doc.pdf");
        assert_eq!(strip_verbatim(r"C:\normal.pdf"), r"C:\normal.pdf");
        assert_eq!(strip_verbatim(r"\\?\Volume{abc}\x"), r"\\?\Volume{abc}\x");
    }

    #[test]
    fn mensagens_de_erro() {
        assert!(shell_error_message(SE_ERR_NOASSOC).contains("programa associado"));
        assert!(shell_error_message(2).contains("não encontrado"));
    }

    #[test]
    fn listar_impressoras_nao_rebenta() {
        // Numa máquina sem impressoras devolve lista vazia; nunca deve dar pânico.
        let _ = list_printer_names();
    }
}
