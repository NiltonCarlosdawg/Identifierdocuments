import { describe, expect, it } from "bun:test";
import { matchesDocumentFilters, normalizeSearch } from "../services/attachment.service";

const doc = {
  filename: "Proposta-Acme.pdf", label: null, tags: ["urgente", "Assinado"], identifier: "VL-PROP-2026-1118-001",
  categoryId: "PROP", categoryName: "Propostas Comerciais", status: "active", uploadedBy: "u1",
  uploaderName: "Ana Lúcia", createdAt: new Date("2026-11-18T10:00:00Z"), sharedWithMe: false,
};
const ok = (f: Parameters<typeof matchesDocumentFilters>[1], userId = "u1", d = doc) => matchesDocumentFilters(d, f, userId);

describe("filtros da lista de documentos", () => {
  it("pesquisa sem acentos, em qualquer campo e com várias palavras", () => {
    expect(normalizeSearch("  Facturação ")).toBe("facturacao");
    expect(ok({ q: "acme" })).toBe(true);
    expect(ok({ q: "1118-001" })).toBe(true);
    expect(ok({ q: "comerciais acme" })).toBe(true);
    expect(ok({ q: "lucia" })).toBe(true);
    expect(ok({ q: "assinado" })).toBe(true);
    expect(ok({ q: "acme factura" })).toBe(false);
  });
  it("categoria, estado, etiqueta e datas inclusivas", () => {
    expect(ok({ categoryId: "PROP" })).toBe(true);
    expect(ok({ categoryId: "FT" })).toBe(false);
    expect(ok({ status: "cancelled" })).toBe(false);
    expect(ok({ tag: "assinado" })).toBe(true);
    expect(ok({ from: "2026-11-18", to: "2026-11-18" })).toBe(true);
    expect(ok({ from: "2026-11-19" })).toBe(false);
    expect(ok({ to: "2026-11-17" })).toBe(false);
  });
  it("meus e partilhados comigo", () => {
    expect(ok({ scope: "mine" }, "u1")).toBe(true);
    expect(ok({ scope: "mine" }, "u2")).toBe(false);
    expect(ok({ scope: "shared" }, "u2")).toBe(false);
    expect(ok({ scope: "shared" }, "u2", { ...doc, sharedWithMe: true })).toBe(true);
  });
});

import { buildHrProfiles, NO_PERSON } from "../services/attachment.service";

describe("perfis de RH", () => {
  const r = (cat: string, person: string | null, day: string, tags: string[] = []) =>
    ({ createdAt: new Date(`2026-${day}T10:00:00Z`), tags, identifier: { categoryId: cat, issuedTo: person } });

  it("agrupa por colaborador sem distinguir acentos, maiúsculas nem espaços", () => {
    const p = buildHrProfiles([
      r("CTR", "Ana Lúcia  Mendes", "01-10", ["assinado"]),
      r("FLC", "ana lucia mendes", "10-31"),
      r("FLC", "ANA LÚCIA MENDES", "11-30", ["urgente"]),
      r("CTR", "João Santos", "03-01"),
      r("FLC", null, "11-01"),
    ]);
    expect(p.map((x) => x.name)).toEqual(["ANA LÚCIA MENDES", "João Santos", ""]); // sem colaborador no fim
    const ana = p[0];
    expect(ana.total).toBe(3);
    expect(ana.byCategory).toEqual({ CTR: 1, FLC: 2 });
    expect(ana.missing).toEqual(["ADM"]);
    expect(ana.tags.sort()).toEqual(["assinado", "urgente"]);
    expect(p[2].key).toBe(NO_PERSON);
    expect(p[2].missing).toEqual([]);
  });

  it("assinala rescisão e documentos obrigatórios", () => {
    const [joao] = buildHrProfiles([r("CTR", "João", "01-01"), r("ADM", "João", "01-01"), r("TER", "João", "11-01")]);
    expect(joao.missing).toEqual([]);
    expect(joao.terminated).toBe(true);
  });

  it("filtros por grupo e colaborador", () => {
    const d = { ...doc, issuedTo: "Ana Lúcia Mendes", categoryGroup: "RH" };
    expect(matchesDocumentFilters(d, { group: "RH", issuedTo: "ana lucia mendes" }, "u1")).toBe(true);
    expect(matchesDocumentFilters(d, { group: "Jurídico" }, "u1")).toBe(false);
    expect(matchesDocumentFilters(d, { issuedTo: NO_PERSON }, "u1")).toBe(false);
    expect(matchesDocumentFilters({ ...d, issuedTo: null }, { issuedTo: NO_PERSON }, "u1")).toBe(true);
    expect(matchesDocumentFilters(d, { q: "mendes" }, "u2")).toBe(true);
  });
});
