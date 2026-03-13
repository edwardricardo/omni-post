import { describe, it, beforeEach, expect } from "vitest";
import { CQRSBusImpl } from "../../src/cqrs/CQRSBus";
import type { CommandHandler, CommandResult } from "@shared/cqrs";
import {
  MockRedis,
  MockEventService,
  TestCommandHandler,
  TestQueryHandler,
  makeCommand,
  makeQuery,
} from "./CQRSBus.test-helpers.js";

describe("CQRSBus - Command Handler Registration", () => {
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

  it("should register a command handler successfully", () => {
    const handler = new TestCommandHandler();
    bus.registerCommandHandler(handler);

    const handlersInfo = bus.getHandlersInfo();
    expect(handlersInfo.commands.includes("test.command")).toBeTruthy();
  });

  it("should prevent duplicate command handler registration", () => {
    const handler1 = new TestCommandHandler();
    const handler2 = new TestCommandHandler();

    bus.registerCommandHandler(handler1);

    expect(() => bus.registerCommandHandler(handler2)).toThrow(/already registered/);
  });

  it("should register multiple different command handlers", () => {
    class Handler1 implements CommandHandler {
      readonly commandType = "command.1";
      async handle(): Promise<CommandResult> {
        return { success: true };
      }
    }

    class Handler2 implements CommandHandler {
      readonly commandType = "command.2";
      async handle(): Promise<CommandResult> {
        return { success: true };
      }
    }

    bus.registerCommandHandler(new Handler1());
    bus.registerCommandHandler(new Handler2());

    const handlersInfo = bus.getHandlersInfo();
    expect(handlersInfo.commands.length).toBe(2);
    expect(handlersInfo.commands.includes("command.1")).toBeTruthy();
    expect(handlersInfo.commands.includes("command.2")).toBeTruthy();
  });
});

describe("CQRSBus - Command Execution", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;
  let handler: TestCommandHandler;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableMetrics: true,
      enableQueryCache: true,
    });
    handler = new TestCommandHandler();
    bus.registerCommandHandler(handler);
  });

  it("should execute command successfully", async () => {
    const command = makeCommand();

    const result = await bus.executeCommand(command);

    expect(result.success).toBeTruthy();
    expect(handler.callCount).toBe(1);
  });

  it("should return error when handler not found", async () => {
    const command = makeCommand({ type: "unknown.command" });

    const result = await bus.executeCommand(command);

    expect(result.success).toBe(false);
    expect(result.error?.includes("No handler registered")).toBeTruthy();
  });

  it("should handle command execution errors gracefully", async () => {
    handler.shouldFail = true;

    const command = makeCommand();

    const result = await bus.executeCommand(command);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(handler.callCount).toBe(1);
  });

  it("should publish events after successful command", async () => {
    handler.shouldGenerateEvents = true;

    const command = makeCommand();

    const result = await bus.executeCommand(command);

    expect(result.success).toBeTruthy();
    expect(mockEventService.events.length).toBe(1);
    expect(mockEventService.events[0]!.type).toBe("test.event");
  });

  it("should not publish events if command fails", async () => {
    handler.shouldFail = true;
    handler.shouldGenerateEvents = true;

    const command = makeCommand();

    await bus.executeCommand(command);

    expect(mockEventService.events.length).toBe(0);
  });

  it("should update command metrics after execution", async () => {
    const command = makeCommand();

    await bus.executeCommand(command);

    const metrics = bus.getMetrics();
    expect(metrics.commandsExecuted).toBe(1);
    expect(metrics.commandErrors).toBe(0);
  });

  it("should track command errors in metrics", async () => {
    handler.shouldFail = true;

    const command = makeCommand();

    await bus.executeCommand(command);

    const metrics = bus.getMetrics();
    expect(metrics.commandsExecuted).toBe(1);
    expect(metrics.commandErrors).toBe(1);
  });
});

describe("CQRSBus - Query Execution and Caching", () => {
  let bus: CQRSBusImpl;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;
  let handler: TestQueryHandler;

  beforeEach(() => {
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();
    bus = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableMetrics: true,
      enableQueryCache: true,
    });
    handler = new TestQueryHandler();
    bus.registerQueryHandler(handler);
  });

  it("should execute query successfully", async () => {
    const query = makeQuery();

    const result = await bus.executeQuery(query);

    expect(result.success).toBeTruthy();
    expect(handler.callCount).toBe(1);
  });

  it("should return error when query handler not found", async () => {
    const query = makeQuery({ type: "unknown.query" });

    const result = await bus.executeQuery(query);

    expect(result.success).toBe(false);
    expect(result.error?.includes("No handler registered")).toBeTruthy();
  });

  it("should handle query execution errors gracefully", async () => {
    handler.shouldFail = true;

    const query = makeQuery();

    const result = await bus.executeQuery(query);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("should cache successful query results with cache key", async () => {
    const query = {
      id: "qry-1",
      type: "test.query",
      data: { filter: "test" },
      metadata: {
        correlationId: "corr-1",
        source: "test",
        cacheKey: "test-cache-key",
        cacheTtl: 60,
      },
      timestamp: new Date(),
    };

    const result = await bus.executeQuery(query);

    expect(result.success).toBeTruthy();
    expect(result.metadata?.fromCache).toBe(false);

    const cachedData = await mockRedis.get("cqrs:query:test-cache-key");
    expect(cachedData).toBeTruthy();
  });

  it("should return cached results on subsequent queries", async () => {
    const query = makeQuery({ cacheKey: "test-cache-key" });

    await bus.executeQuery(query);
    expect(handler.callCount).toBe(1);

    const result = await bus.executeQuery(query);
    expect(result.success).toBeTruthy();
    expect(result.metadata?.fromCache).toBe(true);
    expect(handler.callCount).toBe(1);
  });

  it("should skip caching when cache is disabled", async () => {
    const busNoCache = new CQRSBusImpl({
      eventService: mockEventService as any,
      redis: mockRedis as any,
      enableQueryCache: false,
    });
    busNoCache.registerQueryHandler(handler);

    const query = makeQuery({ cacheKey: "test-cache-key" });

    await busNoCache.executeQuery(query);
    await busNoCache.executeQuery(query);

    expect(handler.callCount).toBe(2);
  });

  it("should update query metrics after execution", async () => {
    const query = makeQuery();

    await bus.executeQuery(query);

    const metrics = bus.getMetrics();
    expect(metrics.queriesExecuted).toBe(1);
    expect(metrics.queryErrors).toBe(0);
  });

  it("should track cache hits and misses", async () => {
    const query = makeQuery({ cacheKey: "test-key" });

    await bus.executeQuery(query);
    let metrics = bus.getMetrics();
    expect(metrics.cacheMisses).toBe(1);
    expect(metrics.cacheHits).toBe(0);

    await bus.executeQuery(query);
    metrics = bus.getMetrics();
    expect(metrics.cacheHits).toBe(1);
  });
});
