/**
 * Shared test helpers for DatabaseIntegration tests
 */

export function createMockFastify() {
  const routes: any[] = [];

  return {
    get: vi.fn((path: string, handler: any) => {
      routes.push({ method: "GET", path, handler });
    }),
    post: vi.fn((path: string, handler: any) => {
      routes.push({ method: "POST", path, handler });
    }),
    delete: vi.fn((path: string, handler: any) => {
      routes.push({ method: "DELETE", path, handler });
    }),
    addHook: vi.fn(),
    routes,
  };
}

export function createMockEventService() {
  return {
    publishEvent: vi.fn(async () => undefined),
  };
}

export function createMockCache() {
  const cache = new Map<string, any>();

  return {
    get: vi.fn(async <_T>(key: string) => {
      const value = cache.get(key);
      return { ok: true, value: value ?? null };
    }),
    set: vi.fn(async <_T>(key: string, value: _T, _options?: any) => {
      cache.set(key, value);
      return { ok: true };
    }),
    invalidateByTag: vi.fn(async (_tag: string) => {
      return { ok: true };
    }),
    clear: () => cache.clear(),
    cache,
  };
}

export function createMockRedis() {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  };
}

export function createMockConnectionManager() {
  return {
    executeQuery: vi.fn(async <T>(query: (client: any) => Promise<T>, _options?: any) => {
      return query(null);
    }),
    executeTransaction: vi.fn(
      async <T>(transaction: (client: any) => Promise<T>, _options?: any) => {
        return transaction(null);
      }
    ),
    healthCheck: vi.fn(async () => ({
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
    getConnectionStats: vi.fn(() => ({
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
    scaleConnectionPool: vi.fn(async (_size: number) => undefined),
    addReplica: vi.fn(async (_url: string, _weight?: number, _priority?: number) => undefined),
    removeReplica: vi.fn(async (_url: string) => undefined),
    shutdown: vi.fn(async () => undefined),
  };
}

export function createConfig() {
  return {
    fastify: createMockFastify() as any,
    eventService: createMockEventService() as any,
    cache: createMockCache() as any,
    redis: createMockRedis() as any,
    connectionManager: createMockConnectionManager() as any,
  };
}
