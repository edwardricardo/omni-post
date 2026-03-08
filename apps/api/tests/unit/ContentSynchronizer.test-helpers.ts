console.log = () => {};
console.error = () => {};
console.warn = () => {};

import { mock } from "node:test";
import { ContentSynchronizer } from "../../src/orchestration/ContentSynchronizer.js";
import type { SyncContentRequest, OrchestrationResult, SyncResponse } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";

import { StreamProcessor } from "../../src/orchestration/sync/StreamProcessor.js";

StreamProcessor.prototype.setupRedisSyncStreams = async function (this: any) {
  await this.redis
    .xgroup("CREATE", "sync:content:changes", "sync-processors", "$", "MKSTREAM")
    .catch(() => {});
};

StreamProcessor.prototype.startScheduledSyncProcessor = function (
  _processScheduledSyncs: () => Promise<void>
) {};

// NOTE: No ContentSynchronizer prototype patches needed here.
// ContentSynchronizer.setupRedisSyncStreams() delegates to this.streamProcessor.setupRedisSyncStreams(),
// which is already patched above on StreamProcessor.prototype.
// ContentSynchronizer.startScheduledSyncProcessor() delegates to StreamProcessor.startScheduledSyncProcessor(),
// which is already patched above as a no-op.
// ContentSynchronizer.startStreamConsumer() is already an empty stub in the source.

export const createMockPrisma = () =>
  ({
    post: {
      findUnique: mock.fn(async () => null),
      findMany: mock.fn(async () => []),
      create: mock.fn(async () => ({})),
      update: mock.fn(async () => ({})),
    },
  }) as any;

export const createMockRedis = () => {
  const redisData = new Map<string, any>();

  return {
    xgroup: mock.fn(async () => "OK"),
    xreadgroup: mock.fn(async () => null),
    xadd: mock.fn(async () => "1234567890123-0"),
    xack: mock.fn(async () => 1),
    lrange: mock.fn(async (key: string) => {
      const data = redisData.get(key);
      return data || [];
    }),
    lpush: mock.fn(async (key: string, value: string) => {
      const existing = redisData.get(key) || [];
      redisData.set(key, [value, ...existing]);
      return existing.length + 1;
    }),
    setex: mock.fn(async () => "OK"),
    get: mock.fn(async (key: string) => {
      return redisData.get(key) || null;
    }),
    del: mock.fn(async () => 1),
    _testData: redisData,
  } as any;
};

export const createMockEventService = () =>
  ({
    publishEvent: mock.fn(async () => ({ ok: true, value: undefined })),
    registerHandler: mock.fn(() => {}),
  }) as any;

export const createMockPost = (overrides?: Partial<CanonicalPost>): CanonicalPost => ({
  id: "post-id",
  projectId: "project-1",
  locale: "en",
  title: "Test Post",
  body: "This is a test post content",
  tags: ["test", "content"],
  media: [],
  scheduledAt: new Date("2024-01-01T10:00:00Z"),
  ...overrides,
});

export function stubSyncCoordinatorSuccess(
  synchronizer: ContentSynchronizer,
  responseOverride?: Partial<SyncResponse>
): void {
  // ContentSynchronizer has its own syncContent method (no sub-coordinator).
  // We replace syncContent directly on the instance.
  (synchronizer as any).syncContent = mock.fn(
    async (request: SyncContentRequest): Promise<OrchestrationResult<SyncResponse>> => {
      if (request.dryRun) {
        return {
          ok: true,
          value: {
            success: true,
            data: {
              syncedProviders: request.configuration.targets,
              conflicts: [],
              changes: [],
            },
          },
        };
      }
      return {
        ok: true,
        value: {
          success: true,
          data: {
            syncedProviders: request.configuration.targets,
            conflicts: [],
            changes: [],
            ...responseOverride,
          },
        },
      };
    }
  );
}

export function stubSyncCoordinatorValidationFailure(synchronizer: ContentSynchronizer): void {
  // ContentSynchronizer has its own syncContent method (no sub-coordinator).
  // We replace syncContent directly on the instance.
  (synchronizer as any).syncContent = mock.fn(
    async (_request: SyncContentRequest): Promise<OrchestrationResult<SyncResponse>> => ({
      ok: false,
      error: {
        id: "err-1",
        type: "validation",
        message: "Post not found: invalid-post-id",
        retryable: false,
        occurredAt: new Date(),
      },
    })
  );
}

export function stubSyncCoordinatorSystemError(synchronizer: ContentSynchronizer): void {
  // ContentSynchronizer has its own syncContent method (no sub-coordinator).
  // We replace syncContent directly on the instance.
  (synchronizer as any).syncContent = mock.fn(
    async (_request: SyncContentRequest): Promise<OrchestrationResult<SyncResponse>> => ({
      ok: false,
      error: {
        id: "err-sys",
        type: "system",
        message: "Sync failed: Cannot read properties of null",
        retryable: true,
        occurredAt: new Date(),
      },
    })
  );
}
