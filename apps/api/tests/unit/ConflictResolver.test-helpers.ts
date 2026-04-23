/**
 * Shared test helpers for ConflictResolver tests
 *
 * @file ConflictResolver.test-helpers.ts
 * @description Test helpers for conflict resolver test helpers
 * @layer infrastructure
 */

import type { OrchestrationConflict, PublishResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

// Mock dependencies — accept TestContext for auto-restore
export class MockPrismaClient {
  post: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  constructor() {
    this.post = {
      findUnique: vi.fn(),
      update: vi.fn(),
    };
  }
}

export class MockRedis {
  setex: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  constructor() {
    this.setex = vi.fn(async () => "OK");
    this.get = vi.fn(async () => null);
    this.del = vi.fn(async () => 1);
  }
}

export class MockEventService {
  publishEvent: ReturnType<typeof vi.fn>;
  constructor() {
    this.publishEvent = vi.fn(async () => undefined);
  }
}

// Mock provider registry factory
export const createMockProviderRegistry = () => ({
  getAdapter: vi.fn(),
});

// Test fixtures
export const createTestContext = () => ({
  planId: "plan-123",
  postId: "post-456",
  providerId: "twitter" as ProviderId,
  attemptNumber: 1,
  globalStrategy: "BEST_EFFORT" as const,
  previousResults: {},
});

export const createTestPublishResult = (overrides?: Partial<PublishResult>): PublishResult => ({
  providerId: "twitter" as ProviderId,
  status: "failed",
  retryCount: 0,
  duration: 100,
  error: "RATE_LIMIT",
  ...overrides,
});

export const createTestCanonicalPost = (overrides?: Partial<CanonicalPost>): CanonicalPost => ({
  body: "Test post content",
  media: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  authorId: "user-123",
  ...overrides,
});

export const createTestConflict = (
  overrides?: Partial<OrchestrationConflict>
): OrchestrationConflict => ({
  id: `conflict-${Date.now()}`,
  type: "rate_limit",
  providerId: "twitter" as ProviderId,
  description: "Rate limit exceeded",
  severity: "critical",
  autoResolved: false,
  ...overrides,
});
