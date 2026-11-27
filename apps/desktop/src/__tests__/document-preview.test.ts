import { describe, expect, it, beforeAll } from "bun:test";
import { Window } from "happy-dom";
import { previewKind, sanitizeDocHtml } from "../interfaces/components/documents/preview-utils";

beforeAll(() => {
  // O sanitizador usa DOMParser (existe no webview; nos testes vem do happy-dom).
  (globalThis as any).DOMParser = new Window().DOMParser;
});

describe("tipo de pré-visualização", () => {
  it("pelo MIME e, sem ele, pela extensão", () => {
    expect(previewKind("application/pdf", "x")).toBe("pdf");
    expect(previewKind("", "Contrato.PDF")).toBe("pdf");
    expect(previewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "c.docx")).toBe("docx");
    expect(previewKind(null, "c.docx")).toBe("docx");
    expect(previewKind("image/jpeg", "scan")).toBe("image");
    expect(previewKind("", "digitalizacao.png")).toBe("image");
    expect(previewKind("text/csv", "a.csv")).toBe("csv");
    expect(previewKind("text/plain", "notas.txt")).toBe("text");
    expect(previewKind("", "leia-me.md")).toBe("text");
    expect(previewKind("application/msword", "antigo.doc")).toBe("none");
    expect(previewKind("application/zip", "pacote.zip")).toBe("none");
  });
});

describe("sanitizador do HTML do Word", () => {
  it("mantém texto, títulos, listas e tabelas", () => {
    const html = '<h1>Contrato</h1><p>Entre <strong>A</strong> e <em>B</em></p><ul><li>um</li></ul><table><tr><td colspan="2">x</td></tr></table>';
    expect(sanitizeDocHtml(html)).toContain("<h1>Contrato</h1>");
    expect(sanitizeDocHtml(html)).toContain('<td colspan="2">x</td>');
    expect(sanitizeDocHtml(html)).toContain("<strong>A</strong>");
  });
  it("remove scripts, estilos, iframes e handlers", () => {
    const out = sanitizeDocHtml('<p onclick="alert(1)" style="color:red">ok</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/script|onclick|onerror|style=|iframe|alert/i);
    expect(out).toContain("<p>ok</p>");
  });
  it("links só http(s)/mailto e abertos fora; imagens só embutidas", () => {
    const out = sanitizeDocHtml('<a href="javascript:alert(1)">mau</a><a href="https://docid.ao">bom</a><img src="https://x/y.png"><img src="data:image/png;base64,AAA" alt="logo">');
    expect(out).not.toContain("javascript:");
    expect(out).toContain('<a href="https://docid.ao" target="_blank" rel="noopener noreferrer">bom</a>');
    expect(out).not.toContain("https://x/y.png");
    expect(out).toContain('src="data:image/png;base64,AAA"');
  });
  it("elementos desconhecidos perdem a marcação mas o texto fica", () => {
    expect(sanitizeDocHtml("<div><section>texto <font>dentro</font></section></div>")).toBe("texto dentro");
  });
});
