import { describe, expect, test } from "bun:test";
import { findIdentifierIndex } from "../services/document.service";

describe("procura do identificador no texto extraído", () => {
  const id = "VL-PROP-2026-0725-100";

  test("encontra ocorrência isolada ou colada a minúsculas/pontuação", () => {
    expect(findIdentifierIndex(`Ref. ${id}.`, id)).toBe(5);
    expect(findIdentifierIndex(`${id}Proposta`, id)).toBe(0);
    expect(findIdentifierIndex(`referência${id}`, id)).toBe(10);
  });

  test("não bate dentro de uma sequência maior nem de outro prefixo", () => {
    expect(findIdentifierIndex("VL-PROP-2026-0725-1000", id)).toBe(-1);
    expect(findIdentifierIndex("XVL-PROP-2026-0725-100", id)).toBe(-1);
    expect(findIdentifierIndex("texto sem nada", id)).toBe(-1);
  });
});
