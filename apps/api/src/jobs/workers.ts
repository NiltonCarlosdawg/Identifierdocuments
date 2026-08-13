import { Worker } from "bullmq";
import { getBullConnection } from "./connection";
import type { EmailJobData, ThumbnailJobData } from "./queues";
import { sendInviteEmail, sendResetPasswordEmail } from "../services/mailer.service";
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

  new Worker<EmailJobData>(
    "docid-email",
    async (job) => {
      const data = job.data;
      if (data.type === "invite") {
        await sendInviteEmail(data.to, data.fullName, data.orgName, data.password);
        return;
      }
      await sendResetPasswordEmail(data.to, data.token);
    },
    { connection, concurrency: 2 },
  ).on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "[BULLMQ] email job falhou");
  });

  new Worker<ThumbnailJobData>(
    "docid-thumbnail",
    async (job) => {
      await runThumbnailJob(job.data.filePath, job.data.docId);
    },
    { connection, concurrency: 1 },
  ).on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "[BULLMQ] thumbnail job falhou");
  });

  logger.info("[BULLMQ] Workers email + thumbnail activos");
}
