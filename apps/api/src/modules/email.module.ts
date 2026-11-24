import fs from "node:fs";
import Elysia from "elysia";
import { Type as t } from "@sinclair/typebox";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "../db/withTenant";
import { auditLogs, emailLogs, organizations, tenantEmailSettings, users } from "../db/schema";
import { getFreshRoles, requireRole, type AuthPayload } from "../middleware/auth";
import { checkRateLimit } from "../middleware/rateLimit";
import { getClientIp } from "../lib/ip";
import { safeError } from "../lib/errors";
import { encryptSecret, isSecretBoxConfigured } from "../lib/secret-box";
import { verifyDownloadToken } from "../lib/signed-link";
import { resolveSafeSmtpHost, SmtpHostError } from "../lib/smtp-guard";
import { downloadDocument } from "../services/attachment.service";
import { fallbackMode, resolveSender } from "../services/email/tenant-email.service";
import { renderTestEmail } from "../services/email/templates";
import { cleanDisplayName, formatAddress, isValidEmail, sendEmail } from "../services/email/transport";

type Settings = typeof tenantEmailSettings.$inferSelect;

/** Nunca devolver o segredo: só se existe. */
function publicSettings(s: Settings | undefined) {
  if (!s) return null;
  const { secretEncrypted, ...rest } = s;
  return { ...rest, hasSecret: Boolean(secretEncrypted) };
}

const settingsBody = t.Object({
  provider: t.Union([t.Literal("smtp"), t.Literal("resend"), t.Literal("sendgrid")]),
  fromEmail: t.String({ maxLength: 254 }),
  fromName: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
  replyTo: t.Optional(t.Union([t.String({ maxLength: 254 }), t.Null()])),
  smtpHost: t.Optional(t.Union([t.String({ maxLength: 253 }), t.Null()])),
  smtpPort: t.Optional(t.Union([t.Integer(), t.Null()])),
  smtpSecurity: t.Optional(t.Union([t.Literal("ssl"), t.Literal("starttls"), t.Literal("none"), t.Null()])),
  smtpUser: t.Optional(t.Union([t.String({ maxLength: 254 }), t.Null()])),
  /** Password SMTP ou chave de API. Omitir para manter o segredo já guardado. */
  secret: t.Optional(t.String({ maxLength: 2048 })),
  enabled: t.Optional(t.Boolean()),
});

const fail = (set: any, status: number, code: string, message: string) => {
  set.status = status;
  return { error: { code, message } };
};

/* ─────────────── Configuração e histórico (só ORG_ADMIN do próprio tenant) ─────────────── */

