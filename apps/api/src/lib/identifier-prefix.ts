/**
 * Prefixo da organização nos identificadores (`{PREFIXO}-{CATEGORIA}-{ANO}-{MMDD}-{SEQ}`).
 *
 * Só letras maiúsculas A–Z, 1 a 6: o hífen separa os campos e o watcher do desktop
 * reconhece identificadores pela regex `[A-Z]{1,6}-…`. Um prefixo com hífen, dígitos ou
 * acentos produzia identificadores que o resto do sistema não reconhece.
 */
export const IDENTIFIER_PREFIX_RE = /^[A-Z]{1,6}$/;

export const IDENTIFIER_PREFIX_MESSAGE =
  "O prefixo do identificador deve ter de 1 a 6 letras (A–Z), sem números, hífens nem acentos.";

/** Normaliza (trim + maiúsculas) e valida. Devolve null se for inválido. */
export function normalizeIdentifierPrefix(raw: string): string | null {
  const value = raw.trim().toUpperCase();
  return IDENTIFIER_PREFIX_RE.test(value) ? value : null;
}

/** Prefixo por omissão a partir do slug: só as letras, até 4; "ORG" se não houver nenhuma. */
export function defaultIdentifierPrefix(slug: string): string {
  return slug.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 4) || "ORG";
}
