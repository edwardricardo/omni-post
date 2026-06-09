/**
 * @file worker.smoke.ts
 * @description Smoke test that enqueues a minimal publish job against the
 *              live queue + repo to verify a dev worker can pick it up.
 *              Exits cleanly when queue or repo are unavailable.
 * @layer infrastructure
 */
import Redis from "ioredis";
import { createBullMQQueueAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { workerPrisma } from "../src/container/workerContainer.js";
import { env } from "../src/config/env.js";

async function main() {
  // Producer-role connection: the queue adapter no longer self-constructs a
  // connection from process.env (composition root owns the socket). Build one
  // here from the validated env.REDIS_URL for this standalone dev smoke.
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  const queue = createBullMQQueueAdapter({ queueName: QUEUE_NAMES.PUBLISH, connection });
  const repo = createPrismaRepoAdapter({ prisma: workerPrisma });

  // Precondiciones ligeras
  const health = await queue.health();
  if (!health.ok) {
    console.log("Queue unavailable; skipping smoke test");
    await connection.quit();
    return;
  }

  // Usa el canal de seed "dev-x" y crea un post mínimo
  const post = await repo.createPost({
    projectId: "dev",
    locale: "es",
    body: "Smoke post",
    title: "Smoke",
  });
  if (!post.ok) {
    console.log("Repo unavailable; skipping smoke test");
    await connection.quit();
    return;
  }

  const dedupeKey = `${post.value.id}:dev-x:${Date.now()}`;
  const enq = await queue.enqueue({
    dedupeKey,
    payload: { postId: post.value.id, channelId: "dev-x" },
  });
  console.log("enqueue:", enq);
  console.log("✓ worker smoke enqueued (ensure worker dev is running)");
  await connection.quit();
}

main();
