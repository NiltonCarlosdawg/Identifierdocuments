import { describe, expect, test } from "bun:test";
import { identifierDateParts, parseOfflineIdentifierDate } from "../lib/identifier-date";

describe("data dos identificadores", () => {
  test("usa o fuso de Luanda e não a hora local do servidor", () => {
    // 23:30 UTC de 25/11 já é 26/11 em Luanda (UTC+1).
    const late = new Date("2026-11-25T23:30:00Z");
    expect(identifierDateParts(late, "Africa/Luanda")).toEqual({ year: 2026, month: 11, day: 26 });
    expect(identifierDateParts(late, "UTC")).toEqual({ year: 2026, month: 11, day: 25 });
  });

  test("IDENTIFIER_TIMEZONE inválido cai para Africa/Luanda", () => {
    const prev = process.env.IDENTIFIER_TIMEZONE;
    process.env.IDENTIFIER_TIMEZONE = "Not/AZone";
    try {
      expect(identifierDateParts(new Date("2026-11-25T23:30:00Z"))).toEqual({ year: 2026, month: 11, day: 26 });
    } finally {
      if (prev === undefined) delete process.env.IDENTIFIER_TIMEZONE; else process.env.IDENTIFIER_TIMEZONE = prev;
    }
  });

  const lease = new Date("2026-11-20T10:00:00Z");
  const now = new Date("2026-11-26T10:00:00Z");
  const parse = (id: string) => parseOfflineIdentifierDate(id, "VL-FAT-", "-007", lease, now);

  test("aceita a data emitida offline dentro do período do lote", () => {
    expect(parse("VL-FAT-2026-1124-007")).toEqual({ ok: true, date: { year: 2026, month: 11, day: 24 } });
    expect(parse("VL-FAT-2026-1119-007").ok).toBe(true); // folga de 1 dia antes do lote
    expect(parse("VL-FAT-2026-1127-007").ok).toBe(true); // folga de 1 dia depois de hoje
  });

  test("recusa formato, data inexistente e datas fora do período", () => {
    for (const bad of [
      "VL-PROP-2026-1124-007", // outra categoria
      "VL-FAT-2026-1124-008", // outra sequência
      "VL-FAT-20261124-007",
      "VL-FAT-2026-0230-007",
      "VL-FAT-2026-1118-007",
      "VL-FAT-2026-1128-007",
    ]) {
      expect(parse(bad).ok).toBe(false);
    }
  });
});
