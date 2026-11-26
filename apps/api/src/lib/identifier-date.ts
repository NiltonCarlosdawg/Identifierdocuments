/**
 * Data que entra nos identificadores (`…-{ANO}-{MMDD}-…`).
 *
 * Antes usava a hora local do processo da API: com o servidor em UTC, o que se gerava
 * entre as 00h e a 01h em Luanda saía com o dia anterior. Agora usa um fuso explícito,
 * `IDENTIFIER_TIMEZONE` (por omissão Africa/Luanda), igual para todos os caminhos.
 */
export type DateParts = { year: number; month: number; day: number };

const DEFAULT_TIMEZONE = "Africa/Luanda";
let warned = false;

export function identifierTimeZone(): string {
  const tz = process.env.IDENTIFIER_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    if (!warned) {
      warned = true;
      console.warn(`[IDENTIFIER_TIMEZONE] Fuso inválido '${tz}'; a usar ${DEFAULT_TIMEZONE}.`);
    }
    return DEFAULT_TIMEZONE;
  }
}

export function identifierDateParts(date: Date = new Date(), timeZone = identifierTimeZone()): DateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const toKey = (p: DateParts) => p.year * 10_000 + p.month * 100 + p.day;

function shiftDays(p: DateParts, days: number): DateParts {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * Data de um identificador emitido offline, validada contra o que o servidor espera.
 *
 * `head` é `{PREFIXO}-{CATEGORIA}-` e `tail` é `-{SEQ}`; o meio tem de ser `AAAA-MMDD` com
 * uma data real, entre o dia anterior à reserva do lote e o dia seguinte a hoje (folga
 * para relógios e fusos ligeiramente desacertados). Devolve a razão quando é inválido.
 */
export function parseOfflineIdentifierDate(
  identifier: string,
  head: string,
  tail: string,
  leaseCreatedAt: Date,
  now: Date = new Date(),
): { ok: true; date: DateParts } | { ok: false; reason: string } {
  if (!identifier.startsWith(head) || !identifier.endsWith(tail) || identifier.length <= head.length + tail.length) {
    return { ok: false, reason: `não corresponde a ${head}AAAA-MMDD${tail}` };
  }
  const middle = identifier.slice(head.length, identifier.length - tail.length);
  const m = /^(\d{4})-(\d{2})(\d{2})$/.exec(middle);
  if (!m) return { ok: false, reason: `data '${middle}' não tem o formato AAAA-MMDD` };
  const date = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (check.getUTCMonth() + 1 !== date.month || check.getUTCDate() !== date.day) {
    return { ok: false, reason: `data '${middle}' não existe` };
  }
  const tz = identifierTimeZone();
  const earliest = shiftDays(identifierDateParts(leaseCreatedAt, tz), -1);
  const latest = shiftDays(identifierDateParts(now, tz), 1);
  if (toKey(date) < toKey(earliest) || toKey(date) > toKey(latest)) {
    return { ok: false, reason: `data '${middle}' fora do período do lote` };
  }
  return { ok: true, date };
}
