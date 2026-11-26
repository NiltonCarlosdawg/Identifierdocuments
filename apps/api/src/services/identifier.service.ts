import type { DB } from "../db";
import { identifiers, categories, documents, documentShares, auditLogs, organizations, sectors, idempotencyRecords, documentVersions } from "../db/schema";
import { eq, and, or, desc, sql, isNull } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";
import { getFreshRoles } from "../middleware/auth";
import { takeFromReleasePool } from "./release-pool.service";

function buildIdentifier(orgPrefix: string, catPrefix: string, year: number, month: number, day: number, seq: number): string {
  const mmdd = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return `${orgPrefix}-${catPrefix}-${year}-${mmdd}-${String(seq).padStart(3, "0")}`;
}

function hydratePrimaryDocument(
  docs: Array<{
    kind: string;
    versions?: Array<{ isCurrent: boolean; filename: string; mimeType: string; fileSize: number }> | null;
    [key: string]: unknown;
  }> | null | undefined,
) {
  const primary = docs?.find((d) => d.kind === "primary") ?? null;
  if (!primary) return null;
  const current = primary.versions?.find((v) => v.isCurrent) ?? primary.versions?.[0];
  const { versions: _versions, ...rest } = primary;
  return {
    ...rest,
    filename: current?.filename ?? null,
    mimeType: current?.mimeType ?? null,
    fileSize: current?.fileSize ?? null,
  };
}

export async function getSharedDocIds(tx: DB, auth: AuthPayload): Promise<Set<string>> {
  const condition = auth.sectorId
    ? or(
        eq(documentShares.sharedWithSectorId, auth.sectorId),
        eq(documentShares.sharedWithUserId, auth.userId),
      )
    : eq(documentShares.sharedWithUserId, auth.userId);

  const rows = await tx.select({ documentId: documentShares.documentId })
    .from(documentShares)
    .where(and(
      condition,
      isNull(documentShares.revokedAt),
      eq(documentShares.status, "active"),
    ));
  return new Set(rows.map(r => r.documentId));
}

type VisibilityResult = { visible: boolean; restricted: boolean };

function checkVisibility(
  row: {
    visibility: string | null;
    sectorId: string | null;
    documents?: { id: string }[] | null;
    document?: { id: string } | null;
    createdBy?: string | null;
  },
  auth: AuthPayload,
  sharedDocIds: Set<string>,
  freshRoles: string[],
): VisibilityResult {
  if (row.createdBy && row.createdBy === auth.userId) return { visible: true, restricted: false };

  const visibility = row.visibility ?? "public";
  if (visibility === "public") return { visible: true, restricted: false };

  const isOwnSector = row.sectorId != null && row.sectorId === auth.sectorId;
  if (isOwnSector) return { visible: true, restricted: false };

  const docs = row.documents ?? (row.document ? [row.document] : []);
  if (docs.some((d) => sharedDocIds.has(d.id))) return { visible: true, restricted: false };

  if (freshRoles.includes("ORG_ADMIN")) return { visible: true, restricted: true };

  return { visible: false, restricted: false };
}

