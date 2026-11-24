//! Chave mestra da store encriptada, guardada no cofre do sistema operativo
//! (Gestor de Credenciais do Windows / Keychain do macOS).
//!
//! Antes, a chave AES ficava no mesmo ficheiro (`docid-secure`) que os dados que
//! protegia, por isso quem copiasse esse ficheiro conseguia desencriptar o token.
//! No cofre do SO, a chave fica protegida pela sessão do utilizador Windows.

#[cfg(any(windows, target_os = "macos"))]
const SERVICE: &str = "ao.verano.docid";
#[cfg(any(windows, target_os = "macos"))]
const ACCOUNT: &str = "secure-storage-key";

/// Uma chave AES-256 em base64 tem sempre 44 caracteres.
fn is_valid_key(k: &str) -> bool {
    k.len() == 44
        && k
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

/// Devolve a chave guardada no cofre. Se ainda não existir, guarda `candidate`
/// (gerada pelo frontend, ou a chave antiga migrada da store) e devolve-a.
#[cfg(any(windows, target_os = "macos"))]
#[tauri::command]
pub fn secure_key_get_or_init(candidate: String) -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(existing) if is_valid_key(&existing) => Ok(existing),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            if !is_valid_key(&candidate) {
                return Err("chave candidata inválida".into());
            }
            entry.set_password(&candidate).map_err(|e| e.to_string())?;
            Ok(candidate)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Sem cofre suportado nesta plataforma: o frontend usa o método antigo.
#[cfg(not(any(windows, target_os = "macos")))]
#[tauri::command]
pub fn secure_key_get_or_init(candidate: String) -> Result<String, String> {
    let _ = is_valid_key(&candidate);
    Err("cofre do sistema não suportado nesta plataforma".into())
}

#[cfg(test)]
mod tests {
    use super::is_valid_key;

    #[test]
    fn valida_formato_da_chave() {
        assert!(is_valid_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));
        assert!(!is_valid_key(""));
        assert!(!is_valid_key("curta"));
        assert!(!is_valid_key("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\"="));
    }
}
