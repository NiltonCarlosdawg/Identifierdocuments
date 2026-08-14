import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { db } from "../db";
import { devices, auditLogs, sectors, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireRole, getFreshRoles } from "../middleware/auth";
import { withTenant } from "../db/withTenant";
import { safeError } from "../lib/errors";
import { getClientIp } from "../lib/ip";

export const devicesModule = new (Elysia as any)({ prefix: "/devices" })
  .use(requireAuth())

  .post("/", async ({ auth, body, tenantId, set, request }) => {
    try {
      const ip = getClientIp(request);
      const result = await withTenant(tenantId, async (tx) => {
        const u = await tx.query.users.findFirst({
          where: eq(users.id, auth!.userId),
          columns: { sectorId: true },
        });
        const resolvedSectorId = u?.sectorId ?? null;

        const [device] = await tx.insert(devices).values({
          tenantId,
          name: body.name,
          sectorId: resolvedSectorId,
          registeredByUserId: auth!.userId,
          status: "active",
          lastSeenAt: new Date(),
        }).returning();

        await tx.insert(auditLogs).values({
          tenantId,
          userId: auth!.userId,
          action: "DEVICE_REGISTERED",
          resource: "devices",
          resourceId: device.id,
          metadata: JSON.stringify({ name: body.name, sectorId: resolvedSectorId }),
          ip,
        });

        return device;
      });
      return { data: result };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DEVICE_CREATE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      name: t.String(),
    }),
    detail: { summary: "Registar novo dispositivo", tags: ["Dispositivos"] },
  })

  .get("/", async ({ tenantId, auth }) => {
    try {
      const roleNames = await getFreshRoles(auth!.userId, tenantId);
      let sectorId: string | null = null;
      if (!roleNames.includes("ORG_ADMIN")) {
        const me = await withTenant(tenantId, async (tx) => {
          const u = await tx.query.users.findFirst({
            where: eq(users.id, auth!.userId),
            columns: { sectorId: true },
          });
          return u?.sectorId ?? null;
        });
        if (!me) return { data: [] };
        sectorId = me;
      }

      const list = await withTenant(tenantId, async (tx) => {
        const conditions = [eq(devices.tenantId, tenantId)];
        if (sectorId) conditions.push(eq(devices.sectorId, sectorId));
        return tx.query.devices.findMany({
          where: and(...conditions),
          with: { sector: true, registeredBy: { columns: { id: true, fullName: true } } },
        });
      });
      return { data: list };
    } catch (err: any) {
      return { error: { code: "DEVICE_LIST_ERROR", message: safeError(err) } };
    }
  }, {
    detail: { summary: "Listar dispositivos (filtrados por sector conforme role)", tags: ["Dispositivos"] },
  })

  .use(requireRole("ORG_ADMIN"))
  .patch("/:id/deactivate", async ({ params, tenantId, auth, set, request }) => {
    try {
      const ip = getClientIp(request);
      const result = await withTenant(tenantId, async (tx) => {
        const [device] = await tx.update(devices)
          .set({ status: "inactive", deactivatedAt: new Date(), deactivatedBy: auth!.userId })
          .where(and(eq(devices.id, params.id), eq(devices.tenantId, tenantId)))
          .returning();
        if (!device) { set.status = 404; return null; }

        await tx.insert(auditLogs).values({
          tenantId,
          userId: auth!.userId,
          action: "DEVICE_DEACTIVATED",
          resource: "devices",
          resourceId: device.id,
          metadata: JSON.stringify({ name: device.name, status: device.status }),
          ip,
        });

        return device;
      });
      if (!result) return { error: { code: "NOT_FOUND", message: "Dispositivo não encontrado." } };
      return { data: result };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DEVICE_DEACTIVATE_ERROR", message: safeError(err) } };
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { summary: "Desactivar dispositivo (exclusivo ORG_ADMIN)", tags: ["Dispositivos"] },
  })

  .patch("/:id", async ({ params, body, tenantId, auth, set, request }) => {
    try {
      const ip = getClientIp(request);
      if (!("sectorId" in body)) {
        set.status = 400;
        return { error: { code: "VALIDATION_ERROR", message: "Nenhum campo para actualizar." } };
      }

      const result = await withTenant(tenantId, async (tx) => {
        if (body.sectorId !== null) {
          const sector = await tx.query.sectors.findFirst({
            where: eq(sectors.id, body.sectorId),
            columns: { tenantId: true },
          });
          if (!sector || sector.tenantId !== tenantId) {
            set.status = 400;
            return { error: { code: "VALIDATION_ERROR", message: "Sector não encontrado." } } as any;
          }
        }

        const [device] = await tx.update(devices)
          .set({ sectorId: body.sectorId })
          .where(and(eq(devices.id, params.id), eq(devices.tenantId, tenantId)))
          .returning();
        if (!device) { set.status = 404; return null; }

        await tx.insert(auditLogs).values({
          tenantId,
          userId: auth!.userId,
          action: "DEVICE_UPDATED",
          resource: "devices",
          resourceId: device.id,
          metadata: JSON.stringify({ sectorId: body.sectorId }),
          ip,
        });

        return device;
      });
      if (!result) return { error: { code: "NOT_FOUND", message: "Dispositivo não encontrado." } };
      if ((result as any).error) return result;
      return { data: result };
    } catch (err: any) {
      set.status = 400;
      return { error: { code: "DEVICE_UPDATE_ERROR", message: safeError(err) } };
    }
  }, {
    body: t.Object({
      sectorId: t.Union([t.String(), t.Null()]),
    }),
    params: t.Object({ id: t.String() }),
    detail: { summary: "Reatribuir sector do dispositivo (null para desatribuir, exclusivo ORG_ADMIN)", tags: ["Dispositivos"] },
  });
