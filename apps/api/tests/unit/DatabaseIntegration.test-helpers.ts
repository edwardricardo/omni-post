/**
 * Shared test helpers for DatabaseIntegration tests
 */

import type { TestContext } from "node:test";

export function createMockFastify(t: TestContext) {
  const routes: any[] = [];

  return {
    get: t.mock.fn((path: string, handler: any) => {
      routes.push({ method: "GET", path, handler });
    }),
    post: t.mock.fn((path: string, handler: any) => {
      routes.push({ method: "POST", path, handler });
    }),
    delete: t.mock.fn((path: string, handler: any) => {
      routes.push({ method: "DELETE", path, handler });
    }),
    addHook: t.mock.fn(),
    routes,
  };
}

export function createMockEventService(t: TestContext) {
  return {
    publishEvent: t.mock.fn(async () => undefined),
  };
}

export function createMockCache(t: TestContext) {
  const cache = new Map<string, any>();

  return {
    get: t.mock.fn(async <_T>(key: string) => {
      const value = cache.get(key);
      return { ok: true, value: value ?? null };
    }),
    set: t.mock.fn(async <_T>(key: string, value: _T, _options?: any) => {
      cache.set(key, value);
      return { ok: true };
    }),
    invalidateByTag: t.mock.fn(async (_tag: string) => {
      return { ok: true };
    }),
    clear: () => cache.clear(),
    cache,
  };
}

export function createMockRedis(t: TestContext) {
  return {
    get: t.mock.fn(async () => null),
    set: t.mock.fn(async () => "OK"),
    del: t.mock.fn(async () => 1),
  };
}

export function createMockConnectionManager(t: TestContext) {
  return {
    executeQuery: t.mock.fn(async <T>(query: (client: any) => Promise<T>, _options?: any) => {
      return query(null);
    }),
    executeTransaction: t.mock.fn(
      async <T>(transaction: (client: any) => Promise<T>, _options?: any) => {
        return transaction(null);
      }
    ),
    healthCheck: t.mock.fn(async () => ({
      status: "healthy" as const,
      primary: true,
      replicas: [],
      metrics: {
        totalConnections: 1,
        activeConnections: 0,
        idleConnections: 1,
        queuedRequests: 0,
        averageQueryTime: 5,
        slowQueries: 0,
        failedConnections: 0,
        connectionErrors: 0,
        replicaHealth: new Map<string, boolean>(),
      },
      lastCheck: new Date(),
    })),
    getConnectionStats: t.mock.fn(() => ({
      totalConnections: 1,
      activeConnections: 0,
      idleConnections: 1,
      queuedRequests: 0,
      averageQueryTime: 5,
      slowQueries: 0,
      failedConnections: 0,
      connectionErrors: 0,
      replicaHealth: new Map<string, boolean>(),
      queryPerformance: {
        averageQueryTime: 5,
        p95QueryTime: 10,
        p99QueryTime: 20,
        slowQueryRate: 0,
      },
      connectionUtilization: {
        utilizationRate: 5,
        queueUtilization: 0,
        errorRate: 0,
      },
    })),
    scaleConnectionPool: t.mock.fn(async (_size: number) => undefined),
    addReplica: t.mock.fn(async (_url: string, _weight?: number, _priority?: number) => undefined),
    removeReplica: t.mock.fn(async (_url: string) => undefined),
    shutdown: t.mock.fn(async () => undefined),
  };
}

export function createConfig(t: TestContext) {
  return {
    fastify: createMockFastify(t) as any,
    eventService: createMockEventService(t) as any,
    cache: createMockCache(t) as any,
    redis: createMockRedis(t) as any,
    connectionManager: createMockConnectionManager(t) as any,
  };
}
