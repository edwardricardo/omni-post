/**
 * @file autoRenewalWorker.ts
 * @description BullMQ worker that processes auto-renewals for expired trial accounts.
 *              Runs as a daily cron job. Finds accounts where isOnTrial=true,
 *              autoRenewal=true, and trialEndDate has passed, then converts them
 *              to paid subscriptions.
 * @layer infrastructure
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import { Worker, Queue } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import { prisma } from "@infra/prisma";
import { registerGracefulShutdown } from "./lib/gracefulShutdown.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "auto-renewal-worker" });

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  // ioredis defaults: commandTimeout = null (forever), connectTimeout = 10000.
  // Both bounded so a hung Redis fails fast instead of stalling the daily
  // cron. BullMQ requires maxRetriesPerRequest:null, so the timeout is the
  // only escape hatch.
  commandTimeout: 5_000,
  connectTimeout: 5_000,
});

// ---------------------------------------------------------------------------
// Cron scheduler — enqueues the job daily at 2:00 AM UTC
// ---------------------------------------------------------------------------

const queue = new Queue(QUEUE_NAMES.AUTO_RENEWAL, { connection });

async function setupCron() {
  // Remove any existing repeatable jobs to avoid duplicates on restart
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    "process-auto-renewals",
    {},
    {
      repeat: { pattern: "0 2 * * *" }, // Every day at 2:00 AM UTC
      removeOnComplete: { count: 30 }, // Keep last 30 completed
      removeOnFail: { count: 30 },
    }
  );

  logger.info("Auto-renewal cron scheduled: daily at 2:00 AM UTC");
}

// ---------------------------------------------------------------------------
// Worker — processes the auto-renewal job
// ---------------------------------------------------------------------------

const worker = new Worker(
  QUEUE_NAMES.AUTO_RENEWAL,
  async (_job) => {
    const startTime = Date.now();
    logger.info("Starting auto-renewal processing...");

    const now = new Date();

    // Find accounts with expired trials and auto-renewal enabled
    const expiredTrialAccounts = await prisma.account.findMany({
      where: {
        isOnTrial: true,
        autoRenewal: true,
        trialEndDate: { lte: now },
      },
    });

    if (expiredTrialAccounts.length === 0) {
      logger.info("No accounts eligible for auto-renewal");
      return { processed: 0, failed: 0 };
    }

    logger.info({ count: expiredTrialAccounts.length }, "Found accounts for auto-renewal");

    let processed = 0;
    let failed = 0;

    for (const account of expiredTrialAccounts) {
      try {
        // Get subscription info for billing calculation
        const subscription = await prisma.accountSubscription.findUnique({
          where: { accountId: account.id },
        });

        const pricePerMonth = subscription ? Number(subscription.pricePerMonth) : 0;
        const cycle = account.billingCycle as "monthly" | "yearly";
        const nextBilling = new Date(now);
        if (cycle === "yearly") {
          nextBilling.setFullYear(nextBilling.getFullYear() + 1);
        } else {
          nextBilling.setMonth(nextBilling.getMonth() + 1);
        }

        // Convert trial to paid
        await prisma.account.update({
          where: { id: account.id },
          data: {
            isOnTrial: false,
            lastBillingDate: now,
            nextBillingDate: nextBilling,
          },
        });

        // Create audit log
        await prisma.auditLog.create({
          data: {
            action: "AUTO_RENEWAL",
            resource: "Account",
            resourceId: account.id,
            details: {
              email: account.email,
              amount: pricePerMonth,
              billingCycle: cycle,
              nextBillingDate: nextBilling.toISOString(),
              previousTrialEndDate: account.trialEndDate?.toISOString(),
            },
            success: true,
          },
        });

        processed++;
        logger.info({ accountId: account.id, email: account.email }, "Auto-renewal processed");
      } catch (error) {
        failed++;
        logger.error({ err: error, accountId: account.id }, "Auto-renewal failed for account");
      }
    }

    const duration = Date.now() - startTime;
    logger.info({ processed, failed, durationMs: duration }, "Auto-renewal batch complete");

    return { processed, failed };
  },
  {
    connection,
    concurrency: 1,
    // Auto-renewal hits Stripe / Paddle APIs sequentially; lockDuration of
    // 60 s gives the job room to finish without stalled detection re-picking
    // it mid-flight. stalledInterval halved for second-tick detection.
    lockDuration: 60_000,
    stalledInterval: 30_000,
    drainDelay: 5,
  }
);

worker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, result }, "Auto-renewal job completed");
});

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "Auto-renewal job failed");
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

setupCron().catch((err) => {
  logger.error({ err }, "Failed to setup auto-renewal cron");
});

logger.info("Auto-renewal worker started");

// Graceful shutdown — handles both SIGTERM (Kubernetes/CI deploy) and SIGINT
// (Ctrl+C in dev). Uses the shared helper so the lifecycle (worker.close →
// queue.close → connection.quit → prisma.$disconnect) is identical across
// every worker process.
registerGracefulShutdown({
  name: "auto-renewal",
  target: { workers: [worker], queues: [queue], connections: [connection], prisma },
  logger,
});
