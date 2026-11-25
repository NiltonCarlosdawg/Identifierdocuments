import Elysia from "elysia";
import { logger } from "../lib/logger";
import { getTenantLicense, isBlockedWhenReadOnly, readOnlyMessage } from "../services/license-enforcement.service";

/**
 * Aplica o modo "só consulta" a pedidos autenticados de organizações com a licença
 * expirada (depois da tolerância) ou suspensa. Leituras passam sempre.
 * Registado como hook global, logo a seguir aos middlewares de auth e tenant.
 */
export const licenseGuard = new (Elysia as any)()
  .onBeforeHandle({ as: "global" }, async (ctx: any) => {
    if (!ctx.auth?.tenantId) return;
    const path = new URL(ctx.request.url).pathname;
    if (!isBlockedWhenReadOnly(ctx.request.method, path)) return;
    let info;
    try {
      info = await getTenantLicense(ctx.auth.tenantId);
    } catch (err) {
      // Falha a ler a licença: não bloquear o trabalho dos clientes por um erro nosso.
      logger.error({ err, tenantId: ctx.auth.tenantId }, "[LICENSE] falha a ler a licença; pedido permitido");
      return;
    }
    if (!info || info.canWrite) return;
    logger.warn({ tenantId: ctx.auth.tenantId, state: info.state, licenseNumber: info.licenseNumber }, "[LICENSE] escrita bloqueada");
    ctx.set.status = 403;
    return {
      error: {
        code: "LICENSE_READ_ONLY",
        message: readOnlyMessage(info),
        details: { state: info.state, licenseNumber: info.licenseNumber, validUntil: info.validUntil },
      },
    };
  });
