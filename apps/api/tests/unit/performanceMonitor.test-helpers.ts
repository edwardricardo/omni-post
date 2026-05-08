/**
 * @file performanceMonitor.test-helpers.ts
 * @description Test helpers for performance monitor test helpers
 * @layer infrastructure
 */
import type { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type Redis from "ioredis";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { PerformanceMonitor } from "../../src/monitoring/performanceMonitor.js";

/**
 * Build a PerformanceMonitor for tests with a Noop scheduler wired in.
 * Matches the current production constructor `(metrics, redis, scheduler)`.
 */
export function createPerformanceMonitor(metrics: ApiMetrics, redis: Redis): PerformanceMonitor {
  return new PerformanceMonitor(metrics, redis, new NoopBackgroundTaskScheduler());
}

export function createMockApiMetrics(): ApiMetrics {
  const recordRequestFn = () => (_statusCode: number) => {};

  return {
    recordRequest: recordRequestFn,
    metrics: {
      apiHealth: { set: () => {} },
    } as any,
  } as any;
}

export function createMockRedis(): Redis {
  const store = new Map<string, string | string[]>();

  return {
    pipeline: () => {
      const commands: any[] = [];
      return {
        hincrby: (key: string, field: string, value: number) => {
          commands.push({ cmd: "hincrby", key, field, value });
          return this;
        },
        lpush: (key: string, ...values: string[]) => {
          commands.push({ cmd: "lpush", key, values });
          return this;
        },
        ltrim: (key: string, start: number, stop: number) => {
          commands.push({ cmd: "ltrim", key, start, stop });
          return this;
        },
        expire: (key: string, seconds: number) => {
          commands.push({ cmd: "expire", key, seconds });
          return this;
        },
        exec: async () => {
          commands.forEach((cmd) => {
            if (cmd.cmd === "lpush") {
              const existing = store.get(cmd.key);
              if (Array.isArray(existing)) {
                store.set(cmd.key, [...cmd.values, ...existing]);
              } else {
                store.set(cmd.key, cmd.values);
              }
            }
          });
          return commands.map(() => [null, "OK"]);
        },
      };
    },
    lrange: async (key: string, start: number, stop: number) => {
      const data = store.get(key);
      if (Array.isArray(data)) {
        return data.slice(start, stop + 1);
      }
      return [];
    },
    lpush: async (key: string, ...values: string[]) => {
      const existing = store.get(key);
      if (Array.isArray(existing)) {
        store.set(key, [...values, ...existing]);
      } else {
        store.set(key, values);
      }
      return values.length;
    },
    ltrim: async (key: string, start: number, stop: number) => {
      const data = store.get(key);
      if (Array.isArray(data)) {
        store.set(key, data.slice(start, stop + 1));
      }
      return "OK";
    },
  } as any;
}

export function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "GET",
    url: "/api/posts",
    headers: {
      "user-agent": "test-agent",
    },
    ip: "127.0.0.1",
    ...overrides,
  } as FastifyRequest;
}

export function createMockReply(statusCode: number = 200): FastifyReply {
  return {
    statusCode,
    send: function (_payload?: any) {
      return this;
    },
  } as any;
}
