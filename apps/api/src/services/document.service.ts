import fs from "node:fs";
import path from "node:path";

export interface VerificationResult {
  found: boolean;
  identifier: string;
  mimeType: string;
  method: string;
  excerpt?: string;
}

async function extractPdfText(filePath: string): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

async function extractDocxText(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

function extractPlainText(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export async function verifyDocumentContainsIdentifier(
  filePath: string,
  mimeType: string,
  identifier: string
): Promise<VerificationResult> {
  let text = "";
  let method = "";
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (mimeType === "application/pdf" || ext === ".pdf") {
      text = await extractPdfText(filePath);
      method = "pdf-parse";
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === ".docx"
    ) {
      text = await extractDocxText(filePath);
      method = "mammoth";
    } else if (mimeType === "application/msword" || ext === ".doc") {
      // CORREÇÃO: mammoth só lê o formato OOXML (.docx); o .doc binário antigo
      // (formato OLE/CFB) não é suportado pela biblioteca e a chamada anterior
      // (`extractDocxText`, que usa mammoth) ia falhar ou devolver texto vazio/lixo,
      // apesar do "method" indicar "mammoth (doc)" como se tivesse funcionado.
      // Em vez de fingir suporte, devolvemos um erro claro até existir extracção
      // real para .doc (ex.: via uma biblioteca dedicada a OLE/CFB, ou conversão
      // prévia para .docx/.pdf no servidor).
      throw new Error(".doc (formato binário antigo do Word) ainda não é suportado para verificação automática. Converta para .docx ou .pdf antes de anexar.");
    } else if (["text/plain", "text/markdown", "text/csv"].includes(mimeType) || [".txt", ".md", ".csv"].includes(ext)) {
      text = extractPlainText(filePath);
      method = "plain-text";
    } else {
      // NOTA 1: .xls/.xlsx/.ppt/.pptx ainda não têm extracção de texto implementada
      // aqui, apesar de generateThumbnailAsync (attachment.service.ts) os listar como
      // "suportados" para geração de thumbnail. Na prática nunca chegam a essa fase,
      // porque falham sempre aqui primeiro. Alinhei a lista de extensões aceites em
      // generateThumbnailAsync para deixar de anunciar suporte que não existe — ver
      // esse ficheiro. Para suportar de facto, é necessário adicionar extracção via
      // biblioteca própria (ex. SheetJS/xlsx para folhas de cálculo).
      //
      // NOTA 2 (maior): imagens (.png/.jpg/.gif/.bmp/.webp) também caem aqui — não há
      // OCR implementado. Visto o schema ter identifiers.origin = "physical" e
      // documents.uploadSource = "scanner", o fluxo de digitalizar um documento físico
      // (foto/scan) e confirmar o identificador automaticamente parece ser intenção de
      // produto, mas está incompleto: hoje, anexar uma imagem falha sempre na
      // verificação. Implementar OCR (ex. tesseract.js) é um trabalho maior, fora do
      // âmbito desta correcção — mas vale a pena confirmar se é um gap conhecido.
      throw new Error(`Tipo de ficheiro não suportado: ${mimeType || ext}. Formatos aceites: PDF, DOCX, TXT, MD, CSV.`);
    }
  } catch (err: any) {
    throw new Error(`Falha ao extrair texto do documento: ${err.message}`);
  }

  const found = text.includes(identifier);

  let excerpt: string | undefined;
  if (found) {
    const idx = text.indexOf(identifier);
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + identifier.length + 40);
    excerpt = text.slice(start, end).replace(/\n+/g, " ").trim();
  }

  return { found, identifier, mimeType, method, excerpt };
}