export async function generateIdentifier(tx: DB, auth: AuthPayload, opts: {
  categoryId: string; issuedTo?: string; description?: string;
  origin?: "digital" | "physical"; visibility?: "public" | "sector_only";
  sectorId?: string;
  idempotencyKey?: string;
}, ip: string = "unknown") {
  const cat = await tx.query.categories.findFirst({ where: eq(categories.id, opts.categoryId) });
  if (!cat) throw new Error(`Categoria '${opts.categoryId}' não encontrada.`);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, auth.tenantId) });
  const orgPrefix = org?.identifierPrefix || "VL";

  const resolvedSectorId = opts.sectorId ?? auth.sectorId;
  if (!resolvedSectorId) {
    throw new Error("Sector não definido. Indique sectorId no body ou associe o utilizador a um sector.");
  }

    const [id] = await tx.transaction(async (tx2) => {
    await tx2.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${auth.tenantId}), hashtext(${opts.categoryId}))`);

    if (opts.idempotencyKey) {
      const record = await tx2.query.idempotencyRecords.findFirst({
        where: and(
          eq(idempotencyRecords.tenantId, auth.tenantId),
          eq(idempotencyRecords.idempotencyKey, opts.idempotencyKey),
        ),
      });
      if (record) return [record.result as any];
    }

    // NOTA: `select()` do Drizzle exige `.from()`; para um scalar puro usa-se execute().
    const rows = (await tx2.execute(sql`
      SELECT GREATEST(
        (SELECT COALESCE(MAX(sequence), 0) FROM ${identifiers} WHERE tenant_id = ${auth.tenantId} AND category_id = ${opts.categoryId}),
        (SELECT COALESCE(MAX(end_seq), 0) FROM identifier_leases WHERE tenant_id = ${auth.tenantId} AND category_id = ${opts.categoryId})
      ) + 1 AS next
    `)) as unknown as Array<{ next: string | number }>;
    const row = rows[0];
    // Um número devolvido seguro (ver release-pool.service) sai antes de estender a série.
    const reused = await takeFromReleasePool(tx2 as unknown as DB, auth, opts.categoryId, 1, ip);
    const seqResult = reused ? reused.start : Number(row.next);

    const identifierStr = buildIdentifier(orgPrefix, cat.prefix, year, month, day, seqResult);
    const visibility = opts.visibility ?? cat.defaultVisibility ?? "public";

    const [inserted] = await tx2.insert(identifiers).values({
      tenantId: auth.tenantId,
      sectorId: resolvedSectorId,
      categoryId: opts.categoryId,
      identifier: identifierStr,
      sequence: seqResult,
      visibility,
      issuedTo: opts.issuedTo ?? null,
      description: opts.description ?? null,
      status: "active",
      origin: opts.origin ?? "digital",
      createdBy: auth.userId,
    }).returning();

    if (opts.idempotencyKey) {
      const [rec] = await tx2.insert(idempotencyRecords).values({
        tenantId: auth.tenantId,
        idempotencyKey: opts.idempotencyKey,
        result: inserted as any,
      }).onConflictDoNothing().returning();

      if (!rec) {
        // Pedido concorrente com a mesma key ganhou a corrida: este identificador
        // fica órfão — devolve-se o resultado do vencedor e regista-se a
        // discórdia na auditoria (mesmo padrão usado em registerOfflineIdentifiers).
        const existing = await tx2.query.idempotencyRecords.findFirst({
          where: and(
            eq(idempotencyRecords.tenantId, auth.tenantId),
            eq(idempotencyRecords.idempotencyKey, opts.idempotencyKey),
          ),
        });
        const winner = (existing?.result ?? inserted) as any;
        await tx2.insert(auditLogs).values({
          tenantId: auth.tenantId,
          userId: auth.userId,
          action: "IDEMPOTENCY_DISCARDED",
          resource: "identifiers",
          resourceId: inserted.id,
          metadata: JSON.stringify({
            idempotencyKey: opts.idempotencyKey,
            winnerIdentifier: winner.identifier,
            orphanIdentifier: inserted.identifier,
            reason: "Concurrent call with same idempotencyKey won the race",
          }),
          ip,
        });
        return [winner];
      }
    }

    return [inserted];
  });

  const identifier = Array.isArray(id) ? id[0] : id;

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "GENERATE",
    resource: "identifiers",
    resourceId: identifier.id,
    metadata: JSON.stringify({ identifier: identifier.identifier, category: cat.name, visibility: identifier.visibility }),
    ip,
  });

  return identifier;
}

export async function listIdentifiers(tx: DB, auth: AuthPayload, filters: {
  categoryId?: string; status?: string; origin?: string; page?: number; limit?: number;
}) {
  const { categoryId, status, origin, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  const conditions = [eq(identifiers.tenantId, auth.tenantId)];
  if (categoryId) conditions.push(eq(identifiers.categoryId, categoryId));
  if (status) conditions.push(eq(identifiers.status, status as any));
  if (origin) conditions.push(eq(identifiers.origin, origin as any));

  const allRows = await tx.query.identifiers.findMany({
    where: and(...conditions),
    with: {
      category: true,
      documents: {
        with: {
          versions: {
            where: eq(documentVersions.isCurrent, true),
          },
        },
      },
      sector: true,
      createdByUser: true,
    },
    orderBy: desc(identifiers.createdAt),
  });

  const sharedDocIds = await getSharedDocIds(tx, auth);
  const freshRoles = await getFreshRoles(auth.userId, auth.tenantId, tx);

  const filtered = allRows.filter(row => {
    const { visible } = checkVisibility(row as any, auth, sharedDocIds, freshRoles);
    return visible;
  });

  const data = filtered.map(row => {
    const { restricted } = checkVisibility(row as any, auth, sharedDocIds, freshRoles);
    return { ...row, document: hydratePrimaryDocument(row.documents), restricted };
  });

  const paginated = data.slice(offset, offset + limit);

  return { data: paginated, meta: { total: data.length, page, limit } };
}

export async function getIdentifier(tx: DB, auth: AuthPayload, identifierStr: string, ip: string = "unknown") {
  const row = await tx.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
    with: {
      category: true,
      documents: {
        with: {
          versions: {
            where: eq(documentVersions.isCurrent, true),
          },
        },
      },
      sector: true,
      createdByUser: true,
    },
  });

  if (!row) return null;

  const sharedDocIds = await getSharedDocIds(tx, auth);
  const freshRoles = await getFreshRoles(auth.userId, auth.tenantId, tx);
  const { visible, restricted } = checkVisibility(row as any, auth, sharedDocIds, freshRoles);
  if (!visible) return null;

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "QUERY",
    resource: "identifiers",
    resourceId: row.id,
    metadata: JSON.stringify({ identifier: identifierStr }),
    ip,
  });

  return { ...row, document: hydratePrimaryDocument(row.documents), restricted };
}

export async function cancelIdentifier(tx: DB, auth: AuthPayload, identifierStr: string, reason: string, ip: string = "unknown") {
  const row = await tx.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
  });

  if (!row) throw new Error("Identificador não encontrado.");
  if (row.status === "attached") throw new Error("Não é possível cancelar um identificador com documento associado.");
  if (row.status === "cancelled") throw new Error("Identificador já está cancelado.");

  await tx.update(identifiers)
    .set({ status: "cancelled" })
    .where(eq(identifiers.id, row.id));

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "CANCEL",
    resource: "identifiers",
    resourceId: row.id,
    metadata: JSON.stringify({ identifier: identifierStr, reason }),
    ip,
  });

  return tx.query.identifiers.findFirst({ where: eq(identifiers.id, row.id) });
}
