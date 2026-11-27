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
