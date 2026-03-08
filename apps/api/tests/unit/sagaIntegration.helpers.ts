/**
 * Shared test helpers for SagaIntegration test suites.
 *
 * Provides lightweight mock factories for Fastify, EventService, CQRSBus,
 * Redis and QueuePort so every test file can set up its own isolated
 * integration instance without sharing mutable state.
 */

import { DomainEvent } from "@shared/events";
import { Command } from "@shared/cqrs";
import { ok } from "@shared/types";
import type { QueuePort, QueueJob, QueueHealth } from "@ports/core";
import type { Result } from "@shared/types";
import { SagaIntegration } from "../../src/saga/SagaIntegration";

// ---------------------------------------------------------------------------
// Mock type definitions
// ---------------------------------------------------------------------------

export interface MockFastifyInstance {
  prisma: { $queryRaw: () => Promise<{ result: number }[]> };
  post: (path: string, handler: (req: any, reply: any) => any) => void;
  get: (path: string, handler: (req: any, reply: any) => any) => void;
  registeredRoutes: Map<string, (req: any, reply: any) => any>;
}

export interface MockEventService {
  publishEvent: (event: DomainEvent) => Promise<void>;
  publishedEvents: DomainEvent[];
}

export interface MockCQRSBus {
  executeCommand: (command: Command) => Promise<{ success: boolean; data: unknown }>;
  executedCommands: Command[];
}

export interface MockRedis {
  setex: (key: string, ttl: number, data: string) => Promise<void>;
  get: (key: string) => Promise<string | null>;
  keys: (pattern: string) => Promise<string[]>;
  ping: () => Promise<string>;
}

/**
 * MockQueue tracks every enqueued job for assertions.
 * Implements the QueuePort interface from @ports/core.
 */
export interface MockQueue extends QueuePort {
  enqueuedJobs: QueueJob[];
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createMockFastify(): MockFastifyInstance {
  const registeredRoutes = new Map<string, (req: any, reply: any) => any>();
  return {
    prisma: { $queryRaw: async () => [{ result: 1 }] },
    post: (path, handler) => {
      registeredRoutes.set(`POST:${path}`, handler);
    },
    get: (path, handler) => {
      registeredRoutes.set(`GET:${path}`, handler);
    },
    registeredRoutes,
  };
}

export function createMockEventService(): MockEventService {
  const publishedEvents: DomainEvent[] = [];
  return {
    publishEvent: async (event: DomainEvent) => {
      publishedEvents.push(event);
    },
    publishedEvents,
  };
}

export function createMockCQRSBus(): MockCQRSBus {
  const executedCommands: Command[] = [];
  return {
    executeCommand: async (command: Command) => {
      executedCommands.push(command);
      return { success: true, data: { id: command.aggregateId, version: 1 } };
    },
    executedCommands,
  };
}

export function createMockRedis(): MockRedis {
  const storage = new Map<string, string>();
  return {
    setex: async (key: string, _ttl: number, data: string) => {
      storage.set(key, data);
    },
    get: async (key: string) => storage.get(key) ?? null,
    keys: async (pattern: string) => {
      const prefix = pattern.replace("*", "");
      return Array.from(storage.keys()).filter((k) => k.startsWith(prefix));
    },
    ping: async () => "PONG",
  };
}

export function createMockQueue(): MockQueue {
  const enqueuedJobs: QueueJob[] = [];
  let jobCounter = 0;

  return {
    enqueuedJobs,
    async enqueue(job: QueueJob): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
      jobCounter++;
      const jobId = job.id ?? `mock-job-${jobCounter}`;
      enqueuedJobs.push({ ...job, id: jobId });
      return ok(jobId);
    },
    async health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">> {
      return ok({
        connected: true,
        waiting: enqueuedJobs.length,
        active: 0,
        completed: 0,
        failed: 0,
      });
    },
    async remove(_jobId: string): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">> {
      return ok(true);
    },
  };
}

/**
 * Build a fully initialized SagaIntegration with isolated mocks.
 * Returns the integration instance AND the registered-routes map so callers
 * can invoke handlers directly without going through a real HTTP layer.
 */
export async function buildIntegration(): Promise<{
  integration: SagaIntegration;
  routes: Map<string, (req: any, reply: any) => any>;
  mockEventService: MockEventService;
  mockCQRSBus: MockCQRSBus;
  mockRedis: MockRedis;
}> {
  const mockFastify = createMockFastify();
  const mockEventService = createMockEventService();
  const mockCQRSBus = createMockCQRSBus();
  const mockRedis = createMockRedis();

  const integration = new SagaIntegration({
    fastify: mockFastify as any,
    eventService: mockEventService as any,
    cqrsBus: mockCQRSBus as any,
    redis: mockRedis as any,
  });

  await integration.initialize();

  return {
    integration,
    routes: mockFastify.registeredRoutes,
    mockEventService,
    mockCQRSBus,
    mockRedis,
  };
}

/** Minimal request object used by most tests. */
export function makeStartRequest(
  overrides: Partial<{ body: string; channelIds: string[]; priority: string }> = {}
) {
  return {
    body: {
      postData: {
        body: overrides.body ?? "Test post content",
        channelIds: overrides.channelIds ?? ["channel-1"],
      },
      ...(overrides.priority ? { priority: overrides.priority } : {}),
    },
    user: { id: "user-123", projectId: "project-456" },
    headers: {},
    ip: "127.0.0.1",
  };
}

/** Minimal reply stub that returns whatever is sent. */
export const passthroughReply = { send: (data: any) => data };
