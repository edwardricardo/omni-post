console.log = () => {};
console.error = () => {};
console.warn = () => {};

import { vi, expect } from "vitest";
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
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  }) as any;

export const createMockRedis = () => {
  const redisData = new Map<string, any>();

  return {
    xgroup: vi.fn(async () => "OK"),
    xreadgroup: vi.fn(async () => null),
    xadd: vi.fn(async () => "1234567890123-0"),
    xack: vi.fn(async () => 1),
    lrange: vi.fn(async (key: string) => {
      const data = redisData.get(key);
      return data || [];
    }),
    lpush: vi.fn(async (key: string, value: string) => {
      const existing = redisData.get(key) || [];
      redisData.set(key, [value, ...existing]);
      return existing.length + 1;
    }),
    setex: vi.fn(async () => "OK"),
    get: vi.fn(async (key: string) => {
      return redisData.get(key) || null;
    }),
    del: vi.fn(async () => 1),
    _testData: redisData,
  } as any;
};

export const createMockEventService = () =>
  ({
    publishEvent: vi.fn(async () => ({ ok: true, value: undefined })),
    registerHandler: vi.fn(() => {}),
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
  (synchronizer as any).syncContent = vi.fn(
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
  (synchronizer as any).syncContent = vi.fn(
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
  (synchronizer as any).syncContent = vi.fn(
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
