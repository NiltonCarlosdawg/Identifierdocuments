import { db } from "../db";
import { identifiers, categories, documents, auditLogs, organizations } from "../db/schema";
import { eq, and, desc, sql, like } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";

function buildIdentifier(orgPrefix: string, catPrefix: string, year: number, month: number, day: number, seq: number): string {
  const mmdd = `${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  return `${orgPrefix}-${catPrefix}-${year}-${mmdd}-${String(seq).padStart(3, "0")}`;
}

export async function generateIdentifier(auth: AuthPayload, opts: { categoryId: string; issuedTo?: string; description?: string; origin?: "digital" | "physical" }) {
  const cat = await db.query.categories.findFirst({ where: eq(categories.id, opts.categoryId) });
  if (!cat) throw new Error(`Categoria '${opts.categoryId}' não encontrada.`);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, auth.tenantId) });
  const orgPrefix = org?.identifierPrefix || "VL";

  const seqResult = await db
    .select({ next: sql`COALESCE(MAX(sequence), 0) + 1` })
    .from(identifiers)
    .where(and(eq(identifiers.tenantId, auth.tenantId), eq(identifiers.categoryId, opts.categoryId)))
    .then((r) => Number(r[0].next));

  const identifierStr = buildIdentifier(orgPrefix, cat.prefix, year, month, day, seqResult);

  const [id] = await db.insert(identifiers).values({
    tenantId: auth.tenantId,
    sectorId: auth.sectorId!,
    categoryId: opts.categoryId,
    identifier: identifierStr,
    sequence: seqResult,
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
    metadata: JSON.stringify({ identifier: identifierStr, category: cat.name }),
    ip: null,
  });

  return id;
}

export async function listIdentifiers(auth: AuthPayload, filters: { categoryId?: string; status?: string; origin?: string; page?: number; limit?: number }) {
  const { categoryId, status, origin, page = 1, limit = 20 } = filters;
  const offset = (page - 1) * limit;

  const conditions = [eq(identifiers.tenantId, auth.tenantId)];
  if (categoryId) conditions.push(eq(identifiers.categoryId, categoryId));
  if (status) conditions.push(eq(identifiers.status, status as any));
  if (origin) conditions.push(eq(identifiers.origin, origin as any));

  const rows = await db.query.identifiers.findMany({
    where: and(...conditions),
    with: { category: true, document: true, sector: true },
    orderBy: desc(identifiers.createdAt),
    limit,
    offset,
  });

  const [totalResult] = await db
    .select({ total: sql`COUNT(*)` })
    .from(identifiers)
    .where(and(...conditions))
    .then((r) => r);

  return { data: rows, meta: { total: Number(totalResult.total), page, limit } };
}

export async function getIdentifier(auth: AuthPayload, identifierStr: string) {
  const row = await db.query.identifiers.findFirst({
    where: and(eq(identifiers.identifier, identifierStr), eq(identifiers.tenantId, auth.tenantId)),
    with: { category: true, document: true, sector: true, createdByUser: true },
  });

  if (!row) return null;

  await db.insert(auditLogs).values({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "QUERY",
    resource: "identifiers",
    resourceId: row.id,
    metadata: JSON.stringify({ identifier: identifierStr }),
    ip: null,
  });

  return row;
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
