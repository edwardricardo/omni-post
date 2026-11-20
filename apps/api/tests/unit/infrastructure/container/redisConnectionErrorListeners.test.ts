/**
 * @file redisConnectionErrorListeners.test.ts
 * @description Pins that the Redis connections and BullMQ queues the composition root builds
 *   log their errors through the throttled listener instead of discarding them or leaving them
 *   unlistened: sites of `setupServices` (the notification broadcaster's connection and the two
 *   rate limiters' connections), of `setupBillingUseCases` (the gateway switch job service's
 *   connection and queue) and of `registerRedisConnections` (the three role connections). Each
 *   factory is run against a container double with Redis, its subscriber duplicate and BullMQ's
 *   Queue stubbed, so no socket opens; the error the stub emits is handed to the listener the
 *   site attached, and the line the `redis` logger receives is the observable result. It also
 *   pins that the connections are still created with the options they had.
 * @layer infrastructure
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

// The sites build their logger while the setup function runs, so the doubles live in the
// hoisted scope the mock factories below read.
const { redisLogger, connections, queues } = vi.hoisted(() => ({
  redisLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  connections: [] as Array<{ on: ReturnType<typeof vi.fn> }>,
  queues: [] as Array<{ name: string; emitter: import("node:events").EventEmitter }>,
}));

vi.mock("../../../../src/lib/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/logger.js")>();
  return {
    ...actual,
    createLogger: (name: string) => (name === "redis" ? redisLogger : actual.createLogger(name)),
  };
});

vi.mock("../../../../src/lib/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/redis.js")>();
  const makeConnection = () => {
    const connection = { on: vi.fn(), psubscribe: vi.fn(), publish: vi.fn(), quit: vi.fn() };
    connections.push(connection);
    return connection;
  };
  return {
    ...actual,
    createRedisConnection: vi.fn(makeConnection),
    duplicateForSubscriber: vi.fn(makeConnection),
  };
});

vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  return {
    ...actual,
    Queue: vi.fn(function MockQueue(name: string) {
      const emitter = Object.assign(new EventEmitter(), { close: vi.fn() });
      queues.push({ name, emitter });
      return emitter;
    }),
  };
});

const { createRedisConnection } = await import("../../../../src/lib/redis.js");
const { setupServices } = await import("../../../../src/infrastructure/container/setupServices.js");
const { setupBillingUseCases } =
  await import("../../../../src/infrastructure/container/setupBillingUseCases.js");
const { registerRedisConnections } =
  await import("../../../../src/infrastructure/container/registerRedisConnections.js");

const ERROR = new Error("connect ECONNREFUSED 127.0.0.1:6379");

type Factory = () => unknown;

/** A container double that records factories and answers every resolve with a scheduler double. */
function makeContainer() {
  const factories = new Map<symbol, Factory>();
  const container = {
    register: vi.fn((token: symbol, factory: Factory) => {
      factories.set(token, factory);
    }),
    registerInstance: vi.fn(),
    resolve: vi.fn(() => ({ register: vi.fn(), unregister: vi.fn() })),
  } as unknown as Container;
  return { container, factories };
}

/** Runs the factory registered under `token` and returns the first connection it created. */
function connectionCreatedBy(factories: Map<symbol, Factory>, token: symbol) {
  const factory = factories.get(token);
  if (factory === undefined) {
    throw new Error(`no factory registered for ${token.toString()}`);
  }
  factory();
  const connection = connections[0];
  if (connection === undefined) {
    throw new Error(`the factory for ${token.toString()} created no Redis connection`);
  }
  return connection;
}

/** Hands `error` to the `error` listener attached to `connection`. */
function emitError(connection: { on: ReturnType<typeof vi.fn> }, error: Error): void {
  const listener = connection.on.mock.calls.find(([event]) => event === "error")?.[1] as
    ((error: unknown) => void) | undefined;
  if (listener === undefined) {
    throw new Error("no error listener attached to the connection");
  }
  listener(error);
}

