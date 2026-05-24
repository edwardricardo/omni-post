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
import type { PrismaClient } from "@infra/prisma";
import { workerPrisma, verifyDatabaseAuth } from "./container/workerContainer.js";
import { registerGracefulShutdown, type ShutdownTarget } from "./lib/gracefulShutdown.js";
import { upsertAutoRenewalSchedule } from "./autoRenewalScheduler.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "auto-renewal-worker" });

export interface StartAutoRenewalWorkerOptions {
  /** Injected PrismaClient (from the workers composition root). */
  prisma: PrismaClient;
  /**
   * When false, callers must register their own graceful-shutdown handler
   * (typical for composed bootstrap that drains multiple workers as a unit).
   * Default true: the worker registers its own SIGTERM / SIGINT handler.
   */
  registerShutdown?: boolean;
}

/**
 * @function startAutoRenewalWorker
 * @description Boots the auto-renewal BullMQ worker, its Redis connection, and
 *   upserts the daily 02:00 UTC job scheduler.
 * @returns ShutdownTarget so a composer can drain it.
 */
export async function startAutoRenewalWorker(
  options: StartAutoRenewalWorkerOptions
): Promise<ShutdownTarget> {
  // Fail fast if DATABASE_URL credentials don't authenticate (typically a
  // stale Postgres volume after a password rotation without `down -v`).
  await verifyDatabaseAuth();

  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    // No commandTimeout: BullMQ Worker uses blocking commands (BZPOPMIN,
    // XREAD BLOCK) that legitimately wait indefinitely for jobs. Any
    // commandTimeout interrupts those polls mid-flight and surfaces as
    // spurious "Command timed out" errors (BullMQ issue #2619). Worker
    // liveness is enforced via lockDuration + stalledInterval (BullMQ-side)
    // and TCP keepAlive (transport-side).
    connectTimeout: 10_000,
    keepAlive: 30_000,
  });

  const queue = new Queue(QUEUE_NAMES.AUTO_RENEWAL, { connection });

  const worker = new Worker(
    QUEUE_NAMES.AUTO_RENEWAL,
    async (_job) => {
      const startTime = Date.now();
      logger.info("Starting auto-renewal processing...");

      const now = new Date();

      // Find accounts with expired trials and auto-renewal enabled
      const expiredTrialAccounts = await options.prisma.account.findMany({
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
          const subscription = await options.prisma.accountSubscription.findUnique({
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
          await options.prisma.account.update({
            where: { id: account.id },
            data: {
              isOnTrial: false,
              lastBillingDate: now,
              nextBillingDate: nextBilling,
            },
          });

          // Create audit log
          await options.prisma.auditLog.create({
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

  // Recurring schedule — daily at 02:00 UTC via the BullMQ Job Scheduler.
  await upsertAutoRenewalSchedule(queue);
  logger.info("Auto-renewal scheduler upserted: daily at 02:00 UTC");

  const target: ShutdownTarget = {
    workers: [worker],
    queues: [queue],
    connections: [connection],
    prisma: options.prisma,
  };

  if (options.registerShutdown !== false) {
    registerGracefulShutdown({ name: "auto-renewal", target, logger });
  }

  logger.info("Auto-renewal worker started");
  return target;
}

// Standalone entry point: when invoked directly (e.g., `node dist/autoRenewalWorker.js`).
// NOT composed by bootstrap.ts — its disposition (consolidate into api vs keep as
// worker) is tracked under audit finding FN-004 and decided separately.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  void startAutoRenewalWorker({ prisma: workerPrisma }).catch((err) => {
    logger.error({ err }, "Failed to start auto-renewal worker");
    process.exit(1);
  });
}
