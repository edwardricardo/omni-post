/**
 * @file workerConnection.integration.test.ts
 * @description Smoke B — real-wiring round-trip for the composition-root-owned
 *   BullMQ worker connection. Drives the REAL registration seam
 *   (`registerRedisConnections`) the production boot path uses (setupServices
 *   calls the same function), resolves `TOKENS.BullMQWorkerConnection`, and
 *   asserts the wiring invariants this change exists to guarantee:
 *     1. the worker connection token resolves to a live Redis built with
 *        `maxRetriesPerRequest: null` (BullMQ Worker requirement) and pings;
 *     2. a consumer adapter constructed with that injected connection USES it,
 *        and `consumer.close()` does NOT quit the shared socket (composition
 *        root owns the lifecycle);
 *     3. the token is a singleton — two resolves return the SAME instance, so
 *        all in-process consumers share one socket.
 *
 *   This is NOT a reimplementation of production logic (the drainTarget lesson):
 *   it exercises the exact `registerRedisConnections` function the composition
 *   root invokes and the exact `createBullMQConsumerAdapter` seam consumers use.
 *
 *   LXC-safe: one container with only the Redis connections registered, against
 *   the homelab Redis from `.env.test`. No full container boot, no enqueue
 *   round-trip, no build/coverage/test:all.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Redis } from "ioredis";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import { Container } from "../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { registerRedisConnections } from "../../../src/infrastructure/container/registerRedisConnections.js";

describe("Smoke B — BullMQ worker connection wiring (integration)", () => {
  let container: Container;

  before(() => {
    // Build a container with ONLY the Redis connections registered, via the
    // SAME function the production composition root (setupServices) calls.
    container = new Container();
    registerRedisConnections(container);
  });

  after(async () => {
    // Quit only if the singleton was actually constructed during the run.
    const conn = container.peekInstance<Redis>(TOKENS.BullMQWorkerConnection);
    if (conn) {
      await conn.quit();
    }
  });

  it("resolves a live worker connection with maxRetriesPerRequest:null that pings", async () => {
    const connection = container.resolve<Redis>(TOKENS.BullMQWorkerConnection);

    assert.strictEqual(
      connection.options.maxRetriesPerRequest,
      null,
      "the worker connection must be built with maxRetriesPerRequest:null (BullMQ Worker requirement)"
    );

    const pong = await connection.ping();
    assert.strictEqual(pong, "PONG", "the resolved worker connection must reach Redis");
  });

  it("is a singleton — every consumer resolves the SAME shared socket", () => {
    const first = container.resolve<Redis>(TOKENS.BullMQWorkerConnection);
    const second = container.resolve<Redis>(TOKENS.BullMQWorkerConnection);

    assert.strictEqual(
      first,
      second,
      "BullMQWorkerConnection must be a singleton so all in-process consumers share one socket"
    );
  });

  it("builds a consumer adapter against the injected connection, and close() does NOT quit the shared socket", async () => {
    const connection = container.resolve<Redis>(TOKENS.BullMQWorkerConnection);
    assert.notStrictEqual(
      connection.status,
      "end",
      "precondition: the shared connection is not already closed"
    );

    // Construct the adapter against the REAL resolved worker connection. We
    // deliberately do NOT start the live blocking Worker loop (subscribe()):
    // the wiring invariant under test is composition-root connection OWNERSHIP,
    // and BullMQ's internal blocking-fetch connection has its own teardown
    // lifecycle that is not what Smoke B exercises (that path is covered by the
    // mocked unit test, consumer-adapter.test.ts, which pins that close() never
    // quits the injected connection).
    const consumer = createBullMQConsumerAdapter({
      queueName: QUEUE_NAMES.ANALYTICS_AGGREGATION,
      connection,
    });

    // close() before subscribe() exercises the adapter's teardown directly. It
    // MUST NOT quit the shared socket — the composition root owns the lifecycle
    // and quits it at shutdown. ioredis transitions a quit() socket to status
    // "end"; the adapter's close() leaves the injected connection open.
    await consumer.close();

    assert.notStrictEqual(
      connection.status,
      "end",
      "consumer.close() must NOT quit the shared connection — the composition " +
        "root owns it (status would be 'end' if it had been quit)"
    );

    // The shared socket is still usable for a real command after the consumer
    // has closed — proving the adapter never quit it.
    const pong = await connection.ping();
    assert.strictEqual(
      pong,
      "PONG",
      "the shared connection must remain usable after consumer.close() — it was not quit"
    );
  });
});
