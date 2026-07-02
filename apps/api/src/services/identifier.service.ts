import type { DB } from "../db";
import { identifiers, categories, documents, documentShares, auditLogs, organizations, sectors } from "../db/schema";
import { eq, and, or, desc, sql, isNull } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";

function buildIdentifier(orgPrefix: string, catPrefix: string, year: number, month: number, day: number, seq: number): string {
  const mmdd = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return `${orgPrefix}-${catPrefix}-${year}-${mmdd}-${String(seq).padStart(3, "0")}`;
}

async function getSharedDocIds(tx: DB, auth: AuthPayload): Promise<Set<string>> {
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
  row: { visibility: string | null; sectorId: string | null; document?: { id: string } | null; createdBy?: string | null },
  auth: AuthPayload,
  sharedDocIds: Set<string>,
): VisibilityResult {
  if (row.createdBy && row.createdBy === auth.userId) return { visible: true, restricted: false };

  const visibility = row.visibility ?? "public";
  if (visibility === "public") return { visible: true, restricted: false };

  const isOwnSector = row.sectorId != null && row.sectorId === auth.sectorId;
  if (isOwnSector) return { visible: true, restricted: false };

  if (row.document && sharedDocIds.has(row.document.id)) return { visible: true, restricted: false };

  if (auth.roles.includes("ORG_ADMIN")) return { visible: true, restricted: true };

  return { visible: false, restricted: false };
}

export async function generateIdentifier(tx: DB, auth: AuthPayload, opts: {
  categoryId: string; issuedTo?: string; description?: string;
  origin?: "digital" | "physical"; visibility?: "public" | "sector_only";
  sectorId?: string;
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
    const lockKey = sql`hashtext(CONCAT(${auth.tenantId}, '-', ${opts.categoryId}))`;
    await tx2.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const [row] = await tx2
      .select({ next: sql<number>`COALESCE(MAX(sequence), 0) + 1` })
      .from(identifiers)
      .where(
        and(
          eq(identifiers.tenantId, auth.tenantId),
          eq(identifiers.categoryId, opts.categoryId)
        )
      );
    const seqResult = Number(row.next);

    const identifierStr = buildIdentifier(orgPrefix, cat.prefix, year, month, day, seqResult);
    const visibility = opts.visibility ?? cat.defaultVisibility ?? "public";

    return tx2.insert(identifiers).values({
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
  });

  await tx.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "GENERATE",
    resource: "identifiers",
    resourceId: id.id,
    metadata: JSON.stringify({ identifier: id.identifier, category: cat.name, visibility: id.visibility }),
    ip,
  });

  return id;
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
    with: { category: true, document: true, sector: true },
    orderBy: desc(identifiers.createdAt),
  });

  const sharedDocIds = await getSharedDocIds(tx, auth);

  const filtered = allRows.filter(row => {
    const { visible } = checkVisibility(row, auth, sharedDocIds);
    return visible;
  });

  const data = filtered.map(row => {
    const { restricted } = checkVisibility(row, auth, sharedDocIds);
    return { ...row, restricted };
  });

  const paginated = data.slice(offset, offset + limit);

  return { data: paginated, meta: { total: data.length, page, limit } };
}

export async function getIdentifier(tx: DB, auth: AuthPayload, identifierStr: string, ip: string = "unknown") {
  const row = await tx.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
    with: { category: true, document: true, sector: true, createdByUser: true },
  });

  if (!row) return null;

  const sharedDocIds = await getSharedDocIds(tx, auth);
  const { visible, restricted } = checkVisibility(row, auth, sharedDocIds);
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

  return { ...row, restricted };
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
