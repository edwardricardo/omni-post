/**
 * @file healthConnection.unit.test.ts
 * @description Pins the workers' health connection: built on the given URL with the probe's
 *   options, and logging its errors through the throttled listener (two identical errors, one
 *   line) with a recovery line when it is ready again. ioredis is stubbed with an EventEmitter,
 *   as the real client is, so no socket opens.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { clients } = vi.hoisted(() => ({
  clients: [] as Array<{
    url: string;
    options: unknown;
    emitter: import("node:events").EventEmitter;
  }>,
}));

vi.mock("ioredis", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return {
    Redis: vi.fn(function MockRedis(url: string, options: unknown) {
      const emitter = new Emitter();
      clients.push({ url, options, emitter });
      return emitter;
    }),
  };
});

const { createHealthRedisConnection } = await import("../../src/healthConnection.js");

const REDIS_URL = "redis://redis.test:6380";

function makeLogger() {
  return { error: vi.fn(), info: vi.fn() };
}

describe("createHealthRedisConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clients.length = 0;
  });

  it("logs one line for two errors and reports the connection ready again", () => {
    const logger = makeLogger();
    createHealthRedisConnection(REDIS_URL, logger);
    const client = clients[0];
    const error = new Error("connect ECONNREFUSED 127.0.0.1:6380");

    client?.emitter.emit("error", error);
    client?.emitter.emit("error", error);
    client?.emitter.emit("ready");

    expect(logger.error.mock.calls).toEqual([
      [
        {
          err: expect.objectContaining({ type: "Error", message: error.message }),
          connection: "redis:workers-health",
          suppressed: 0,
        },
        "Connection error",
      ],
    ]);
    expect(logger.info.mock.calls).toEqual([
      [{ connection: "redis:workers-health", suppressed: 1 }, "Connection ready again"],
    ]);
  });

  it("builds the client on the given URL with the probe's options", () => {
    createHealthRedisConnection(REDIS_URL, makeLogger());

    expect(clients.map(({ url, options }) => ({ url, options }))).toEqual([
      {
        url: REDIS_URL,
        options: {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          commandTimeout: 5_000,
          connectTimeout: 5_000,
        },
      },
    ]);
  });
});
