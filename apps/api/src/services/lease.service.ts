import type { DB } from "../db";
import { identifiers, categories, organizations, devices, identifierLeases, identifierReleasePool, auditLogs } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";

export async function leaseIdentifiers(
  tx: DB,
  auth: AuthPayload,
  opts: { deviceId: string; categoryId: string; sectorId?: string },
  ip: string = "unknown",
) {
  const cat = await tx.query.categories.findFirst({ where: eq(categories.id, opts.categoryId) });
  if (!cat) throw new Error(`Categoria '${opts.categoryId}' não encontrada.`);
  if (!cat.requiresSequential) throw new Error(`Categoria '${opts.categoryId}' não requer sequenciação.`);

  const device = await tx.query.devices.findFirst({
    where: and(eq(devices.id, opts.deviceId), eq(devices.tenantId, auth.tenantId)),
  });
  if (!device) throw new Error("Dispositivo não encontrado.");
  if (device.status !== "active") throw new Error("Dispositivo não está activo.");

  const resolvedSectorId = opts.sectorId ?? auth.sectorId;
  if (!resolvedSectorId) throw new Error("Sector não definido. Indique sectorId ou associe o utilizador a um sector.");

  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, auth.tenantId) });
  const batchSize = org?.identifierLeaseBatchSize ?? 50;

  const [lease] = await tx.transaction(async (tx2) => {
    const lockKey = sql`hashtext(CONCAT(${auth.tenantId}::text, '-', ${opts.categoryId}::text))`;
    await tx2.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    const existingActive = await tx2.query.identifierLeases.findFirst({
      where: and(
        eq(identifierLeases.tenantId, auth.tenantId),
        eq(identifierLeases.categoryId, opts.categoryId),
        eq(identifierLeases.deviceId, opts.deviceId),
        eq(identifierLeases.status, "active"),
      ),
    });
    if (existingActive) throw new Error("Dispositivo já tem um lease activo para esta categoria.");

    const [idMax] = await tx2
      .select({ val: sql<number>`COALESCE(MAX(sequence), 0)` })
      .from(identifiers)
      .where(and(eq(identifiers.tenantId, auth.tenantId), eq(identifiers.categoryId, opts.categoryId)));

    const [leaseMax] = await tx2
      .select({ val: sql<number>`COALESCE(MAX(end_seq), 0)` })
      .from(identifierLeases)
      .where(and(eq(identifierLeases.tenantId, auth.tenantId), eq(identifierLeases.categoryId, opts.categoryId)));

    const [poolMax] = await tx2
      .select({ val: sql<number>`COALESCE(MAX(range_end), 0)` })
      .from(identifierReleasePool)
      .where(and(eq(identifierReleasePool.tenantId, auth.tenantId), eq(identifierReleasePool.categoryId, opts.categoryId)));

    const nextStart = Math.max(Number(idMax.val), Number(leaseMax.val), Number(poolMax.val)) + 1;
    const endSeq = nextStart + batchSize - 1;

    return tx2.insert(identifierLeases).values({
      tenantId: auth.tenantId,
      categoryId: opts.categoryId,
      sectorId: resolvedSectorId,
      deviceId: opts.deviceId,
      startSeq: nextStart,
      endSeq,
      status: "active",
    }).returning();
  });

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "LEASE",
    resource: "identifier_leases",
    resourceId: lease.id,
    metadata: JSON.stringify({
      categoryId: opts.categoryId, deviceId: opts.deviceId,
      startSeq: lease.startSeq, endSeq: lease.endSeq,
    }),
    ip,
  });

  return lease;
}

export async function releaseLease(
  tx: DB,
  auth: AuthPayload,
  opts: { leaseId: string },
  ip: string = "unknown",
) {
  const lease = await tx.query.identifierLeases.findFirst({
    where: and(eq(identifierLeases.id, opts.leaseId), eq(identifierLeases.tenantId, auth.tenantId)),
  });
  if (!lease) throw new Error("Lease não encontrado.");
  if (lease.status !== "active") throw new Error("Lease não está activo.");

  const unusedStart = (lease.usedUpTo ?? lease.startSeq - 1) + 1;
  if (unusedStart <= lease.endSeq) {
    await tx.insert(identifierReleasePool).values({
      tenantId: auth.tenantId,
      categoryId: lease.categoryId,
      sectorId: lease.sectorId,
      rangeStart: unusedStart,
      rangeEnd: lease.endSeq,
    });
  }

  await tx.update(identifierLeases)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(identifierLeases.id, lease.id));

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "RELEASE",
    resource: "identifier_leases",
    resourceId: lease.id,
    metadata: JSON.stringify({
      categoryId: lease.categoryId, unusedStart, unusedEnd: lease.endSeq,
    }),
    ip,
  });

  return { message: "Lease libertado com sucesso." };
}

