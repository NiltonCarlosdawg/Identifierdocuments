import { db } from "../db";
import { identifiers, categories, documents, documentShares, auditLogs, organizations, sectors } from "../db/schema";
import { eq, and, or, desc, sql, isNull } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";

function buildIdentifier(orgPrefix: string, catPrefix: string, year: number, month: number, day: number, seq: number): string {
  const mmdd = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return `${orgPrefix}-${catPrefix}-${year}-${mmdd}-${String(seq).padStart(3, "0")}`;
}

async function getSharedDocIds(auth: AuthPayload): Promise<Set<string>> {
  if (!auth.sectorId) return new Set();
  const rows = await db.select({ documentId: documentShares.documentId })
    .from(documentShares)
    .where(and(
      or(
        eq(documentShares.sharedWithSectorId, auth.sectorId),
        eq(documentShares.sharedWithUserId, auth.userId),
      ),
      isNull(documentShares.revokedAt),
    ));
  return new Set(rows.map(r => r.documentId));
}

type VisibilityResult = { visible: boolean; restricted: boolean };

function checkVisibility(
  row: { visibility: string | null; sectorId: string | null; document?: { id: string } | null },
  auth: AuthPayload,
  sharedDocIds: Set<string>,
): VisibilityResult {
  const visibility = row.visibility ?? "public";
  if (visibility === "public") return { visible: true, restricted: false };

  const isAdmin = auth.roles.includes("ORG_ADMIN");
  const isOwnSector = row.sectorId != null && row.sectorId === auth.sectorId;

  if (isOwnSector) return { visible: true, restricted: false };
  if (isAdmin) return { visible: true, restricted: true };
  if (row.document && sharedDocIds.has(row.document.id)) return { visible: true, restricted: false };

  return { visible: false, restricted: false };
}

export async function generateIdentifier(auth: AuthPayload, opts: {
  categoryId: string; issuedTo?: string; description?: string;
  origin?: "digital" | "physical"; visibility?: "public" | "sector_only";
}) {
  const cat = await db.query.categories.findFirst({ where: eq(categories.id, opts.categoryId) });
  if (!cat) throw new Error(`Categoria '${opts.categoryId}' não encontrada.`);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, auth.tenantId) });
  const orgPrefix = org?.identifierPrefix || "VL";

  const seqResult = await db.transaction(async (tx) => {
    const lockKey = sql`hashtext(${auth.tenantId || ''} || '-' || ${opts.categoryId})`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
    const [row] = await tx
      .select({ next: sql<number>`COALESCE(MAX(sequence), 0) + 1` })
      .from(identifiers)
      .where(
        and(
          eq(identifiers.tenantId, auth.tenantId),
          eq(identifiers.categoryId, opts.categoryId)
        )
      );
    return Number(row.next);
  });

  const identifierStr = buildIdentifier(orgPrefix, cat.prefix, year, month, day, seqResult);
  const visibility = opts.visibility ?? cat.defaultVisibility ?? "public";

  const [id] = await db.insert(identifiers).values({
    tenantId: auth.tenantId,
    sectorId: auth.sectorId!,
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

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "GENERATE",
    resource: "identifiers",
    resourceId: id.id,
    metadata: JSON.stringify({ identifier: identifierStr, category: cat.name, visibility }),
    ip: null,
  });

  return id;
}

export async function listIdentifiers(auth: AuthPayload, filters: {
  categoryId?: string; status?: string; origin?: string; page?: number; limit?: number;
}) {
  const { categoryId, status, origin, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  const conditions = [eq(identifiers.tenantId, auth.tenantId)];
  if (categoryId) conditions.push(eq(identifiers.categoryId, categoryId));
  if (status) conditions.push(eq(identifiers.status, status as any));
  if (origin) conditions.push(eq(identifiers.origin, origin as any));

  const allRows = await db.query.identifiers.findMany({
    where: and(...conditions),
    with: { category: true, document: true, sector: true },
    orderBy: desc(identifiers.createdAt),
  });

  const sharedDocIds = await getSharedDocIds(auth);

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

export async function getIdentifier(auth: AuthPayload, identifierStr: string) {
  const row = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
    with: { category: true, document: true, sector: true, createdByUser: true },
  });

  if (!row) return null;

  const sharedDocIds = await getSharedDocIds(auth);
  const { visible, restricted } = checkVisibility(row, auth, sharedDocIds);
  if (!visible) return null;

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "QUERY",
    resource: "identifiers",
    resourceId: row.id,
    metadata: JSON.stringify({ identifier: identifierStr }),
    ip: null,
  });

  return { ...row, restricted };
}

export async function cancelIdentifier(auth: AuthPayload, identifierStr: string, reason: string) {
  const row = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
  });

  if (!row) throw new Error("Identificador não encontrado.");
  if (row.status === "attached") throw new Error("Não é possível cancelar um identificador com documento associado.");
  if (row.status === "cancelled") throw new Error("Identificador já está cancelado.");

  await db.update(identifiers)
    .set({ status: "cancelled" })
    .where(eq(identifiers.id, row.id));

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "CANCEL",
    resource: "identifiers",
    resourceId: row.id,
    metadata: JSON.stringify({ identifier: identifierStr, reason }),
    ip: null,
  });

  return db.query.identifiers.findFirst({ where: eq(identifiers.id, row.id) });
}
