import { Elysia, t } from "elysia";
import {
  generateIdentifier,
  getIdentifier,
  listIdentifiers,
  cancelIdentifier,
} from "../services/identifier.service";

export const identifiersModule = new Elysia({ prefix: "/identifiers" })

  // ── Gerar novo identificador ─────────────────────────────────────────────
  .post("/generate", ({ body, error }) => {
    try {
      const result = generateIdentifier({
        categoryId:  body.categoryId,
        issuedTo:    body.issuedTo,
        description: body.description,
      });
      return { success: true, data: result };
    } catch (err: any) {
      return error(400, { success: false, message: err.message });
    }
  }, {
    body: t.Object({
      categoryId:  t.String({ description: "ID da categoria (ex: PROP, FAT, NDA)" }),
      issuedTo:    t.Optional(t.String({ description: "Nome do cliente ou destinatário" })),
      description: t.Optional(t.String({ description: "Descrição breve do documento" })),
    }),
    detail: {
      summary: "Gerar novo identificador",
      description: "Gera um identificador único no formato VL-{PREFIX}-{YYYY}-{MMDD}-{SEQ}",
      tags: ["Identificadores"],
    },
  })

  // ── Listar identificadores ───────────────────────────────────────────────
  .get("/", ({ query }) => {
    return listIdentifiers({
      categoryId: query.categoryId,
      status:     query.status,
      year:       query.year ? Number(query.year) : undefined,
      issuedTo:   query.issuedTo,
      limit:      query.limit  ? Number(query.limit)  : 50,
      offset:     query.offset ? Number(query.offset) : 0,
    });
  }, {
    query: t.Object({
      categoryId: t.Optional(t.String()),
      status:     t.Optional(t.String()),
      year:       t.Optional(t.String()),
      issuedTo:   t.Optional(t.String()),
      limit:      t.Optional(t.String()),
      offset:     t.Optional(t.String()),
    }),
    detail: {
      summary: "Listar identificadores",
      description: "Filtra por categoria, status (pending | attached | cancelled), ano e destinatário",
      tags: ["Identificadores"],
    },
  })

  // ── Consultar identificador específico ───────────────────────────────────
  .get("/:identifier", ({ params, error }) => {
    const result = getIdentifier(params.identifier);
    if (!result) return error(404, { message: `Identificador '${params.identifier}' não encontrado.` });
    return { success: true, data: result };
  }, {
    params: t.Object({ identifier: t.String() }),
    detail: {
      summary: "Consultar identificador",
      description: "Retorna os dados completos de um identificador, incluindo o documento associado (se existir)",
      tags: ["Identificadores"],
    },
  })

  // ── Cancelar identificador ───────────────────────────────────────────────
  .patch("/:identifier/cancel", ({ params, body, error }) => {
    try {
      const result = cancelIdentifier(params.identifier, body.reason);
      return { success: true, data: result };
    } catch (err: any) {
      return error(400, { success: false, message: err.message });
    }
  }, {
    params: t.Object({ identifier: t.String() }),
    body:   t.Object({
      reason: t.String({ description: "Motivo do cancelamento" }),
    }),
    detail: {
      summary: "Cancelar identificador",
      description: "Cancela um identificador no estado 'pending'. Identificadores com documentos associados não podem ser cancelados.",
      tags: ["Identificadores"],
    },
  });
