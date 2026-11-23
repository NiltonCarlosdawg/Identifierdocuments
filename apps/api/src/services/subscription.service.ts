import type { DB } from "../db";
import { db } from "../db";
import { withTenant } from "../db/withTenant";
import { documents, documentVersions, identifiers, organizations, plans, users } from "../db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export type LimitError = { code: string; message: string };

export class SubscriptionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Executa no tenant quando não há transacção aberta (RLS exige app.current_tenant). */
async function inTenant<T>(tenantId: string, executor: DB | undefined, query: (t: DB) => Promise<T>): Promise<T> {
  return executor ? query(executor) : withTenant(tenantId, (tx) => query(tx));
}

/** Estado derivado: paid com data passada é expired, mesmo sem job de renovação. */
export async function getSubscriptionContext(
  tenantId: string,
  executor?: DB,
): Promise<{
  org: typeof organizations.$inferSelect;
  plan: typeof plans.$inferSelect;
  status: "free" | "paid" | "expired" | "suspended";
}> {
  return inTenant(tenantId, executor, async (t) => {
    const [row] = await t.select({ org: organizations, plan: plans })
      .from(organizations)
      .innerJoin(plans, eq(organizations.planId, plans.id))
      .where(eq(organizations.id, tenantId))
      .limit(1);
    if (!row) throw new Error("Organização não encontrada.");

    const status = row.org.subscriptionStatus === "paid"
      && row.org.subscriptionExpiresAt != null
      && row.org.subscriptionExpiresAt < new Date()
      ? "expired"
      : row.org.subscriptionStatus;
    return { ...row, status };
  });
}

export async function getFreePlan(executor?: DB): Promise<typeof plans.$inferSelect> {
  const [plan] = await (executor ?? db).select().from(plans)
    .where(eq(plans.isFree, true))
    .limit(1);
  if (!plan) throw new Error("Plano gratuito não encontrado.");
  return plan;
}

export async function checkUserLimit(tenantId: string, executor?: DB): Promise<LimitError | null> {
  return inTenant(tenantId, executor, async (t) => {
    const { plan } = await getSubscriptionContext(tenantId, t);
    const [row] = await t.select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, tenantId));
    return row.n > plan.maxUsers
      ? {
        code: "SUBSCRIPTION_USER_LIMIT",
        message: "O limite de utilizadores do seu plano foi atingido. Faça upgrade para convidar mais.",
      }
      : null;
  });
}

export async function checkIdentifierQuota(tenantId: string, executor?: DB): Promise<LimitError | null> {
  return inTenant(tenantId, executor, async (t) => {
    const { plan, status } = await getSubscriptionContext(tenantId, t);
    // O caller decide admin antes de chamar: aqui só importa o estado do tenant.
    if (status === "expired" || status === "suspended") {
      return {
        code: "SUBSCRIPTION_RESTRICTED",
        message: "Subscrição expirada. Contacte o administrador.",
      };
    }
    const [row] = await t.select({ n: sql<number>`count(*)::int` })
      .from(identifiers)
      .where(and(
        eq(identifiers.tenantId, tenantId),
        gte(identifiers.createdAt, sql`date_trunc('month', now())`),
      ));
    return row.n >= plan.monthlyOnlineIdentifiers
      ? {
        code: "IDENTIFIER_QUOTA_EXCEEDED",
        message: "O limite mensal de identificadores do seu plano foi atingido. Faça upgrade para continuar.",
      }
      : null;
  });
}

export async function checkUploadLimit(
  tenantId: string,
  userId: string,
  executor?: DB,
): Promise<LimitError | null> {
  return inTenant(tenantId, executor, async (t) => {
    const { status } = await getSubscriptionContext(tenantId, t);
    if (status !== "expired" && status !== "suspended") return null;

    // dia UTC: aproximação aceite para o limite de 1/dia
    const today = sql`date_trunc('day', now())`;
    const [docs] = await t.select({ n: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(
        eq(documents.tenantId, tenantId),
        eq(documents.uploadedBy, userId),
        gte(documents.createdAt, today),
      ));
    const [versions] = await t.select({ n: sql<number>`count(*)::int` })
      .from(documentVersions)
      .where(and(
        eq(documentVersions.tenantId, tenantId),
        eq(documentVersions.uploadedBy, userId),
        gte(documentVersions.createdAt, today),
      ));
    return docs.n + versions.n >= 1
      ? { code: "UPLOAD_LIMIT_REACHED", message: "Subscrição expirada: limite de 1 upload por dia." }
      : null;
  });
}

export async function getTenantContactEmail(tenantId: string, executor?: DB): Promise<string | null> {
  return inTenant(tenantId, executor, async (t) => {
    const [row] = await t.select({ email: users.email })
      .from(users)
      .where(eq(users.tenantId, tenantId))
      .orderBy(users.createdAt)
      .limit(1);
    return row?.email ?? null;
  });
}
