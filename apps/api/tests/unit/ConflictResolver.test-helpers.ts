/**
 * Shared test helpers for ConflictResolver tests
 */

import type { TestContext } from "node:test";
import type { OrchestrationConflict, PublishResult } from "@shared/orchestration";
import type { CanonicalPost } from "@shared/types";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

// Mock dependencies — accept TestContext for auto-restore
export class MockPrismaClient {
  post: {
    findUnique: ReturnType<TestContext["mock"]["fn"]>;
    update: ReturnType<TestContext["mock"]["fn"]>;
  };
  constructor(t: TestContext) {
    this.post = {
      findUnique: t.mock.fn(),
      update: t.mock.fn(),
    };
  }
}

export class MockRedis {
  setex: ReturnType<TestContext["mock"]["fn"]>;
  get: ReturnType<TestContext["mock"]["fn"]>;
  del: ReturnType<TestContext["mock"]["fn"]>;
  constructor(t: TestContext) {
    this.setex = t.mock.fn(async () => "OK");
    this.get = t.mock.fn(async () => null);
    this.del = t.mock.fn(async () => 1);
  }
}

export class MockEventService {
  publishEvent: ReturnType<TestContext["mock"]["fn"]>;
  constructor(t: TestContext) {
    this.publishEvent = t.mock.fn(async () => undefined);
  }
}

// Mock provider registry factory
export const createMockProviderRegistry = (t: TestContext) => ({
  getAdapter: t.mock.fn(),
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
