import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, orders, plans, users } from "../db/schema";
import { logger } from "../lib/logger";
import { sendOrderReceivedEmail } from "./mailer.service";

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
    const [bySlug] = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.slug, input.tenantSlug)).limit(1);
    if (!bySlug) throw new OrderError("TENANT_NOT_FOUND", "Organização não encontrada.", 404);
    tenantId = bySlug.id;
    jti = randomUUID();
  } else {
    const [byEmail] = await db.select({ tenantId: users.tenantId }).from(users)
      .where(eq(users.email, input.tenantEmail!)).limit(1);
    if (!byEmail) throw new OrderError("TENANT_NOT_FOUND", "Organização não encontrada.", 404);
    tenantId = byEmail.tenantId;
    jti = randomUUID();
  }

  // Tabelas globais: SEM withTenant.
  const [org] = await db.select().from(organizations).where(eq(organizations.id, tenantId)).limit(1);
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
