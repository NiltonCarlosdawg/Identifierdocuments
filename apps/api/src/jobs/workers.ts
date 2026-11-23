import { Queue, Worker } from "bullmq";
import { getBullConnection } from "./connection";
import type { ThumbnailJobData } from "./queues";
import { runThumbnailJob } from "../services/attachment.service";
import { runRenewalSweep } from "./subscription-reminders";
import { logger } from "../lib/logger";

let started = false;

export async function startWorkers(): Promise<void> {
  if (started) return;
  const connection = getBullConnection();
  if (!connection) {
    logger.info("[BULLMQ] Workers não arrancados (Redis indisponível ou BULLMQ_ENABLED=false)");
    return;
  }

  started = true;

  // Emails com secrets não usam fila — apenas thumbnails e o sweep (sem secrets).
  new Worker<ThumbnailJobData>(
    "docid-thumbnail",
    async (job) => {
      await runThumbnailJob(job.data.filePath, job.data.docId);
    },
    { connection, concurrency: 1 },
  ).on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "[BULLMQ] thumbnail job falhou");
  });

  logger.info("[BULLMQ] Worker thumbnail activo");

  // Sweep diário às 08:00 UTC; sem contexto de tenant (cross-tenant).
  const remindersQueue = new Queue("docid-subscription", { connection });
  await remindersQueue.upsertJobScheduler(
    "subscription-renewal-daily",
    { pattern: "0 8 * * *", tz: "UTC" },
    { name: "renewal-sweep" },
  );

  new Worker(
    "docid-subscription",
    async () => {
      await runRenewalSweep(new Date());
    },
    { connection, concurrency: 1 },
  ).on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "[BULLMQ] sweep de subscrições falhou");
  });

  logger.info("[BULLMQ] Worker de subscrições activo (08:00 UTC)");
}
