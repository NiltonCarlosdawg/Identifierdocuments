import { describe, expect, test } from "bun:test";
import {
  cacheableClassification,
  classifierCacheKey,
  parseCachedClassification,
} from "../services/classifier.service";

describe("classifier cache", () => {
  test("a chave inclui tenantId e não o texto em claro", () => {
    const key = classifierCacheKey("tenant-a", "FACTURA Nº 1 do cliente XYZ", "fat.pdf");
    expect(key.startsWith("classifier:tenant-a:hash:")).toBe(true);
    expect(key).not.toContain("FACTURA");
    expect(key.split(":")).toHaveLength(4);
  });

  test("tenants diferentes não partilham a mesma chave", () => {
    const a = classifierCacheKey("t1", "mesmo texto", "a.pdf");
    const b = classifierCacheKey("t2", "mesmo texto", "a.pdf");
    expect(a).not.toBe(b);
  });

  test("filename altera a chave", () => {
    const a = classifierCacheKey("t1", "corpo", "FAT.pdf");
    const b = classifierCacheKey("t1", "corpo", "ATA.pdf");
    expect(a).not.toBe(b);
  });

  test("não cacheia UNKNOWN nem confiança 0", () => {
    expect(cacheableClassification({ categoryId: "UNKNOWN", confidence: 0, reasoning: "off" })).toBe(false);
    expect(cacheableClassification({ categoryId: "FAT", confidence: 0, reasoning: "" })).toBe(false);
    expect(cacheableClassification({ categoryId: "FAT", confidence: 0.9, reasoning: "factura" })).toBe(true);
  });

  test("parse rejeita payload inválido ou UNKNOWN", () => {
    expect(parseCachedClassification("não-json")).toBeNull();
    expect(parseCachedClassification(JSON.stringify({ categoryId: "UNKNOWN", confidence: 1, reasoning: "" }))).toBeNull();
    expect(parseCachedClassification(JSON.stringify({ categoryId: "ATA", confidence: 0.96, reasoning: "acta" }))).toEqual({
      categoryId: "ATA",
      confidence: 0.96,
      reasoning: "acta",
    });
  });
});
