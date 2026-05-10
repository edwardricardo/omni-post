/**
 * @file index.ts
 * @description Worker integration test helpers — provider mocks + saga
 *              event assertions + queue inline runners. Smokes import these
 *              instead of bringing up the full BullMQ + Redis pipeline.
 * @layer infrastructure
 */

import type Redis from "ioredis";

export interface MockProviderResult {
  ok: boolean;
  error?: "AUTH" | "RATE_LIMIT" | "CONTENT_REJECTED" | "NETWORK" | "INTERNAL";
  data?: Record<string, unknown>;
}

/**
 * Build a provider adapter stub that returns a controllable result.
 * Tests inject this in place of the real provider so the worker can be
 * exercised without hitting third-party APIs.
 */
export function mockProviderAdapter(result: MockProviderResult = { ok: true }): {
  publish: () => Promise<MockProviderResult>;
  refresh: () => Promise<MockProviderResult>;
  fetchAnalytics: () => Promise<MockProviderResult>;
  getComments: () => Promise<MockProviderResult>;
} {
  const stub = async (): Promise<MockProviderResult> => result;
  return {
    publish: stub,
    refresh: stub,
    fetchAnalytics: stub,
    getComments: stub,
  };
}

/**
 * Subscribe to the saga:events Redis channel and resolve the first message
 * matching the given saga id. Used by smoke tests that assert a worker
 * emitted the expected post-job event (publish.job.completed /
 * publish.job.failed).
 */
export async function awaitSagaEvent(
  redis: Redis,
  sagaId: string,
  timeoutMs = 10_000
): Promise<{ type: string; data: Record<string, unknown> }> {
  const subscriber = redis.duplicate({ commandTimeout: 0 });
  await subscriber.subscribe("saga:events");

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      void subscriber.quit();
      reject(new Error(`No saga:events message for ${sagaId} within ${timeoutMs}ms`));
    }, timeoutMs);

    subscriber.on("message", (_channel, raw) => {
      try {
        const parsed = JSON.parse(raw) as {
          metadata?: { sagaId?: string };
          type: string;
          data: Record<string, unknown>;
        };
        if (parsed.metadata?.sagaId === sagaId) {
          clearTimeout(timer);
          void subscriber.quit();
          resolve({ type: parsed.type, data: parsed.data });
        }
      } catch {
        // Malformed message — ignore and keep listening
      }
    });
  });
}
