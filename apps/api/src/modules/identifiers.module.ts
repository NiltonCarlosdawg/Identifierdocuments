import { Elysia, t } from "elysia";
import { generateIdentifier, listIdentifiers, getIdentifier, cancelIdentifier } from "../services/identifier.service";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const identifiersModule = new Elysia({ prefix: "/identifiers" })
  .use(requireAuth())

  .post("/generate", async ({ auth, body, set, request, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      try {
        const ip = request.headers.get("x-forwarded-for") || "unknown"; // TODO(security): validar/sanitizar IP; atualmente confia no header
        if (!(await checkRateLimit(`generate:${ip}:${auth!.userId}`, 20, 60_000))) {
          set.status = 429;
          return { error: { code: "RATE_LIMITED", message: "Muitos pedidos. Tente novamente em 1 minuto." } };
        }
        const targetSectorId = body.sectorId ?? auth!.sectorId;
        if (!targetSectorId) {
          set.status = 422; return { error: { code: "VALIDATION_ERROR", message: "Sector não definido." } };
        }
        if (targetSectorId !== auth!.sectorId && !auth!.roles.includes("ORG_ADMIN")) {
          set.status = 403; return { error: { code: "FORBIDDEN", message: "Não pode gerar identificadores para outro sector." } };
        }
        const result = await generateIdentifier(tx, auth!, {
          categoryId: body.categoryId, issuedTo: body.issuedTo,
          description: body.description, origin: body.origin,
          visibility: body.visibility, sectorId: targetSectorId,
        });
        return { data: result };
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "IDENTIFIER_ERROR", message: safeError(err) } };
      }
    });
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

  .get("/", async ({ auth, query, set, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        return listIdentifiers(tx, auth!, {
          categoryId: query.categoryId, status: query.status,
          origin: query.origin,
          page: query.page ? (Number.isFinite(parseInt(query.page, 10)) ? Math.max(1, parseInt(query.page, 10)) : 1) : 1,
          limit: query.limit ? (Number.isFinite(parseInt(query.limit, 10)) ? Math.min(Math.max(1, parseInt(query.limit, 10)), 100) : 20) : 20,
        });
      });
    } catch (err: any) {
      set.status = 500;
      return { error: { code: "INTERNAL_ERROR", message: safeError(err) } };
    }
  }, {
    query: t.Object({
      categoryId: t.Optional(t.String()), status: t.Optional(t.String()),
      origin: t.Optional(t.String()), page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
    detail: { summary: "Listar identificadores", tags: ["Identificadores"] },
  })

  .get("/:identifier", async ({ auth, params, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      const result = await getIdentifier(tx, auth!, params.identifier);
      if (!result) { set.status = 404; return { error: { code: "NOT_FOUND", message: "Identificador não encontrado." } }; }
      return { data: result };
    });
  }, {
    params: t.Object({ identifier: t.String() }),
    detail: { summary: "Consultar identificador", tags: ["Identificadores"] },
  })

  .patch("/:identifier/cancel", async ({ auth, params, body, set, tenantId }) => {
    return withTenant(tenantId, async (tx) => {
      try {
        const result = await cancelIdentifier(tx, auth!, params.identifier, body.reason);
        return { data: result };
      } catch (err: any) {
        set.status = 400;
        return { error: { code: "CANCEL_ERROR", message: safeError(err) } };
      }
    });
  }, {
    params: t.Object({ identifier: t.String() }),
    body: t.Object({ reason: t.String() }),
    detail: { summary: "Cancelar identificador", tags: ["Identificadores"] },
  });
