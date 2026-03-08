import { randomUUID } from "node:crypto";
import type { DomainEvent } from "@shared/events";

// ---------------------------------------------------------------------------
// Stable test UUIDs
// ---------------------------------------------------------------------------

export const TEST_POST_ID = "a0a0a0a0-b1b1-4c1c-8d1d-e1e1e1e1e1e1";
export const TEST_PROJECT_ID = "b2b2b2b2-c3c3-4d3d-8e3e-f3f3f3f3f3f3";
export const TEST_CHANNEL_ID = "c4c4c4c4-d5d5-4e5e-8f5f-a5a5a5a5a5a5";

// ---------------------------------------------------------------------------
// Mock Use Cases
// ---------------------------------------------------------------------------

const NOW = new Date();

const MOCK_POST_RESULT = {
  id: TEST_POST_ID,
  projectId: TEST_PROJECT_ID,
  body: "test",
  tags: [],
  locale: "en",
  status: "DRAFT",
  mediaCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

export class MockCreatePostUseCase {
  async execute() {
    return { ok: true as const, value: { ...MOCK_POST_RESULT, id: randomUUID() } };
  }
}

export class MockUpdatePostUseCase {
  async execute() {
    return { ok: true as const, value: { ...MOCK_POST_RESULT } };
  }
}

export class MockDeletePostUseCase {
  async execute() {
    return { ok: true as const, value: undefined };
  }
}

// ---------------------------------------------------------------------------
// Mock Repositories
// ---------------------------------------------------------------------------

export class MockPostRepository {
  async findById() {
    return {
      ok: true as const,
      value: {
        id: { value: TEST_POST_ID },
        projectId: { value: TEST_PROJECT_ID },
        status: { value: "DRAFT" },
        body: { value: "test" },
        media: [],
        scheduledAt: null,
      },
    };
  }

  async save() {
    return { ok: true as const, value: undefined };
  }

  async delete() {
    return { ok: true as const, value: undefined };
  }

  async findByProjectId() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async findByStatus() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async findReadyForPublishing() {
    return [];
  }

  async findWithFilters() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async countByProjectId() {
    return 0;
  }

  async countByStatus() {
    return 0;
  }

  async getProjectStats() {
    return { total: 0, drafts: 0, scheduled: 0, published: 0, failed: 0 };
  }

  async bulkUpdateStatus() {
    return { ok: true as const, value: undefined };
  }

  async hardDelete() {
    return { ok: true as const, value: undefined };
  }

  async exists() {
    return true;
  }
}

export class MockChannelRepository {
  async findById() {
    return {
      ok: true as const,
      value: {
        id: { value: TEST_CHANNEL_ID },
        projectId: { value: TEST_PROJECT_ID },
        provider: { type: "X" },
        name: "Test Channel",
      },
    };
  }

  async findByProjectId() {
    return [];
  }

  async save() {
    return { ok: true as const, value: undefined };
  }

  async delete() {
    return { ok: true as const, value: undefined };
  }

  async hardDelete() {
    return { ok: true as const, value: undefined };
  }
}

export class MockPostQueryRepository {
  async getById() {
    return {
      ok: true as const,
      value: {
        id: TEST_POST_ID,
        projectId: TEST_PROJECT_ID,
        body: "Test post",
        status: "DRAFT",
        locale: "en",
        tags: [],
        mediaCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    };
  }

  async listByProject() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async search() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }

  async getUpcoming() {
    return [];
  }

  async getRecentlyPublished() {
    return [];
  }

  async getByIdWithThread() {
    return {
      ok: true as const,
      value: {
        id: TEST_POST_ID,
        projectId: TEST_PROJECT_ID,
        body: "Test post",
        status: "DRAFT",
        locale: "en",
        tags: [],
        mediaCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    };
  }

  async listGlobal() {
    return {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
      hasNext: false,
      hasPrevious: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

export class MockRedis {
  private store = new Map<string, string>();

  async ping(): Promise<string> {
    return "PONG";
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) || null;
  }

  async setex(key: string, _ttl: number, value: string): Promise<string> {
    this.store.set(key, value);
    return "OK";
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(pattern.replace(/\*/g, ".*"));
    return Array.from(this.store.keys()).filter((key) => regex.test(key));
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock EventService
// ---------------------------------------------------------------------------

export class MockEventService {
  public events: DomainEvent[] = [];

  async publishEvents(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async healthCheck(): Promise<{ ok: boolean; value: { status: string } }> {
    return { ok: true, value: { status: "healthy" } };
  }

  reset(): void {
    this.events = [];
  }
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

export function createMockCqrsConfig(overrides?: {
  fastify?: unknown;
  redis?: MockRedis;
  eventService?: MockEventService;
}) {
  const redis = overrides?.redis ?? new MockRedis();
  const eventService = overrides?.eventService ?? new MockEventService();

  return {
    fastify: overrides?.fastify,
    createPostUseCase: new MockCreatePostUseCase() as any,
    updatePostUseCase: new MockUpdatePostUseCase() as any,
    deletePostUseCase: new MockDeletePostUseCase() as any,
    postRepository: new MockPostRepository() as any,
    channelRepository: new MockChannelRepository() as any,
    postQueryRepository: new MockPostQueryRepository() as any,
    eventService: eventService as any,
    redis: redis as any,
  };
}
