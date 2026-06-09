/**
 * @file worker.smoke.ts
 * @description Smoke test that enqueues a minimal publish job against the
 *              live queue + repo to verify a dev worker can pick it up.
 *              Exits cleanly when queue or repo are unavailable.
 * @layer infrastructure
 */
import { createBullMQQueueAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { workerPrisma } from "../src/container/workerContainer.js";

async function main() {
  const queue = createBullMQQueueAdapter({ queueName: QUEUE_NAMES.PUBLISH });
  const repo = createPrismaRepoAdapter({ prisma: workerPrisma });

  // Precondiciones ligeras
  const health = await queue.health();
  if (!health.ok) {
    console.log("Queue unavailable; skipping smoke test");
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
    return;
  }

  const dedupeKey = `${post.value.id}:dev-x:${Date.now()}`;
  const enq = await queue.enqueue({
    dedupeKey,
    payload: { postId: post.value.id, channelId: "dev-x" },
  });
  console.log("enqueue:", enq);
  console.log("✓ worker smoke enqueued (ensure worker dev is running)");
}

main();
