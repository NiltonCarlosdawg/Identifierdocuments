/**
 * Números de licença das organizações: DOCID-AAAA-XXXX-XXXX-XXXX.
 *
 * Os números são gerados na base de dados (função `docid_new_license_number`, migração
 * 0024) como valor por defeito da coluna `organizations.license_number`. Este módulo
 * replica a regra para validar/normalizar números escritos por pessoas (ex.: suporte).
 * Mudar o algoritmo aqui exige mudar também a função SQL.
 */
export const LICENSE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/** Carácter de controlo Luhn mod 32 do conteúdo (ano + 11 caracteres). */
export function licenseCheckChar(payload: string): string {
  let factor = 2;
  let total = 0;
  for (let i = payload.length - 1; i >= 0; i--) {
    const code = LICENSE_ALPHABET.indexOf(payload[i]);
    if (code < 0) throw new Error(`Carácter inválido: ${payload[i]}`);
    let addend = factor * code;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    total += addend;
  }
  return LICENSE_ALPHABET[(32 - (total % 32)) % 32];
}

/**
 * Normaliza o que uma pessoa escreveu: maiúsculas, sem espaços, e as confusões típicas
 * da base32 de Crockford (O→0, I/L→1). Devolve null se não tiver o formato certo.
 */
export function normalizeLicenseNumber(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith("DOCID")) return null;
  // Só depois de retirar o prefixo (que tem um I legítimo) é que corrigimos confusões.
  const rest = compact.slice(5).replace(/O/g, "0").replace(/[IL]/g, "1");
  const m = rest.match(/^(\d{4})([0-9A-HJKMNP-TV-Z]{12})$/);
  if (!m) return null;
  const [, year, code] = m;
  return `DOCID-${year}-${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/** Confirma formato e carácter de controlo (detecta erros de escrita). */
export function isValidLicenseNumber(input: string): boolean {
  const n = normalizeLicenseNumber(input);
  if (!n) return false;
  const [, year, a, b, c] = n.split("-");
  const code = a + b + c;
  return licenseCheckChar(year + code.slice(0, 11)) === code[11];
}
