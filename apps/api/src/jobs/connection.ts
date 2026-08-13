import { Redis } from "ioredis";

const IS_TEST = process.env.NODE_ENV === "test";

let connection: Redis | null = null;
let unavailable = false;

/** Ligação dedicada ao BullMQ (maxRetriesPerRequest: null é obrigatório). */
export function getBullConnection(): Redis | null {
  if (IS_TEST || process.env.BULLMQ_ENABLED === "false") return null;
  if (unavailable) return null;
  if (!connection) {
    try {
      const password = process.env.REDIS_PASSWORD;
      connection = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
        lazyConnect: true,
        ...(password ? { password } : {}),
      });
      connection.connect().catch((err) => {
        console.warn("[BULLMQ] Ligação Redis falhou — filas desactivadas:", (err as Error)?.message ?? err);
        connection = null;
        unavailable = true;
      });
    } catch (err) {
      console.warn("[BULLMQ] Ligação Redis falhou — filas desactivadas:", (err as Error)?.message ?? err);
      unavailable = true;
      return null;
    }
  }
  return connection;
}
