import { Elysia, t } from "elysia";
import { generateIdentifier, listIdentifiers, getIdentifier, cancelIdentifier } from "../services/identifier.service";
import { requireAuth } from "../middleware/auth";

export const identifiersModule = new Elysia({ prefix: "/identifiers" })
  .use(requireAuth())

  .post("/generate", async ({ auth, body, set }) => {
    try {
      const result = await generateIdentifier(auth!, {
        categoryId: body.categoryId, issuedTo: body.issuedTo,
        description: body.description, origin: body.origin,
        visibility: body.visibility, sectorId: body.sectorId,
      });
      return { data: result };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "IDENTIFIER_ERROR", message: err.message } };
    }
  }, {
    body: t.Object({
      categoryId: t.String(),
      issuedTo: t.Optional(t.String()),
      description: t.Optional(t.String()),
      origin: t.Optional(t.Union([t.Literal("digital"), t.Literal("physical")])),
      visibility: t.Optional(t.Union([t.Literal("public"), t.Literal("sector_only")])),
      sectorId: t.Optional(t.String()),
    }),
    detail: { summary: "Gerar identificador", tags: ["Identificadores"] },
  })

  .get("/", async ({ auth, query }) => {
    return listIdentifiers(auth!, {
      categoryId: query.categoryId, status: query.status,
      origin: query.origin, page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
  }, {
    query: t.Object({
      categoryId: t.Optional(t.String()), status: t.Optional(t.String()),
      origin: t.Optional(t.String()), page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Listar identificadores", tags: ["Identificadores"] },
  })

  .get("/:identifier", async ({ auth, params, set }) => {
    const result = await getIdentifier(auth!, params.identifier);
    if (!result) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Identificador não encontrado." } }; }
    return { data: result };
  }, {
    params: t.Object({ identifier: t.String() }),
    detail: { summary: "Consultar identificador", tags: ["Identificadores"] },
  })

  .patch("/:identifier/cancel", async ({ auth, params, body, set }) => {
    try {
      const result = await cancelIdentifier(auth!, params.identifier, body.reason);
      return { data: result };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "CANCEL_ERROR", message: err.message } };
    }
  }, {
    params: t.Object({ identifier: t.String() }),
    body: t.Object({ reason: t.String() }),
    detail: { summary: "Cancelar identificador", tags: ["Identificadores"] },
  });