export const emailModule = new (Elysia as any)({ prefix: "/email" })
  .use(requireRole("ORG_ADMIN"))

  .get("/settings", async ({ tenantId }: any) => {
    const row = await withTenant(tenantId, (tx) =>
      tx.query.tenantEmailSettings.findFirst({ where: eq(tenantEmailSettings.tenantId, tenantId) }));
    return {
      data: {
        settings: publicSettings(row),
        fallbackMode: fallbackMode(),
        platformFallbackAvailable: Boolean(process.env.SMTP_HOST),
      },
    };
  }, { detail: { summary: "Configuração de e-mail da organização", tags: ["E-mail"] } })

  .put("/settings", async ({ tenantId, auth, body, set, request }: any) => {
    if (!isValidEmail(body.fromEmail)) return fail(set, 422, "VALIDATION_ERROR", "E-mail do remetente inválido.");
    if (body.replyTo && !isValidEmail(body.replyTo)) return fail(set, 422, "VALIDATION_ERROR", "E-mail de resposta inválido.");

    if (body.provider === "smtp") {
      if (!body.smtpHost || !body.smtpPort || !body.smtpSecurity) {
        return fail(set, 422, "VALIDATION_ERROR", "SMTP exige host, porta e segurança (ssl, starttls ou none).");
      }
      try {
        await resolveSafeSmtpHost(body.smtpHost, body.smtpPort);
      } catch (err: any) {
        return fail(set, 422, "SMTP_HOST_REJECTED", err instanceof SmtpHostError ? err.message : "Host SMTP inválido.");
      }
    }
    if (body.secret !== undefined && !isSecretBoxConfigured()) {
      return fail(set, 500, "SECRETS_KEY_MISSING", "O servidor não tem EMAIL_SECRETS_KEY configurada; não é possível guardar credenciais.");
    }

    try {
      return await withTenant(tenantId, async (tx) => {
        const existing = await tx.query.tenantEmailSettings.findFirst({ where: eq(tenantEmailSettings.tenantId, tenantId) });
        const providerChanged = existing && existing.provider !== body.provider;
        let secretEncrypted = existing?.secretEncrypted ?? null;
        if (body.secret !== undefined) {
          secretEncrypted = body.secret ? encryptSecret(body.secret, tenantId) : null;
        } else if (providerChanged) {
          // Não reaproveitar uma password SMTP como chave de API (ou vice-versa).
          secretEncrypted = null;
        }
        if (body.provider !== "smtp" && !secretEncrypted) {
          return fail(set, 422, "VALIDATION_ERROR", "Indique a chave de API do fornecedor.");
        }

        const values = {
          tenantId,
          provider: body.provider,
          fromEmail: body.fromEmail.trim(),
          fromName: body.fromName ? cleanDisplayName(body.fromName) : null,
          replyTo: body.replyTo?.trim() || null,
          smtpHost: body.provider === "smtp" ? body.smtpHost.trim() : null,
          smtpPort: body.provider === "smtp" ? body.smtpPort : null,
          smtpSecurity: body.provider === "smtp" ? body.smtpSecurity : null,
          smtpUser: body.provider === "smtp" ? (body.smtpUser?.trim() || null) : null,
          secretEncrypted,
          enabled: body.enabled ?? existing?.enabled ?? true,
          verifiedAt: null, // qualquer alteração exige novo teste
          updatedBy: auth.userId,
          updatedAt: new Date(),
        };
        const [saved] = await tx.insert(tenantEmailSettings).values(values)
          .onConflictDoUpdate({ target: tenantEmailSettings.tenantId, set: values })
          .returning();

        await tx.insert(auditLogs).values({
          tenantId, userId: auth.userId, action: "EMAIL_SETTINGS_UPDATED", resource: "tenant_email_settings",
          resourceId: tenantId, ip: getClientIp(request),
          metadata: JSON.stringify({ provider: body.provider, fromEmail: values.fromEmail, secretChanged: body.secret !== undefined }),
        });
        return { data: publicSettings(saved) };
      });
    } catch (err: any) {
      return fail(set, 400, "EMAIL_SETTINGS_ERROR", safeError(err));
    }
  }, { body: settingsBody, detail: { summary: "Guardar configuração de e-mail", tags: ["E-mail"] } })

  .delete("/settings", async ({ tenantId, auth, request }: any) => {
    await withTenant(tenantId, async (tx) => {
      await tx.delete(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, tenantId));
      await tx.insert(auditLogs).values({
        tenantId, userId: auth.userId, action: "EMAIL_SETTINGS_DELETED", resource: "tenant_email_settings",
        resourceId: tenantId, ip: getClientIp(request),
      });
    });
    return { data: { deleted: true, fallbackMode: fallbackMode() } };
  }, { detail: { summary: "Remover configuração (volta ao e-mail da plataforma)", tags: ["E-mail"] } })

  .post("/settings/test", async ({ tenantId, auth, body, set }: any) => {
    if (!isValidEmail(body.to)) return fail(set, 422, "VALIDATION_ERROR", "Destinatário inválido.");
    if (!(await checkRateLimit(`email-test:${tenantId}`, 5, 10 * 60_000))) {
      return fail(set, 429, "RATE_LIMITED", "Demasiados testes. Tente novamente dentro de alguns minutos.");
    }
    const prep = await withTenant(tenantId, async (tx) => {
      const org = await tx.query.organizations.findFirst({ where: eq(organizations.id, tenantId) });
      return { resolution: await resolveSender(tx, tenantId), tenantName: org?.name ?? "DocID" };
    });
    const res0 = prep.resolution;
    if (res0.ok === false) return fail(set, 422, res0.reason, res0.message);
    const sender = res0.sender;
    const senderLabel = formatAddress(sender.fromName, sender.fromEmail);
    const rendered = renderTestEmail({ tenantName: prep.tenantName, sender: senderLabel });

    let error: string | null = null;
    let messageId: string | null = null;
    try {
      messageId = await sendEmail(sender, { ...rendered, to: body.to });
    } catch (err: any) {
      error = String(err?.message ?? err).slice(0, 1000);
    }

    await withTenant(tenantId, async (tx) => {
      const now = new Date();
      await tx.insert(emailLogs).values({
        tenantId, eventType: "test", recipientEmail: body.to, recipientUserId: auth.userId,
        subject: rendered.subject, status: error ? "failed" : "sent", attempts: 1,
        provider: `${sender.source}:${sender.provider}`, sender: senderLabel, messageId,
        lastError: error, sentAt: error ? null : now,
      });
      if (sender.source === "tenant") {
        await tx.update(tenantEmailSettings).set({
          lastTestAt: now, lastTestError: error, ...(error ? {} : { verifiedAt: now }),
        }).where(eq(tenantEmailSettings.tenantId, tenantId));
      }
    });

    if (error) return fail(set, 502, "EMAIL_TEST_FAILED", error);
    return { data: { sent: true, sender: senderLabel, source: sender.source } };
  }, {
    body: t.Object({ to: t.String({ maxLength: 254 }) }),
    detail: { summary: "Enviar e-mail de teste com a configuração actual", tags: ["E-mail"] },
  })

  .get("/logs", async ({ tenantId, query }: any) => {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    return withTenant(tenantId, async (tx) => {
      const conds = [eq(emailLogs.tenantId, tenantId)];
      if (query.status) conds.push(eq(emailLogs.status, query.status));
      if (query.eventType) conds.push(eq(emailLogs.eventType, query.eventType));
      const where = and(...conds);
      // template_data fica de fora: o histórico não precisa do conteúdo dos e-mails.
      const rows = await tx.select({
        id: emailLogs.id, eventType: emailLogs.eventType, recipientEmail: emailLogs.recipientEmail,
        recipientUserId: emailLogs.recipientUserId, documentId: emailLogs.documentId, subject: emailLogs.subject,
        status: emailLogs.status, attempts: emailLogs.attempts, maxAttempts: emailLogs.maxAttempts,
        nextAttemptAt: emailLogs.nextAttemptAt, provider: emailLogs.provider, sender: emailLogs.sender,
        lastError: emailLogs.lastError, createdAt: emailLogs.createdAt, sentAt: emailLogs.sentAt,
      }).from(emailLogs).where(where).orderBy(desc(emailLogs.createdAt)).limit(limit).offset((page - 1) * limit);
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(emailLogs).where(where);
      return { data: rows, meta: { total, page, limit } };
    });
  }, {
    query: t.Object({
      page: t.Optional(t.String()), limit: t.Optional(t.String()),
      status: t.Optional(t.Union([t.Literal("queued"), t.Literal("sending"), t.Literal("sent"), t.Literal("failed"), t.Literal("skipped")])),
      eventType: t.Optional(t.Union([t.Literal("document_approved"), t.Literal("document_shared"), t.Literal("test")])),
    }),
    detail: { summary: "Histórico de envios de e-mail", tags: ["E-mail"] },
  })

  .post("/logs/:id/retry", async ({ tenantId, params, set }: any) => {
    const [row] = await withTenant(tenantId, (tx) => tx.update(emailLogs)
      .set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(emailLogs.id, params.id), eq(emailLogs.tenantId, tenantId),
        inArray(emailLogs.status, ["failed", "skipped"]), sql`${emailLogs.eventType} <> 'test'`))
      .returning({ id: emailLogs.id }));
    if (!row) return fail(set, 404, "NOT_FOUND", "E-mail não encontrado ou não pode ser reenviado.");
    return { data: { id: row.id, status: "queued" } };
  }, {
    params: t.Object({ id: t.String({ format: "uuid" }) }),
    detail: { summary: "Voltar a pôr na fila um e-mail falhado", tags: ["E-mail"] },
  });

