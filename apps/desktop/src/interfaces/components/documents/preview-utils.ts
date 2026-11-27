export type PreviewKind = "pdf" | "docx" | "image" | "text" | "csv" | "none";

const ext = (filename: string) => (filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "");

/** Que tipo de pré-visualização usar, pelo tipo MIME e, na falta dele, pela extensão. */
export function previewKind(mime: string | null | undefined, filename: string | null | undefined): PreviewKind {
  const m = (mime || "").toLowerCase();
  const e = ext(filename || "");
  if (m.includes("pdf") || e === "pdf") return "pdf";
  if (m.includes("wordprocessingml") || e === "docx") return "docx";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(e)) return "image";
  if (m.includes("csv") || e === "csv") return "csv";
  if (m.startsWith("text/") || ["txt", "md", "log", "json", "xml"].includes(e)) return "text";
  return "none";
}

const ALLOWED_TAGS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "SUB", "SUP", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "IMG", "BLOCKQUOTE", "SPAN",
]);

const DROP_WITH_CONTENT = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "TEMPLATE", "SVG", "MATH"]);

function keepAttr(tag: string, name: string, value: string): boolean {
  if (tag === "A") return name === "href" && /^(https?:|mailto:)/i.test(value);
  if (tag === "IMG") return (name === "src" && /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(value)) || name === "alt";
  if (tag === "TD" || tag === "TH") return name === "colspan" || name === "rowspan";
  return false;
}

/**
 * HTML do Word (mammoth) → só elementos de texto/tabela, sem atributos perigosos.
 * Links só http(s)/mailto e abertos fora; imagens só data:image (as que vêm dentro do .docx).
 * Uma passagem chega: querySelectorAll devolve uma lista estática com todos os descendentes.
 */
export function sanitizeDocHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toUpperCase();
    if (DROP_WITH_CONTENT.has(tag)) { el.remove(); continue; }
    if (!ALLOWED_TAGS.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    for (const attr of Array.from(el.attributes)) {
      if (!keepAttr(tag, attr.name.toLowerCase(), attr.value.trim())) el.removeAttribute(attr.name);
    }
    if (tag === "A") { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
  }
  return doc.body.innerHTML;
}

/** Proporção altura/largura de uma folha A4 (297/210). */
export const A4_RATIO = 297 / 210;
/** Largura de uma folha A4 em píxeis CSS a 96 ppp (210 mm). */
export const A4_CSS_WIDTH = 794;

/** Maior folha com a proporção `ratio` (altura/largura) que cabe em width×height. */
export function fitPage(width: number, height: number, ratio: number): { width: number; height: number } {
  if (width <= 0 || height <= 0 || !(ratio > 0)) return { width: 0, height: 0 };
  const byWidth = { width, height: width * ratio };
  if (byWidth.height <= height) return { width: Math.floor(byWidth.width), height: Math.floor(byWidth.height) };
  return { width: Math.floor(height / ratio), height: Math.floor(height) };
}
