import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CQRSBusImpl } from "../../src/cqrs/CQRSBus";
import type { QueryHandler, QueryResult } from "@shared/cqrs";
import {
  MockRedis,
  MockEventService,
  TestCommandHandler,
  TestQueryHandler,
  makeCommand,
} from "./CQRSBus.test-helpers.js";

describe("CQRSBus - Metrics and Monitoring", { concurrency: 1 }, () => {
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

    assert.strictEqual(typeof metrics.commandsExecuted, "number");
    assert.strictEqual(typeof metrics.queriesExecuted, "number");
    assert.strictEqual(typeof metrics.commandErrors, "number");
    assert.strictEqual(typeof metrics.queryErrors, "number");
  });

  it("should calculate average execution times", async () => {
    const handler = new TestCommandHandler();
    bus.registerCommandHandler(handler);

    const command = makeCommand();

    await bus.executeCommand(command);
    await bus.executeCommand(command);

    const metrics = bus.getMetrics();
    assert.ok(metrics.avgCommandExecutionTime >= 0);
  });

  it("should provide handlers information", () => {
    const cmdHandler = new TestCommandHandler();
    const qryHandler = new TestQueryHandler();

    bus.registerCommandHandler(cmdHandler);
    bus.registerQueryHandler(qryHandler);

    const info = bus.getHandlersInfo();

    assert.ok(Array.isArray(info.commands));
    assert.ok(Array.isArray(info.queries));
    assert.ok(info.commands.includes("test.command"));
    assert.ok(info.queries.includes("test.query"));
  });
});

describe("CQRSBus - Health Checks", { concurrency: 1 }, () => {
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

    assert.strictEqual(health.status, "healthy");
    assert.strictEqual(health.details.redis, true);
    assert.strictEqual(health.details.eventService, true);
  });

  it("should report unhealthy when EventService is down", async () => {
    mockEventService.setHealthy(false);

    const health = await bus.healthCheck();

    assert.strictEqual(health.status, "unhealthy");
    assert.strictEqual(health.details.eventService, false);
  });

  it("should include handler counts in health check", async () => {
    bus.registerCommandHandler(new TestCommandHandler());
    bus.registerQueryHandler(new TestQueryHandler());

    const health = await bus.healthCheck();

    assert.strictEqual(health.details.commandHandlers, 1);
    assert.strictEqual(health.details.queryHandlers, 1);
  });
});

describe("CQRSBus - Cache Management", { concurrency: 1 }, () => {
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

    assert.strictEqual(clearedCount, 2);
  });

  it("should clear cached queries matching pattern", async () => {
    await mockRedis.setex("cqrs:query:posts:1", 300, "data1");
    await mockRedis.setex("cqrs:query:posts:2", 300, "data2");
    await mockRedis.setex("cqrs:query:users:1", 300, "data3");

    const clearedCount = await bus.clearCache("cqrs:query:posts:*");

    assert.strictEqual(clearedCount, 2);
  });

  it("should return 0 when no cached queries to clear", async () => {
    const clearedCount = await bus.clearCache();

    assert.strictEqual(clearedCount, 0);
  });

  it("should return 0 when cache is disabled", async () => {
    const busNoCache = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableQueryCache: false,
    });

    const clearedCount = await busNoCache.clearCache();

    assert.strictEqual(clearedCount, 0);
  });
});

describe("CQRSBus - Shutdown", { concurrency: 1 }, () => {
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
    assert.strictEqual(info.commands.length, 0);
    assert.strictEqual(info.queries.length, 0);
  });

  it("should be idempotent", async () => {
    await bus.shutdown();
    await bus.shutdown();
  });
});

describe("CQRSBus - Query Handler Registration", { concurrency: 1 }, () => {
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
    assert.ok(handlersInfo.queries.includes("test.query"));
  });

  it("should prevent duplicate query handler registration", () => {
    const handler1 = new TestQueryHandler();
    const handler2 = new TestQueryHandler();

    bus.registerQueryHandler(handler1);

    assert.throws(() => bus.registerQueryHandler(handler2), /already registered/);
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
    assert.strictEqual(handlersInfo.queries.length, 2);
    assert.ok(handlersInfo.queries.includes("query.1"));
    assert.ok(handlersInfo.queries.includes("query.2"));
  });
});
