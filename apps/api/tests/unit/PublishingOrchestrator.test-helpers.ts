/**
 * PublishingOrchestrator - Shared Test Helpers
 *
 * Common mock classes, bridge functions, and factory helpers
 * used across the PublishingOrchestrator test suite.
 */

import { PublishingOrchestrator } from "../../src/orchestration/PublishingOrchestrator.js";
import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService.js";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";

// ============================================================================
// Mock Dependency Interfaces
// ============================================================================

/**
 * Typed mock interfaces documenting exactly which methods are mocked.
 * Bridge functions encapsulate the single cast so call sites remain clean
 * and any mock/real-type mismatch is caught at the bridge boundary.
 */
export interface MockedPrisma {
  post: {
    findUnique: (...args: any[]) => any;
    create: (...args: any[]) => any;
    update: (...args: any[]) => any;
  };
  channel: { findFirst: (...args: any[]) => any };
}
export interface MockedRedis {
  setex(key: string, ttl: number, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  config(command: string, key: string, value?: string): Promise<void>;
}
export interface MockedEventService {
  publishEvent(event: any): Promise<void>;
  registerHandler(eventType: string, handler: any): void;
}

/** Bridge functions: typed parameter documents mock shape, cast contained in one place */
export function asPrisma(mock: MockedPrisma): PrismaClient {
  return mock as unknown as PrismaClient;
}
export function asRedis(mock: MockedRedis): Redis {
  return mock as unknown as Redis;
}
export function asEventService(mock: MockedEventService): EventService {
  return mock as unknown as EventService;
}

// ============================================================================
// Mock Classes
// ============================================================================

export class MockPrismaClient {
  post = {
    findUnique: async () => null,
    create: async (data: any) => ({ id: "post-123", ...data }),
    update: async (data: any) => ({ id: "post-123", ...data }),
  };
  channel = {
    findFirst: async () => null,
  };
}

export class MockRedis {
  private storage = new Map<string, string>();
  private subscriptions = new Map<string, Function[]>();

  async setex(key: string, _ttl: number, value: string): Promise<void> {
    this.storage.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.storage.get(key) || null;
  }

  async del(key: string): Promise<number> {
    this.storage.delete(key);
    return 1;
  }

  async publish(channel: string, message: string): Promise<number> {
    const handlers = this.subscriptions.get(channel) || [];
    handlers.forEach((handler) => handler(message));
    return handlers.length;
  }

  async config(_command: string, _key: string, _value?: string): Promise<void> {
    // Mock config command
  }

  clear(): void {
    this.storage.clear();
    this.subscriptions.clear();
  }
}

export class MockEventService {
  private events: any[] = [];
  private handlers = new Map<string, any>();

  async publishEvent(event: any): Promise<any> {
    this.events.push(event);
  }

  registerHandler(eventType: string, handler: any): void {
    this.handlers.set(eventType, handler);
  }

  getEvents(): any[] {
    return this.events;
  }

  getEventsByType(type: string): any[] {
    return this.events.filter((e) => e.type === type);
  }

  clear(): void {
    this.events = [];
  }
}

// ============================================================================
// Mock Provider Registry
// ============================================================================

export const mockProviderRegistry = {
  getAdapter: (providerId: ProviderId) => ({
    render: (post: any) => ({ ok: true, value: post }),
    publish: async (_request: any) => ({
      ok: true,
      value: {
        providerPostId: `${providerId}-post-123`,
        url: `https://${providerId}.com/post/123`,
        publishedAt: new Date(),
      },
    }),
  }),
};

// ============================================================================
// Orchestrator Factory
// ============================================================================

/**
 * Creates a standard orchestrator with all internal lifecycle methods stubbed out
 * so tests can focus on the specific behaviour under test.
 */
export function createOrchestrator(
  mockPrisma: MockPrismaClient,
  mockRedis: MockRedis,
  mockEvents: MockEventService,
  config?: Partial<ConstructorParameters<typeof PublishingOrchestrator>[0]["config"] & object>
): PublishingOrchestrator {
  const orchestrator = new PublishingOrchestrator({
    prisma: asPrisma(mockPrisma),
    redis: asRedis(mockRedis),
    eventService: asEventService(mockEvents),
    ...(config && { config }),
  });

  stubOrchestratorInternals(orchestrator);
  return orchestrator;
}

/**
 * Stubs internal methods that aren't the focus of any individual test.
 * Called by createOrchestrator(); also exported for tests that need to
 * re-apply the stubs after constructing their own instance.
 */
export function stubOrchestratorInternals(orchestrator: PublishingOrchestrator): void {
  (orchestrator as any).setupRedisChannels = async () => {};
  (orchestrator as any).registerEventHandlers = () => {};
  (orchestrator as any).startHealthMonitoring = () => {};
  (orchestrator as any).getPlan = async (planId: string) => ({
    id: planId,
    postId: "post-123",
    projectId: "project-456",
    strategy: "SIMULTANEOUS" as const,
    conflictResolution: "BEST_EFFORT" as const,
    providers: ["twitter" as ProviderId, "facebook" as ProviderId],
    dependencies: [],
    timing: {
      timezone: "UTC",
      respectRateLimits: true,
    },
    estimatedDuration: 5000,
    createdAt: new Date(),
    createdBy: "user-123",
  });
  (orchestrator as any).storePlan = async () => {};
  (orchestrator as any).storeExecution = async () => {};
  (orchestrator as any).getExecutionFromDatabase = async () => null;
  (orchestrator as any).getPostContent = async () => ({
    content: "Test post content",
    media: [],
  });
  (orchestrator as any).getChannelConfig = async () => ({
    id: "channel-123",
    providerId: "twitter",
    credentials: {},
  });
}
