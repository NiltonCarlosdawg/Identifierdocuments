import fs from "node:fs";
import path from "node:path";

export type VerificationResult = {
  found:      boolean;
  identifier: string;
  mimeType:   string;
  method:     string;
  excerpt?:   string;   // trecho do texto onde foi encontrado
};

/**
 * Extrai texto de um ficheiro PDF usando pdf-parse.
 */
async function extractPdfText(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Extrai texto de um ficheiro DOCX usando mammoth.
 */
async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

/**
 * Extrai texto simples de ficheiros .txt / .md / .csv.
 */
function extractPlainText(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Verifica se um identificador consta no conteúdo de um documento.
 * Suporta: PDF, DOCX, DOC, TXT, MD, CSV.
 */
export async function verifyDocumentContainsIdentifier(
  filePath: string,
  mimeType: string,
  identifier: string
): Promise<VerificationResult> {
  let text    = "";
  let method  = "";

  const ext = path.extname(filePath).toLowerCase();

  try {
    if (mimeType === "application/pdf" || ext === ".pdf") {
      text   = await extractPdfText(filePath);
      method = "pdf-parse";
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === ".docx"
    ) {
      text   = await extractDocxText(filePath);
      method = "mammoth";
    } else if (
      mimeType === "application/msword" ||
      ext === ".doc"
    ) {
      // DOC antigo — mammoth consegue extrair na maioria dos casos
      text   = await extractDocxText(filePath);
      method = "mammoth (doc)";
    } else if (
      ["text/plain", "text/markdown", "text/csv"].includes(mimeType) ||
      [".txt", ".md", ".csv"].includes(ext)
    ) {
      text   = extractPlainText(filePath);
      method = "plain-text";
    } else {
      // Tipo não suportado — tenta como texto simples
      text   = extractPlainText(filePath);
      method = "fallback-plain-text";
    }
  } catch (err: any) {
    throw new Error(`Falha ao extrair texto do documento: ${err.message}`);
  }

  const found = text.includes(identifier);

  // Extrai um pequeno excerto em torno do identificador para contexto
  let excerpt: string | undefined;
  if (found) {
    const idx   = text.indexOf(identifier);
    const start = Math.max(0, idx - 40);
    const end   = Math.min(text.length, idx + identifier.length + 40);
    excerpt = text.slice(start, end).replace(/\n+/g, " ").trim();
  }

  return { found, identifier, mimeType, method, excerpt };
}