export async function forceReleaseLease(
  tx: DB,
  auth: AuthPayload,
  opts: { leaseId: string },
  ip: string = "unknown",
) {
  const lease = await tx.query.identifierLeases.findFirst({
    where: and(eq(identifierLeases.id, opts.leaseId), eq(identifierLeases.tenantId, auth.tenantId)),
  });
  if (!lease) throw new Error("Lease não encontrado.");
  if (lease.status !== "active") throw new Error("Lease não está activo.");

  const unusedStart = (lease.usedUpTo ?? lease.startSeq - 1) + 1;
  if (unusedStart <= lease.endSeq) {
    await tx.insert(identifierReleasePool).values({
      tenantId: auth.tenantId,
      categoryId: lease.categoryId,
      sectorId: lease.sectorId,
      rangeStart: unusedStart,
      rangeEnd: lease.endSeq,
    });
  }

  await tx.update(identifierLeases)
    .set({ status: "force_released", releasedAt: new Date() })
    .where(eq(identifierLeases.id, lease.id));

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "FORCE_RELEASE",
    resource: "identifier_leases",
    resourceId: lease.id,
    metadata: JSON.stringify({
      categoryId: lease.categoryId, unusedStart, unusedEnd: lease.endSeq,
    }),
    ip,
  });

  return { message: "Lease libertado forçadamente com sucesso." };
}

export async function registerOfflineIdentifiers(
  tx: DB,
  auth: AuthPayload,
  opts: {
    deviceId: string;
    leaseId: string;
    identifiers: Array<{
      sequence: number;
      issuedTo?: string;
      description?: string;
      visibility?: "public" | "sector_only";
      origin?: "digital" | "physical";
    }>;
  },
  ip: string = "unknown",
) {
  const lease = await tx.query.identifierLeases.findFirst({
    where: and(eq(identifierLeases.id, opts.leaseId), eq(identifierLeases.tenantId, auth.tenantId)),
  });
  if (!lease) throw new Error("Lease não encontrado.");
  if (lease.status !== "active") throw new Error("Lease não está activo.");
  if (lease.deviceId !== opts.deviceId) throw new Error("Lease não pertence a este dispositivo.");

  const device = await tx.query.devices.findFirst({
    where: and(eq(devices.id, opts.deviceId), eq(devices.tenantId, auth.tenantId)),
  });
  if (!device) throw new Error("Dispositivo não encontrado.");
  if (device.status !== "active") throw new Error("Dispositivo não está activo.");

  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, auth.tenantId) });
  const orgPrefix = org?.identifierPrefix ?? "VL";

  const cat = await tx.query.categories.findFirst({ where: eq(categories.id, lease.categoryId) });
  if (!cat) throw new Error("Categoria não encontrada.");

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const created = await tx.transaction(async (tx2) => {
    const lockKey = sql`hashtext(CONCAT(${auth.tenantId}::text, '-', ${lease.categoryId}::text))`;
    await tx2.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);

    const freshLease = await tx2.query.identifierLeases.findFirst({
      where: eq(identifierLeases.id, opts.leaseId),
    });
    if (!freshLease || freshLease.status !== "active") throw new Error("Lease já não está activo.");

    const currentUsedUpTo = freshLease.usedUpTo ?? freshLease.startSeq - 1;

    const sorted = [...opts.identifiers].sort((a, b) => a.sequence - b.sequence);
    for (let i = 0; i < sorted.length; i++) {
      const ident = sorted[i];
      const expectedSeq = currentUsedUpTo + 1 + i;
      if (ident.sequence < freshLease.startSeq || ident.sequence > freshLease.endSeq) {
        throw new Error(`Sequência ${ident.sequence} fora do intervalo do lease [${freshLease.startSeq}, ${freshLease.endSeq}].`);
      }
      if (ident.sequence !== expectedSeq) {
        throw new Error(`Sequência fora de ordem. Esperado ${expectedSeq}, recebido ${ident.sequence}.`);
      }
    }

    const mmdd = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
    const inserted = await tx2.insert(identifiers).values(
      sorted.map((ident) => {
        const identifierStr = `${orgPrefix}-${cat.prefix}-${year}-${mmdd}-${String(ident.sequence).padStart(3, "0")}`;
        return {
          tenantId: auth.tenantId,
          sectorId: lease.sectorId,
          categoryId: lease.categoryId,
          identifier: identifierStr,
          sequence: ident.sequence,
          issuedTo: ident.issuedTo ?? null,
          description: ident.description ?? null,
          visibility: ident.visibility ?? "public",
          status: "active" as const,
          origin: ident.origin ?? "physical",
          createdBy: device.userId,
        };
      }),
    ).returning();

    const newUsedUpTo = sorted[sorted.length - 1].sequence;
    await tx2.update(identifierLeases)
      .set({ usedUpTo: newUsedUpTo })
      .where(eq(identifierLeases.id, opts.leaseId));

    return inserted;
  });

  for (const id of created) {
    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "REGISTER_OFFLINE",
      resource: "identifiers",
      resourceId: id.id,
      metadata: JSON.stringify({ identifier: id.identifier, categoryId: id.categoryId, leaseId: opts.leaseId }),
      ip,
    });
  }

  return created;
}
