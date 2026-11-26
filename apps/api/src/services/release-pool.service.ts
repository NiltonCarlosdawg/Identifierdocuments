import type { DB } from "../db";
import { identifierReleasePool, auditLogs } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import type { AuthPayload } from "../middleware/auth";

/**
 * Reaproveitamento de números devolvidos (`identifier_release_pool`).
 *
 * A numeração fiscal tem de ser sequencial E cronológica. Um fragmento devolvido
 * só pode voltar a ser usado se nenhum número mais alto já tiver sido emitido ou
 * estiver reservado num lote activo — senão sairia um número antigo depois de um
 * mais recente. A parte de um fragmento que já não é segura é anulada: sai do pool
 * e fica registada na auditoria (`SEQUENCE_VOIDED`) para justificar o buraco.
 *
 * Tem de ser chamada dentro do advisory lock (tenant, categoria) que protege a
 * alocação de sequências, para não correr ao mesmo tempo que outra alocação.
 */
export async function takeFromReleasePool(
  tx: DB,
  auth: AuthPayload,
  categoryId: string,
  maxCount: number,
  ip: string = "unknown",
): Promise<{ start: number; end: number } | null> {
  if (maxCount < 1) return null;

  const rows = (await tx.execute(sql`
    SELECT GREATEST(
      (SELECT COALESCE(MAX(sequence), 0) FROM identifiers
        WHERE tenant_id = ${auth.tenantId} AND category_id = ${categoryId}),
      (SELECT COALESCE(MAX(end_seq), 0) FROM identifier_leases
        WHERE tenant_id = ${auth.tenantId} AND category_id = ${categoryId} AND status = 'active'),
      (SELECT COALESCE(MAX(used_up_to), 0) FROM identifier_leases
        WHERE tenant_id = ${auth.tenantId} AND category_id = ${categoryId})
    ) AS threshold
  `)) as unknown as Array<{ threshold: string | number }>;
  const threshold = Number(rows[0]?.threshold ?? 0);

  const fragments = await tx.select().from(identifierReleasePool)
    .where(sql`${identifierReleasePool.tenantId} = ${auth.tenantId} AND ${identifierReleasePool.categoryId} = ${categoryId}`)
    .orderBy(identifierReleasePool.rangeStart);

  const usable: Array<typeof fragments[number]> = [];
  for (const f of fragments) {
    if (f.rangeStart > threshold) {
      usable.push(f);
      continue;
    }
    const voidEnd = Math.min(f.rangeEnd, threshold);
    await tx.insert(auditLogs).values({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "SEQUENCE_VOIDED",
      resource: "identifier_release_pool",
      resourceId: f.id,
      metadata: JSON.stringify({
        categoryId,
        rangeStart: f.rangeStart,
        rangeEnd: voidEnd,
        reason: "Números devolvidos não reutilizáveis: já foi emitido ou reservado um número mais alto.",
      }),
      ip,
    });
    if (voidEnd >= f.rangeEnd) {
      await tx.delete(identifierReleasePool).where(eq(identifierReleasePool.id, f.id));
    } else {
      await tx.update(identifierReleasePool).set({ rangeStart: voidEnd + 1 }).where(eq(identifierReleasePool.id, f.id));
      usable.push({ ...f, rangeStart: voidEnd + 1 });
    }
  }

  const first = usable[0];
  if (!first) return null;

  const end = Math.min(first.rangeEnd, first.rangeStart + maxCount - 1);
  if (end >= first.rangeEnd) {
    await tx.delete(identifierReleasePool).where(eq(identifierReleasePool.id, first.id));
  } else {
    await tx.update(identifierReleasePool).set({ rangeStart: end + 1 }).where(eq(identifierReleasePool.id, first.id));
  }
  return { start: first.rangeStart, end };
}