/* ─────────────────────── Link de download dos e-mails (público, assinado) ─────────────────────── */

function htmlPage(title: string, message: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f3f4f6;margin:0;padding:48px 16px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px;">
<h1 style="font-size:18px;margin:0 0 12px;color:#1f2937;">${esc(title)}</h1><p style="margin:0;color:#4b5563;line-height:1.6;">${esc(message)}</p></div></body></html>`;
}

export const emailLinksModule = new (Elysia as any)({ prefix: "/email-links" })
  .get("/download", async ({ query, set, request }: any) => {
    const ip = getClientIp(request);
    const page = (status: number, title: string, msg: string) => {
      set.status = status;
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return htmlPage(title, msg);
    };
    if (!(await checkRateLimit(`email-link:${ip}`, 30, 60_000))) {
      return page(429, "Demasiados pedidos", "Aguarde um minuto e tente novamente.");
    }
    const claims = typeof query.token === "string" ? verifyDownloadToken(query.token) : null;
    if (!claims) return page(410, "Link inválido ou expirado", "Peça ao remetente para voltar a partilhar o documento, ou abra-o na aplicação DocID.");

    try {
      const result = await withTenant(claims.t, async (tx) => {
        const user = await tx.query.users.findFirst({ where: and(eq(users.id, claims.u), eq(users.tenantId, claims.t)) });
        if (!user || !user.isActive) return { error: "USER" as const };
        // O acesso é verificado de novo agora: se a partilha foi revogada, o link deixa de funcionar.
        const auth: AuthPayload = {
          userId: user.id, tenantId: claims.t, sectorId: user.sectorId,
          roles: await getFreshRoles(user.id, claims.t, tx),
        };
        const r = await downloadDocument(tx, auth, claims.d);
        if (!("error" in r)) {
          await tx.insert(auditLogs).values({
            tenantId: claims.t, userId: user.id, action: "DOWNLOAD_EMAIL_LINK", resource: "documents",
            resourceId: claims.d, ip,
          });
        }
        return r;
      });
      if ("error" in result) {
        return page(403, "Sem acesso a este documento", "O link já não é válido para a sua conta. Abra a aplicação DocID ou peça acesso ao responsável.");
      }
      const asciiName = result.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
      set.headers["Content-Disposition"] = `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`;
      set.headers["Content-Type"] = "application/octet-stream";
      set.headers["Cache-Control"] = "no-store";
      set.headers["Referrer-Policy"] = "no-referrer";
      return fs.readFileSync(result.filePath);
    } catch (err) {
      return page(500, "Erro", "Não foi possível obter o documento. Tente mais tarde.");
    }
  }, {
    query: t.Object({ token: t.Optional(t.String({ maxLength: 2048 })) }),
    detail: { summary: "Download por link assinado enviado por e-mail", tags: ["E-mail"] },
  });
