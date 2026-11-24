import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { db, lookupDb } from "../db";
import { auditLogs, organizations, orders, plans, users } from "../db/schema";
import { withTenant } from "../db/withTenant";
import { logger } from "../lib/logger";
import { sendOrderReceivedEmail, sendOrderRejectedEmail, sendSubscriptionActiveEmail } from "./mailer.service";
import { getSubscriptionContext, getTenantContactEmail } from "./subscription.service";
import { issueLicense } from "./license.service";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) throw new Error("JWT_SECRET environment variable is required");
const JWT_SECRET = new TextEncoder().encode(rawSecret);
const CHECKOUT_VERIFY = { issuer: "docid-api", audience: "docid-checkout" };

export type PaymentMethod = "multicaixa" | "transfer" | "send_order";

export class OrderError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** Token de checkout do painel desktop: 48h, single-use pelo jti único na orders. */
export async function signCheckoutToken(tenantId: string): Promise<string> {
  return new SignJWT({ purpose: "checkout", tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(randomUUID())
    .setIssuer("docid-api")
    .setAudience("docid-checkout")
    .setExpirationTime("48h")
    .sign(JWT_SECRET);
}

export async function resolveCheckoutToken(token: string): Promise<{ tenantId: string; jti: string }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, CHECKOUT_VERIFY);
    if (payload.purpose !== "checkout"
      || typeof payload.tenantId !== "string" || !payload.tenantId
      || typeof payload.jti !== "string" || !payload.jti) {
      throw new Error("Invalid checkout token");
    }
    return { tenantId: payload.tenantId, jti: payload.jti };
  } catch {
    throw new OrderError("INVALID_TOKEN", "Token de checkout inválido ou expirado.", 401);
  }
}

export interface CreateOrderInput {
  token?: string;
  tenantSlug?: string;
  tenantEmail?: string;
  planId: string;
  paymentMethod: PaymentMethod;
  phone: string;
  contactEmail: string;
}

export async function createOrder(input: CreateOrderInput): Promise<{ orderId: string; status: "pending" }> {
  const identifiers = [input.token, input.tenantSlug, input.tenantEmail].filter(Boolean);
  if (identifiers.length !== 1) {
    throw new OrderError("INVALID_TENANT_IDENTIFIER", "Indique exatamente um identificador da organização.", 400);
  }

  let tenantId: string;
  let jti: string;
  if (input.token) {
    const claims = await resolveCheckoutToken(input.token);
    tenantId = claims.tenantId;
    jti = claims.jti;
  } else if (input.tenantSlug) {
    // Lookup cross-tenant: organizations tem RLS (ver lookupDb em db/index.ts).
    const [bySlug] = await lookupDb.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.slug, input.tenantSlug)).limit(1);
    if (!bySlug) throw new OrderError("TENANT_NOT_FOUND", "Organização não encontrada.", 404);
    tenantId = bySlug.id;
    jti = randomUUID();
  } else {
    const [byEmail] = await lookupDb.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.email, input.tenantEmail!)).limit(1);
    if (!byEmail) throw new OrderError("TENANT_NOT_FOUND", "Organização não encontrada.", 404);
    tenantId = byEmail.tenantId;
    jti = randomUUID();
  }

  // Tabelas globais: SEM withTenant.
  const [org] = await lookupDb.select().from(organizations).where(eq(organizations.id, tenantId)).limit(1);
  if (!org) throw new OrderError("TENANT_NOT_FOUND", "Organização não encontrada.", 404);

  const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan || !plan.active || plan.isFree) {
    throw new OrderError("PLAN_NOT_FOUND", "Plano não encontrado.", 404);
  }

  let inserted;
  try {
    [inserted] = await db.insert(orders).values({
      tenantId,
      planId: plan.id,
      paymentMethod: input.paymentMethod,
      phone: input.phone,
      contactEmail: input.contactEmail,
      checkoutJti: jti,
    }).returning();
  } catch (err) {
    if ((err as any)?.code === "23505" || /duplicate key/i.test(String(err))) {
      throw new OrderError("TOKEN_USED", "Este token de checkout já foi utilizado.", 409);
    }
    throw err;
  }

  // Inline como enqueueInviteEmail: falha de email nunca invalida o pedido criado.
  try {
    await sendOrderReceivedEmail(process.env.PROVIDER_NOTIFY_EMAIL || "provedor@docid.local", {
      id: inserted.id,
      tenantName: org.name,
      planName: plan.name,
      paymentMethod: inserted.paymentMethod,
      phone: inserted.phone,
      contactEmail: inserted.contactEmail,
      status: inserted.status,
    });
  } catch (err) {
    logger.warn({ err, orderId: inserted.id }, "[ORDERS] Falha ao notificar a provedora por email.");
  }

  return { orderId: inserted.id, status: "pending" };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SUBSCRIPTION_DAYS = 365;

