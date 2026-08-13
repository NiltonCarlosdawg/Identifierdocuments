import { describe, expect, test } from "bun:test";
import { parseDocumentTags, serializeDocumentTags } from "../services/attachment.service";

describe("document tags", () => {
  test("parse devolve array vazio para inválidos", () => {
    expect(parseDocumentTags(null)).toEqual([]);
    expect(parseDocumentTags("")).toEqual([]);
    expect(parseDocumentTags("não-json")).toEqual([]);
    expect(parseDocumentTags("{}")).toEqual([]);
  });

  test("parse e serialize normalizam e deduplicam", () => {
    expect(parseDocumentTags(JSON.stringify(["urgente", " urgente ", "assinado", ""])) ).toEqual([
      "urgente",
      "assinado",
    ]);
    expect(serializeDocumentTags(["  assinado ", "urgente", "assinado", ""])).toBe(
      JSON.stringify(["assinado", "urgente"]),
    );
  });
});
