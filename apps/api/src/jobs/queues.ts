import { Queue } from "bullmq";
import { getBullConnection } from "./connection";
import { sendInviteEmail, sendResetPasswordEmail } from "../services/mailer.service";
import { logger } from "../lib/logger";

/** Só thumbnails na fila — passwords/tokens de email nunca vão para o Redis. */
export type ThumbnailJobData = { filePath: string; docId: string };

let thumbnailQueue: Queue<ThumbnailJobData> | null = null;

function getThumbnailQueue(): Queue<ThumbnailJobData> | null {
  const conn = getBullConnection();
  if (!conn) return null;
  if (!thumbnailQueue) {
    thumbnailQueue = new Queue<ThumbnailJobData>("docid-thumbnail", { connection: conn });
  }
  return thumbnailQueue;
}

const defaultJobOpts = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 100,
  removeOnFail: 50,
};

/**
 * Envio directo (sem fila): a password temporária não deve persistir no Redis.
 * Devolve true se o email foi enviado via SMTP; false se caiu no fallback de log (dev).
 */
export async function enqueueInviteEmail(
  to: string,
  fullName: string,
  orgName: string,
  password: string,
): Promise<boolean> {
  return sendInviteEmail(to, fullName, orgName, password);
}

/** Envio directo (sem fila): o token de reset não deve persistir no Redis. */
export async function enqueueResetPasswordEmail(to: string, token: string): Promise<void> {
  await sendResetPasswordEmail(to, token);
}

/**
 * Tenta enfileirar thumbnail. Devolve true se enfileirou; false se o caller
 * deve gerar localmente (Redis/fila indisponível).
 */
export async function tryEnqueueThumbnail(filePath: string, docId: string): Promise<boolean> {
  const q = getThumbnailQueue();
  if (!q) return false;
  try {
    await q.add("thumbnail", { filePath, docId }, defaultJobOpts);
    return true;
  } catch (err) {
    logger.warn({ err, docId }, "[BULLMQ] enqueue thumbnail falhou");
    return false;
  }
}