/** A aprovação do pedido emite uma licença anual com os limites do plano aprovado. */
export function licenseInputFromOrder(
  order: { tenantId: string; planId: string },
  plan: { maxUsers: number },
  decidedAt: Date,
  providerUserId: string,
) {
  return {
    tenantId: order.tenantId,
    planId: order.planId,
    maxUsers: plan.maxUsers,
    status: "active" as const,
    validUntil: new Date(decidedAt.getTime() + SUBSCRIPTION_DAYS * DAY_MS),
    providerUserId,
  };
}

async function pendingOrderWithNames(orderId: string) {
  // Join com organizations: RLS esconde-as no pool normal (ver lookupDb).
  const [row] = await lookupDb.select({
    order: orders,
    tenantName: organizations.name,
    planName: plans.name,
  }).from(orders)
    .innerJoin(organizations, eq(orders.tenantId, organizations.id))
    .innerJoin(plans, eq(orders.planId, plans.id))
    .where(eq(orders.id, orderId)).limit(1);
  if (!row) throw new OrderError("ORDER_NOT_FOUND", "Pedido não encontrado.", 404);
  if (row.order.status !== "pending") {
    throw new OrderError("ORDER_NOT_PENDING", "Este pedido já foi decidido.", 409);
  }
  return row;
}

export async function approveOrder(
  orderId: string,
  providerUserId: string,
  ip?: string | null,
): Promise<{ orderId: string; status: "approved" }> {
  const { order, tenantName, planName } = await pendingOrderWithNames(orderId);
  const decidedAt = new Date();
  const expiresAt = new Date(decidedAt.getTime() + SUBSCRIPTION_DAYS * DAY_MS);

  await withTenant(order.tenantId, async (tx) => {
    const [updated] = await tx.update(orders).set({
      status: "approved", decidedAt, decidedBy: providerUserId,
    }).where(and(eq(orders.id, orderId), eq(orders.status, "pending"))).returning();
    if (!updated) throw new OrderError("ORDER_NOT_PENDING", "Este pedido já foi decidido.", 409);

    const [approvedPlan] = await tx.select().from(plans).where(eq(plans.id, order.planId)).limit(1);
    if (!approvedPlan) throw new OrderError("PLAN_NOT_FOUND", "Plano do pedido não encontrado.", 404);

    const license = await issueLicense(tx, licenseInputFromOrder(order, approvedPlan, decidedAt, providerUserId));

    await tx.update(organizations).set({
      planId: order.planId,
      subscriptionStatus: "paid",
      subscriptionExpiresAt: license.validUntil ?? expiresAt,
    }).where(eq(organizations.id, order.tenantId));

    // Verificação runtime: confirma a ativação antes de notificar o cliente.
    const ctx = await getSubscriptionContext(order.tenantId, tx);
    if (ctx.org.subscriptionStatus !== "paid" || ctx.org.planId !== order.planId) {
      throw new OrderError(
        "ACTIVATION_VERIFICATION_FAILED",
        "Não foi possível confirmar a ativação da subscrição.",
        500,
      );
    }

    await tx.insert(auditLogs).values({
      tenantId: order.tenantId,
      userId: null,
      action: "subscription.approve",
      resource: "orders",
      resourceId: order.id,
      metadata: JSON.stringify({ providerUserId }),
      ip: ip ?? null,
    });
  });

  const contact = await getTenantContactEmail(order.tenantId);
  if (contact) {
    try {
      await sendSubscriptionActiveEmail(contact, { tenantName, planName, expiresAt });
    } catch (err) {
      logger.warn({ err, orderId }, "[ORDERS] Falha ao notificar a ativação por email.");
    }
  }
  return { orderId, status: "approved" };
}

export async function rejectOrder(
  orderId: string,
  providerUserId: string,
  reason: string,
  ip?: string | null,
): Promise<{ orderId: string; status: "rejected" }> {
  if (!reason?.trim()) {
    throw new OrderError("REASON_REQUIRED", "Indique o motivo da rejeição.", 400);
  }
  const { order, tenantName, planName } = await pendingOrderWithNames(orderId);

  await withTenant(order.tenantId, async (tx) => {
    const [updated] = await tx.update(orders).set({
      status: "rejected",
      rejectReason: reason,
      decidedAt: new Date(),
      decidedBy: providerUserId,
    }).where(and(eq(orders.id, orderId), eq(orders.status, "pending"))).returning();
    if (!updated) throw new OrderError("ORDER_NOT_PENDING", "Este pedido já foi decidido.", 409);

    await tx.insert(auditLogs).values({
      tenantId: order.tenantId,
      userId: null,
      action: "subscription.reject",
      resource: "orders",
      resourceId: order.id,
      metadata: JSON.stringify({ providerUserId }),
      ip: ip ?? null,
    });
  });

  if (order.contactEmail) {
    try {
      await sendOrderRejectedEmail(order.contactEmail, { tenantName, planName, reason });
    } catch (err) {
      logger.warn({ err, orderId }, "[ORDERS] Falha ao notificar a rejeição por email.");
    }
  }
  return { orderId, status: "rejected" };
}
