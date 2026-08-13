import { Worker } from "bullmq";
import { getBullConnection } from "./connection";
import type { ThumbnailJobData } from "./queues";
import { runThumbnailJob } from "../services/attachment.service";
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

  // Emails com secrets não usam fila — apenas thumbnails.
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
}
