/**
 * @file registerBootstrapConnections.test.ts
 * @description Pins the Redis-backed objects the API bootstrap builds outside the container:
 *   the shared API connection, the admin routes' publish queue and the gateway switch
 *   processor's connection. Each must log the errors it emits through the throttled listener
 *   instead of leaving them unhandled or unlistened, and each must still be built with the
 *   options it had. Redis and BullMQ's Queue are stubbed with EventEmitters, so no socket opens.
 * @layer infrastructure
 */

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { connections, queues } = vi.hoisted(() => ({
  connections: [] as Array<{ options: unknown; emitter: import("node:events").EventEmitter }>,
  queues: [] as Array<{
    name: string;
    options: unknown;
    emitter: import("node:events").EventEmitter;
  }>,
}));

vi.mock("../../../../src/lib/redis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/redis.js")>();
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    ...actual,
    getRedisUrl: () => "redis://:s3cret@redis.test:6380",
    createRedisConnection: vi.fn((options?: unknown) => {
      const emitter = new Emitter();
      connections.push({ options, emitter });
      return emitter;
    }),
  };
});

vi.mock("bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bullmq")>();
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    ...actual,
    Queue: vi.fn(function MockQueue(name: string, options: unknown) {
      const emitter = new Emitter();
      queues.push({ name, options, emitter });
      return emitter;
    }),
  };
});

const {
  createAdminPublishQueue,
  createApiRedisConnection,
  createGatewaySwitchProcessorConnection,
} = await import("../../../../src/infrastructure/container/registerBootstrapConnections.js");

function makeLogger() {
  return { error: vi.fn(), info: vi.fn() };
}

const ERROR = new Error("connect ECONNREFUSED 127.0.0.1:6379");

/** Emits `ERROR` twice on `emitter` and returns whether an emit threw. */
function emitTwiceThrows(emitter: EventEmitter): boolean {
  try {
    emitter.emit("error", ERROR);
    emitter.emit("error", ERROR);
    return false;
  } catch {
    return true;
  }
}

/** The one line a throttled listener writes for two `ERROR`s on the source `name`. */
function oneLine(name: string) {
  return [
    [
      {
        err: expect.objectContaining({ type: "Error", message: ERROR.message }),
        connection: name,
        suppressed: 0,
      },
      "Connection error",
    ],
  ];
}

describe("bootstrap connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections.length = 0;
    queues.length = 0;
  });

  it("logs one line for two errors of the shared API connection", () => {
    const logger = makeLogger();
    createApiRedisConnection(logger);
    const connection = connections[0];

    expect(connection ? emitTwiceThrows(connection.emitter) : true).toBe(false);
    expect(logger.error.mock.calls).toEqual(oneLine("redis:api"));
  });

  it("logs one line for two errors of the gateway switch processor's connection", () => {
    const logger = makeLogger();
    createGatewaySwitchProcessorConnection(logger);
    const connection = connections[0];

    expect(connection ? emitTwiceThrows(connection.emitter) : true).toBe(false);
    expect(logger.error.mock.calls).toEqual(oneLine("redis:gateway-switch-processor"));
  });

  it("logs one line for two errors the admin publish queue emits", () => {
    const logger = makeLogger();
    createAdminPublishQueue(logger);
    const queue = queues[0];

    expect(queue ? emitTwiceThrows(queue.emitter) : true).toBe(false);
    expect(logger.error.mock.calls).toEqual(oneLine("bullmq-queue:admin-publish"));
  });

  it("builds each object with the options it had", () => {
    const logger = makeLogger();
    createApiRedisConnection(logger);
    createGatewaySwitchProcessorConnection(logger);
    createAdminPublishQueue(logger);

    expect(connections.map((connection) => connection.options)).toEqual([
      undefined,
      { maxRetriesPerRequest: null },
    ]);
    expect(queues.map(({ name, options }) => ({ name, options }))).toEqual([
      {
        name: "publish",
        options: {
          connection: {
            host: "redis.test",
            port: 6380,
            password: "s3cret",
            lazyConnect: true,
            enableOfflineQueue: true,
          },
        },
      },
    ]);
  });
});
