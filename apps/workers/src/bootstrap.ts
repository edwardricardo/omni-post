/**
 * @file bootstrap.ts
 * @description Unified entry point that spawns every long-running BullMQ
 *              worker in a single Node process and coordinates their
 *              graceful shutdown. Container image's CMD points here.
 *
 *              Why one process for multiple workers:
 *              - Single container per deployment unit keeps orchestration
 *                simple (one log stream, one metrics endpoint, one
 *                lifecycle).
 *              - Workers don't compete for CPU at idle (BullMQ blocking
 *                BZPOPMIN parks the event loop until a job lands).
 *              - Sharing a Node process avoids paying ~80 MiB baseline
 *                memory per additional worker container.
 *
 *              Each worker module exports `startXxxWorker({ registerShutdown:
 *              false })` which boots its BullMQ Worker + Redis connection
 *              and returns a `ShutdownTarget`. The bootstrap then registers
 *              ONE process-level `SIGTERM`/`SIGINT` handler that drains all
 *              targets together — preventing the race where one worker's
 *              `process.exit(0)` cuts another worker's mid-drain.
 *
 *              Standalone usage of each worker (debugging, one-off runs)
 *              still works: `node dist/inboxSyncWorker.js` etc., because
 *              each file ends with an `import.meta.url` main-module guard
 *              that calls `startXxxWorker()` with default options.
 *
 *              NOT bootstrapped here: `autoRenewalWorker.ts` — its disposition
 *              (consolidate into api or keep as worker) is tracked under
 *              audit finding FN-004 and decided separately.
 * @layer infrastructure
 */

import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

import pino from "pino";
import { workerPrisma } from "./container/workerContainer.js";
import { startPublishWorker } from "./publishWorker.js";
import { startInboxSyncWorker } from "./inboxSyncWorker.js";
import { startAnalyticsIngestWorker } from "./analyticsIngestWorker.js";
import { startMentionIngestWorker } from "./mentionIngestWorker.js";
import { registerGracefulShutdown, type ShutdownTarget } from "./lib/gracefulShutdown.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "workers-bootstrap" });

async function main(): Promise<void> {
  logger.info("Bootstrapping workers process");

  const targets = await Promise.all([
    startPublishWorker({ registerShutdown: false }),
    startInboxSyncWorker({ prisma: workerPrisma, registerShutdown: false }),
    startAnalyticsIngestWorker({ prisma: workerPrisma, registerShutdown: false }),
    startMentionIngestWorker({ prisma: workerPrisma, registerShutdown: false }),
  ]);

  // Merge the per-worker shutdown targets into one. Order matters during drain:
  // workers first (drain in-flight jobs), then queues, then connections, then
  // afterTeardown hooks (custom cleanup), then Prisma. The composed `afterTeardown`
  // runs every worker's hook in sequence so each closes its own consumer / scheduler.
  const composed: ShutdownTarget = {
    workers: targets.flatMap((t) => t.workers ?? []),
    queues: targets.flatMap((t) => t.queues ?? []),
    connections: targets.flatMap((t) => t.connections ?? []),
    afterTeardown: async (): Promise<void> => {
      for (const t of targets) {
        if (t.afterTeardown) {
          await t.afterTeardown();
        }
      }
    },
  };

  // Use the first non-undefined `prisma` from any target. All workers share
  // the same `@infra/prisma` singleton, so any reference disconnects it once.
  const prismaTarget = targets.find((t) => t.prisma !== undefined)?.prisma;
  if (prismaTarget) {
    composed.prisma = prismaTarget;
  }

  registerGracefulShutdown({ name: "workers-bootstrap", target: composed, logger });

  logger.info(
    { workers: ["publish", "inbox-sync", "analytics-ingest", "mention-ingest"] },
    "All workers started; bootstrap idle (waiting on signals)"
  );
}

main().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});
