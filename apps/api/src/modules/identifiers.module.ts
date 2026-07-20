import { Elysia, t } from "elysia";
import { generateIdentifier, listIdentifiers, getIdentifier, cancelIdentifier } from "../services/identifier.service";
import { leaseIdentifiers, releaseLease, forceReleaseLease, registerOfflineIdentifiers } from "../services/lease.service";
import { requireAuth } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";

export const identifiersModule = new Elysia({ prefix: "/identifiers" })
  .use(requireAuth())

  .post("/lease", async ({ auth, body, set, request, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const ip = request.headers.get("x-forwarded-for") || "unknown";
          const targetSectorId = body.sectorId ?? auth!.sectorId;
          const result = await leaseIdentifiers(tx, auth!, {
            deviceId: body.deviceId, categoryId: body.categoryId,
            sectorId: targetSectorId ?? undefined,
          }, ip);
          return { data: result };
        } catch (err: any) {
          console.error("[LEASE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "LEASE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      deviceId: t.String(),
      categoryId: t.String(),
      sectorId: t.Optional(t.String()),
    }),
    detail: { summary: "Reservar lote de sequências (lease)", tags: ["Identificadores"] },
  })

  .post("/release", async ({ auth, body, set, request, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const ip = request.headers.get("x-forwarded-for") || "unknown";
          const result = await releaseLease(tx, auth!, { leaseId: body.leaseId }, ip);
          return { data: result };
        } catch (err: any) {
          console.error("[RELEASE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "RELEASE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({ leaseId: t.String() }),
    detail: { summary: "Libertar lease (devolver não-usados ao pool)", tags: ["Identificadores"] },
  })

  .post("/force-release", async ({ auth, body, set, request, tenantId }) => {
    if (!auth!.roles.includes("ORG_ADMIN")) {
      set.status = 403;
      return { error: { code: "FORBIDDEN", message: "Apenas administradores podem forçar libertação." } };
    }
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const ip = request.headers.get("x-forwarded-for") || "unknown";
          const result = await forceReleaseLease(tx, auth!, { leaseId: body.leaseId }, ip);
          return { data: result };
        } catch (err: any) {
          console.error("[FORCE_RELEASE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "FORCE_RELEASE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({ leaseId: t.String() }),
    detail: { summary: "Forçar libertação de lease (admin)", tags: ["Identificadores"] },
  })

  .post("/register-offline", async ({ auth, body, set, request, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const ip = request.headers.get("x-forwarded-for") || "unknown";
          const result = await registerOfflineIdentifiers(tx, auth!, {
            deviceId: body.deviceId,
            leaseId: body.leaseId,
            identifiers: body.identifiers,
          }, ip);
          return { data: result };
        } catch (err: any) {
          console.error("[REGISTER_OFFLINE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "REGISTER_OFFLINE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      deviceId: t.String(),
      leaseId: t.String(),
      identifiers: t.Array(t.Object({
        sequence: t.Integer(),
        categoryId: t.String(),
        issuedTo: t.Optional(t.String()),
        description: t.Optional(t.String()),
        visibility: t.Optional(t.Union([t.Literal("public"), t.Literal("sector_only")])),
        origin: t.Optional(t.Union([t.Literal("digital"), t.Literal("physical")])),
      })),
    }),
    detail: { summary: "Registar identificadores gerados offline", tags: ["Identificadores"] },
  })

  .post("/generate", async ({ auth, body, set, request, tenantId }) => {
    try {
      return await withTenant(tenantId, async (tx) => {
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
          console.error("[GENERATE_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "IDENTIFIER_ERROR", message: safeError(err) } };
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
    try {
      return await withTenant(tenantId, async (tx) => {
        try {
          const result = await cancelIdentifier(tx, auth!, params.identifier, body.reason);
          return { data: result };
        } catch (err: any) {
          console.error("[CANCEL_ERROR]", err);
          throw err;
        }
      });
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "CANCEL_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ identifier: t.String() }),
    body: t.Object({ reason: t.String() }),
    detail: { summary: "Cancelar identificador", tags: ["Identificadores"] },
  });
