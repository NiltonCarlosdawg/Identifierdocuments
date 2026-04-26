import { Elysia, t } from "elysia";
import fs from "node:fs";
import { attachDocument, getDocument, downloadDocument } from "../services/attachment.service";

export const documentsModule = new Elysia({ prefix: "/documents" })

  // ── Associar documento a um identificador ───────────────────────────────
  .post("/attach", async ({ body, error }) => {
    try {
      const result = await attachDocument({
        identifier:  body.identifier,
        file:        body.file,
        uploadedBy:  body.uploadedBy,
      });

      if (!result.success) {
        // Verificação falhou — responde com 422 Unprocessable Entity
        return error(422, {
          success: false,
          message: result.message,
          verification: result.verification,
        });
      }

      return {
        success:      true,
        message:      result.message,
        document:     result.document,
        verification: result.verification,
      };
    } catch (err: any) {
      return error(400, { success: false, message: err.message });
    }
  }, {
    body: t.Object({
      identifier:  t.String({ description: "Identificador gerado (ex: VL-PROP-2026-0424-001)" }),
      file:        t.File({ description: "Ficheiro do documento (PDF, DOCX, TXT)" }),
      uploadedBy:  t.Optional(t.String({ description: "Nome ou ID do utilizador que faz o upload" })),
    }),
    detail: {
      summary: "Associar documento a um identificador",
      description:
        "Recebe um ficheiro, extrai o seu texto (PDF via pdf-parse, DOCX via mammoth) e verifica se o " +
        "identificador consta no conteúdo. Só guarda o ficheiro se a verificação for bem-sucedida.",
      tags: ["Documentos"],
    },
  })

  // ── Consultar documento de um identificador ──────────────────────────────
  .get("/:identifier", ({ params, error }) => {
    const doc = getDocument(params.identifier);
    if (!doc) {
      return error(404, {
        message: `Nenhum documento encontrado para o identificador '${params.identifier}'.`,
      });
    }
    return { success: true, data: doc };
  }, {
    params: t.Object({ identifier: t.String() }),
    detail: {
      summary: "Consultar documento associado",
      description: "Retorna os metadados do documento associado a um identificador",
      tags: ["Documentos"],
    },
  })

  // ── Download do documento ────────────────────────────────────────────────
  .get("/:identifier/download", ({ params, error, set }) => {
    const result = downloadDocument(params.identifier);
    if (!result) {
      return error(404, {
        message: `Ficheiro não encontrado para o identificador '${params.identifier}'.`,
      });
    }

    const fileBuffer = fs.readFileSync(result.filePath);
    set.headers["Content-Disposition"] = `attachment; filename="${result.fileName}"`;
    set.headers["Content-Type"] = "application/octet-stream";
    return fileBuffer;
  }, {
    params: t.Object({ identifier: t.String() }),
    detail: {
      summary: "Download do documento",
      description: "Faz o download do ficheiro associado a um identificador",
      tags: ["Documentos"],
    },
  });
