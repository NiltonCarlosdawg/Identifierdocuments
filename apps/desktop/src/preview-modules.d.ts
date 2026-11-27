// Tipos dos módulos usados pela pré-visualização de documentos (components/documents/DocumentPreview.tsx).
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
declare module "mammoth/mammoth.browser" {
  export function convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
