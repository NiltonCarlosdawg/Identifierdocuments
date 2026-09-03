import type { DB } from "../db";
import { idempotencyRecords } from "../db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Helper para garantir idempotência em operações de escrita.
 * Se a chave já existir, devolve o resultado guardado.
 * Senão, executa a função e guarda o resultado.
 */
export async function withIdempotency<T>(
  tx: DB,
  tenantId: string,
  idempotencyKey: string | undefined | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) return fn();

  // 1. Verificar se já existe
  const existing = await tx.query.idempotencyRecords.findFirst({
    where: and(
      eq(idempotencyRecords.tenantId, tenantId),
      eq(idempotencyRecords.idempotencyKey, idempotencyKey)
    ),
  });

  if (existing) {
    return existing.result as T;
  }

  // 2. Executar a operação
  const result = await fn();

  // 3. Guardar o resultado (ignora conflitos em caso de corrida, o primeiro vence)
  await tx.insert(idempotencyRecords).values({
    tenantId,
    idempotencyKey,
    result: result as any,
  }).onConflictDoNothing();

  return result;
}