describe("Redis connection error listeners of the composition root", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections.length = 0;
    queues.length = 0;
  });

  it.each([
    [TOKENS.RateLimiterPort, "redis:ai-provider-rate-limiter"],
    [TOKENS.HttpRateLimiter, "redis:http-rate-limiter"],
  ])("logs an error of a rate limiter's connection (setupServices, %s)", (token, name) => {
    const { container, factories } = makeContainer();
    setupServices(container);
    const connection = connectionCreatedBy(factories, token);

    emitError(connection, ERROR);

    expect(redisLogger.error).toHaveBeenCalledWith(
      { err: ERROR, connection: name, suppressed: 0 },
      "Connection error"
    );
  });

  it.each([
    [TOKENS.BullMQWorkerConnection, "redis:bullmq-worker"],
    [TOKENS.SagaSubscriberConnection, "redis:saga-subscriber"],
    [TOKENS.AnalyticsRedisConnection, "redis:analytics"],
  ])("logs an error of a role connection (registerRedisConnections, %s)", (token, name) => {
    const { container, factories } = makeContainer();
    registerRedisConnections(container);
    const connection = connectionCreatedBy(factories, token);

    emitError(connection, ERROR);

    expect(redisLogger.error).toHaveBeenCalledWith(
      { err: ERROR, connection: name, suppressed: 0 },
      "Connection error"
    );
  });

  it("still registers each role connection with its options and returns it", () => {
    const { container, factories } = makeContainer();
    registerRedisConnections(container);

    const returned = [
      TOKENS.BullMQWorkerConnection,
      TOKENS.SagaSubscriberConnection,
      TOKENS.AnalyticsRedisConnection,
    ].map((token) => factories.get(token)?.());

    expect(returned).toEqual(connections);
    expect(vi.mocked(createRedisConnection).mock.calls).toEqual([
      [{ maxRetriesPerRequest: null }],
      [{ maxRetriesPerRequest: null }],
      [],
    ]);
  });

  it("logs an error the gateway switch job queue emits instead of leaving it unhandled", () => {
    const { container, factories } = makeContainer();
    setupBillingUseCases(container);
    factories.get(TOKENS.GatewaySwitchJobService)?.();
    const queue = queues[0];

    expect(() => queue?.emitter.emit("error", ERROR)).not.toThrow();
    expect(redisLogger.error).toHaveBeenCalledWith(
      { err: ERROR, connection: "bullmq-queue:gateway-switch", suppressed: 0 },
      "Connection error"
    );
  });

  it("logs an error of the notification broadcaster's connection (setupServices)", () => {
    const { container, factories } = makeContainer();
    setupServices(container);
    const connection = connectionCreatedBy(factories, TOKENS.NotificationBroadcaster);
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");

    emitError(connection, error);

    expect(redisLogger.error).toHaveBeenCalledWith(
      { err: error, connection: "redis:notification-broadcaster", suppressed: 0 },
      "Connection error"
    );
  });

  it("logs an error of the gateway switch job service's connection (setupBillingUseCases)", () => {
    const { container, factories } = makeContainer();
    setupBillingUseCases(container);
    const connection = connectionCreatedBy(factories, TOKENS.GatewaySwitchJobService);
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6379");

    emitError(connection, error);

    expect(redisLogger.error).toHaveBeenCalledWith(
      { err: error, connection: "redis:gateway-switch-job-service", suppressed: 0 },
      "Connection error"
    );
  });

  it("still creates both connections with the default options", () => {
    const services = makeContainer();
    setupServices(services.container);
    services.factories.get(TOKENS.NotificationBroadcaster)?.();
    const billing = makeContainer();
    setupBillingUseCases(billing.container);
    billing.factories.get(TOKENS.GatewaySwitchJobService)?.();

    expect(vi.mocked(createRedisConnection).mock.calls).toEqual([[], []]);
  });
});
