/**
 * @file redisConnectionErrorListeners.test.ts
 * @description Pins that every Redis connection and BullMQ queue the composition root builds
 *   logs its errors through the throttled listener: the ten connections of `setupServices`, the
 *   connection and queue of `setupBillingUseCases` and the three role connections of
 *   `registerRedisConnections`. Each factory is run against a container double with Redis, its
 *   subscriber duplicate and BullMQ's Queue stubbed, so no socket opens. The same error is handed
 *   twice to the listener the site attached, and the observable result is the lines the `redis`
 *   logger receives: exactly one, carrying the connection's name, so a site that discards the
 *   error, or logs it unthrottled, fails. It also pins that the connections keep the options
 *   they had.
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
    const connection = {
      on: vi.fn(),
      psubscribe: vi.fn(),
      subscribe: vi.fn(),
      publish: vi.fn(),
      quit: vi.fn(),
    };
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

/** Hands `error` to the `error` listener attached to `connection`, twice. */
function emitErrorTwice(connection: { on: ReturnType<typeof vi.fn> }, error: Error): void {
  const listener = connection.on.mock.calls.find(([event]) => event === "error")?.[1] as
    ((error: unknown) => void) | undefined;
  if (listener === undefined) {
    throw new Error("no error listener attached to the connection");
  }
  listener(error);
  listener(error);
}

/** The one line a throttled listener writes for `ERROR` on the connection `name`. */
function expectOneLine(name: string): void {
  expect(redisLogger.error.mock.calls).toEqual([
    [
      {
        err: expect.objectContaining({ type: "Error", message: ERROR.message }),
        connection: name,
        suppressed: 0,
      },
      "Connection error",
    ],
  ]);
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
    [TOKENS.RealtimeWebhookBroadcaster, "redis:realtime-webhook-broadcaster"],
    [TOKENS.ContentVersionManager, "redis:content-version-manager"],
    [TOKENS.PlatformContentAdapter, "redis:platform-content-adapter"],
    [TOKENS.SyncEngine, "redis:sync-engine"],
    [TOKENS.NotificationBroadcaster, "redis:notification-broadcaster"],
    [TOKENS.AnalyticsStreamBroadcaster, "redis:analytics-stream-broadcaster"],
    [TOKENS.BruteForceProtectionPort, "redis:brute-force-protection"],
    [TOKENS.MfaChallengeStore, "redis:mfa-challenge-store"],
  ])("logs one line for two errors of a setupServices connection (%s)", (token, name) => {
    const { container, factories } = makeContainer();
    setupServices(container);
    const connection = connectionCreatedBy(factories, token);

    emitErrorTwice(connection, ERROR);

    expectOneLine(name);
  });

  it("logs one line for two errors of the gateway switch job service's connection (setupBillingUseCases)", () => {
    const { container, factories } = makeContainer();
    setupBillingUseCases(container);
    const connection = connectionCreatedBy(factories, TOKENS.GatewaySwitchJobService);

    emitErrorTwice(connection, ERROR);

    expectOneLine("redis:gateway-switch-job-service");
  });

  it.each([
    [TOKENS.BullMQWorkerConnection, "redis:bullmq-worker"],
    [TOKENS.SagaSubscriberConnection, "redis:saga-subscriber"],
    [TOKENS.AnalyticsRedisConnection, "redis:analytics"],
  ])(
    "logs one line for two errors of a role connection (registerRedisConnections, %s)",
    (token, name) => {
      const { container, factories } = makeContainer();
      registerRedisConnections(container);
      const connection = connectionCreatedBy(factories, token);

      emitErrorTwice(connection, ERROR);

      expectOneLine(name);
    }
  );

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

  it("logs one line for two errors the gateway switch job queue emits", () => {
    const { container, factories } = makeContainer();
    setupBillingUseCases(container);
    factories.get(TOKENS.GatewaySwitchJobService)?.();
    const queue = queues[0];

    expect(() => {
      queue?.emitter.emit("error", ERROR);
      queue?.emitter.emit("error", ERROR);
    }).not.toThrow();
    expectOneLine("bullmq-queue:gateway-switch");
  });

  it("still creates the notification and job service connections with the default options", () => {
    const services = makeContainer();
    setupServices(services.container);
    services.factories.get(TOKENS.NotificationBroadcaster)?.();
    const billing = makeContainer();
    setupBillingUseCases(billing.container);
    billing.factories.get(TOKENS.GatewaySwitchJobService)?.();

    expect(vi.mocked(createRedisConnection).mock.calls).toEqual([[], []]);
  });
});
