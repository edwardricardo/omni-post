import { describe, it, beforeEach, expect } from "vitest";
import { CQRSBusImpl } from "../../src/cqrs/CQRSBus";
import type { QueryHandler, QueryResult } from "@shared/cqrs";
import {
  MockRedis,
  MockEventService,
  TestCommandHandler,
  TestQueryHandler,
  makeCommand,
} from "./CQRSBus.test-helpers.js";

describe("CQRSBus - Metrics and Monitoring", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableMetrics: true,
    });
  });

  it("should provide accurate metrics", () => {
    const metrics = bus.getMetrics();

    expect(typeof metrics.commandsExecuted).toBe("number");
    expect(typeof metrics.queriesExecuted).toBe("number");
    expect(typeof metrics.commandErrors).toBe("number");
    expect(typeof metrics.queryErrors).toBe("number");
  });

  it("should calculate average execution times", async () => {
    const handler = new TestCommandHandler();
    bus.registerCommandHandler(handler);

    const command = makeCommand();

    await bus.executeCommand(command);
    await bus.executeCommand(command);

    const metrics = bus.getMetrics();
    expect(metrics.avgCommandExecutionTime >= 0).toBeTruthy();
  });

  it("should provide handlers information", () => {
    const cmdHandler = new TestCommandHandler();
    const qryHandler = new TestQueryHandler();

    bus.registerCommandHandler(cmdHandler);
    bus.registerQueryHandler(qryHandler);

    const info = bus.getHandlersInfo();

    expect(Array.isArray(info.commands)).toBeTruthy();
    expect(Array.isArray(info.queries)).toBeTruthy();
    expect(info.commands.includes("test.command")).toBeTruthy();
    expect(info.queries.includes("test.query")).toBeTruthy();
  });
});

describe("CQRSBus - Health Checks", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });
  });

  it("should report healthy status when all systems operational", async () => {
    const health = await bus.healthCheck();

    expect(health.status).toBe("healthy");
    expect(health.details.redis).toBe(true);
    expect(health.details.eventService).toBe(true);
  });

  it("should report unhealthy when EventService is down", async () => {
    mockEventService.setHealthy(false);

    const health = await bus.healthCheck();

    expect(health.status).toBe("unhealthy");
    expect(health.details.eventService).toBe(false);
  });

  it("should include handler counts in health check", async () => {
    bus.registerCommandHandler(new TestCommandHandler());
    bus.registerQueryHandler(new TestQueryHandler());

    const health = await bus.healthCheck();

    expect(health.details.commandHandlers).toBe(1);
    expect(health.details.queryHandlers).toBe(1);
  });
});

describe("CQRSBus - Cache Management", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableQueryCache: true,
    });
  });

  it("should clear all cached queries", async () => {
    await mockRedis.setex("cqrs:query:key1", 300, "data1");
    await mockRedis.setex("cqrs:query:key2", 300, "data2");

    const clearedCount = await bus.clearCache();

    expect(clearedCount).toBe(2);
  });

  it("should clear cached queries matching pattern", async () => {
    await mockRedis.setex("cqrs:query:posts:1", 300, "data1");
    await mockRedis.setex("cqrs:query:posts:2", 300, "data2");
    await mockRedis.setex("cqrs:query:users:1", 300, "data3");

    const clearedCount = await bus.clearCache("cqrs:query:posts:*");

    expect(clearedCount).toBe(2);
  });

  it("should return 0 when no cached queries to clear", async () => {
    const clearedCount = await bus.clearCache();

    expect(clearedCount).toBe(0);
  });

  it("should return 0 when cache is disabled", async () => {
    const busNoCache = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableQueryCache: false,
    });

    const clearedCount = await busNoCache.clearCache();

    expect(clearedCount).toBe(0);
  });
});

describe("CQRSBus - Shutdown", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
    });
  });

  it("should clear handlers on shutdown", async () => {
    bus.registerCommandHandler(new TestCommandHandler());
    bus.registerQueryHandler(new TestQueryHandler());

    await bus.shutdown();

    const info = bus.getHandlersInfo();
    expect(info.commands.length).toBe(0);
    expect(info.queries.length).toBe(0);
  });

  it("should be idempotent", async () => {
    await bus.shutdown();
    await bus.shutdown();
  });
});

describe("CQRSBus - Query Handler Registration", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableMetrics: true,
      enableQueryCache: true,
    });
  });

  it("should register a query handler successfully", () => {
    const handler = new TestQueryHandler();
    bus.registerQueryHandler(handler);

    const handlersInfo = bus.getHandlersInfo();
    expect(handlersInfo.queries.includes("test.query")).toBeTruthy();
  });

  it("should prevent duplicate query handler registration", () => {
    const handler1 = new TestQueryHandler();
    const handler2 = new TestQueryHandler();

    bus.registerQueryHandler(handler1);

    expect(() => bus.registerQueryHandler(handler2)).toThrow(/already registered/);
  });

  it("should register multiple different query handlers", () => {
    class Handler1 implements QueryHandler {
      readonly queryType = "query.1";
      async handle(): Promise<QueryResult> {
        return { success: true };
      }
    }

    class Handler2 implements QueryHandler {
      readonly queryType = "query.2";
      async handle(): Promise<QueryResult> {
        return { success: true };
      }
    }

    bus.registerQueryHandler(new Handler1());
    bus.registerQueryHandler(new Handler2());

    const handlersInfo = bus.getHandlersInfo();
    expect(handlersInfo.queries.length).toBe(2);
    expect(handlersInfo.queries.includes("query.1")).toBeTruthy();
    expect(handlersInfo.queries.includes("query.2")).toBeTruthy();
  });
});
