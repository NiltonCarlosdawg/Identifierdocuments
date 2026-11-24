import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";

describe("rotas de documentos", () => {
  it("a rota de tags valida o parâmetro que o handler consome", () => {
    const src = readFileSync(new URL("../modules/documents.module.ts", import.meta.url), "utf8");
    const route = src.slice(src.indexOf('.patch("/:param/tags"'));
    const block = route.slice(0, 2000);
    expect(block).toContain('params: t.Object({ param: t.String() })');
  });
});
