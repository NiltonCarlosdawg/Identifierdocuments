import { Queue } from "bullmq";
import { getBullConnection } from "./connection";
import { sendInviteEmail, sendResetPasswordEmail } from "../services/mailer.service";
import { logger } from "../lib/logger";

export type EmailJobData =
  | { type: "invite"; to: string; fullName: string; orgName: string; password: string }
  | { type: "reset"; to: string; token: string };

export type ThumbnailJobData = { filePath: string; docId: string };

let emailQueue: Queue<EmailJobData> | null = null;
let thumbnailQueue: Queue<ThumbnailJobData> | null = null;

function getEmailQueue(): Queue<EmailJobData> | null {
  const conn = getBullConnection();
  if (!conn) return null;
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>("docid-email", { connection: conn });
  }
  return emailQueue;
}

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

/** Enfileira email de convite; fallback síncrono se Redis/BullMQ indisponível. */
export async function enqueueInviteEmail(
  to: string,
  fullName: string,
  orgName: string,
  password: string,
): Promise<boolean> {
  const q = getEmailQueue();
  if (!q) return sendInviteEmail(to, fullName, orgName, password);
  try {
    await q.add("invite", { type: "invite", to, fullName, orgName, password }, defaultJobOpts);
    return true;
  } catch (err) {
    logger.warn({ err }, "[BULLMQ] enqueue invite falhou — envio directo");
    return sendInviteEmail(to, fullName, orgName, password);
  }
}

/** Enfileira email de reset; fallback síncrono se Redis/BullMQ indisponível. */
export async function enqueueResetPasswordEmail(to: string, token: string): Promise<void> {
  const q = getEmailQueue();
  if (!q) {
    await sendResetPasswordEmail(to, token);
    return;
  }
  try {
    await q.add("reset", { type: "reset", to, token }, defaultJobOpts);
  } catch (err) {
    logger.warn({ err }, "[BULLMQ] enqueue reset falhou — envio directo");
    await sendResetPasswordEmail(to, token);
  }
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
