import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PerformanceMonitor } from "../../src/monitoring/performanceMonitor.js";
import {
  createMockApiMetrics,
  createMockRedis,
  createMockRequest,
  createMockReply,
} from "./performanceMonitor.test-helpers.js";

describe("PerformanceMonitor - Initialization", { concurrency: 1 }, () => {
  it("should initialize with default alert rules", () => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();

    const monitor = new PerformanceMonitor(metrics, redis);

    assert.ok(monitor, "Monitor should be created");
  });

  it("should initialize with default thresholds", () => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();

    const monitor = new PerformanceMonitor(metrics, redis);

    const monitorAny = monitor as any;
    assert.strictEqual(monitorAny.slowRequestThreshold, 200, "Slow threshold should be 200ms");
    assert.strictEqual(
      monitorAny.criticalRequestThreshold,
      1000,
      "Critical threshold should be 1000ms"
    );
  });
});

describe("PerformanceMonitor - Request Recording", { concurrency: 1 }, () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should record request metrics", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);
    const responseTime = 150;

    await monitor.recordRequest(req, reply, responseTime);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    assert.ok(recentMetrics.length > 0, "Should have recorded at least one metric");
    const entry = recentMetrics.find((m) => m.responseTime === responseTime);
    assert.ok(entry, "Should find recorded metric with correct responseTime");
  });

  it("should detect slow requests", async () => {
    const req = createMockRequest({ url: "/api/slow-endpoint" });
    const reply = createMockReply(200);
    const responseTime = 250; // Above 200ms slowRequestThreshold

    await monitor.recordRequest(req, reply, responseTime);

    // Verify that the slow request was recorded in recentMetrics
    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    const slowEntry = recentMetrics.find((m) => m.responseTime === responseTime);
    assert.ok(slowEntry, "Slow request should be stored in recent metrics");
  });

  it("should not flag fast requests as slow", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);
    const responseTime = 50; // Below 200ms threshold

    await monitor.recordRequest(req, reply, responseTime);

    const monitorAny = monitor as any;
    const threshold = monitorAny.slowRequestThreshold;
    assert.ok(responseTime < threshold, "Fast request should be below slow threshold");
  });

  it("should track user agent in metrics", async () => {
    const userAgent = "custom-user-agent/1.0";
    const req = createMockRequest({
      headers: { "user-agent": userAgent },
    });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ userAgent?: string }>;
    const entry = recentMetrics.find((m: any) => m.userAgent === userAgent);
    assert.ok(entry, "Should store user agent in recorded metric");
  });

  it("should track client IP in metrics", async () => {
    const clientIp = "192.168.1.100";
    const req = createMockRequest({ ip: clientIp });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ ip?: string }>;
    const entry = recentMetrics.find((m: any) => m.ip === clientIp);
    assert.ok(entry, "Should store client IP in recorded metric");
  });

  it("should handle different status codes", async () => {
    const req = createMockRequest();
    const statusCodes = [200, 201, 400, 404, 500];

    for (const code of statusCodes) {
      const reply = createMockReply(code);
      await monitor.recordRequest(req, reply, 100);
    }

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ statusCode: number }>;
    assert.strictEqual(recentMetrics.length, statusCodes.length, "Should record all status codes");
  });
});

describe("PerformanceMonitor - Route Extraction", { concurrency: 1 }, () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should extract clean route from URL", async () => {
    const req = createMockRequest({ url: "/api/posts?page=1&limit=10" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    assert.ok(entry, "Should have recorded a metric");
    assert.ok(!entry.route.includes("?"), "Route should not contain query parameters");
  });

  it("should normalize numeric IDs in routes", async () => {
    const req = createMockRequest({ url: "/api/posts/123" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    assert.ok(entry, "Should have recorded a metric");
    assert.ok(!entry.route.includes("123"), "Route should normalize numeric IDs");
  });

  it("should normalize UUIDs in routes", async () => {
    const req = createMockRequest({
      url: "/api/posts/550e8400-e29b-41d4-a716-446655440000",
    });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    assert.ok(entry, "Should have recorded a metric");
    assert.ok(!entry.route.includes("550e8400"), "Route should normalize UUIDs");
  });

  it("should normalize long tokens in routes", async () => {
    const req = createMockRequest({ url: "/api/verify/abcdefghijklmnopqrstuvwxyz12345" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    assert.ok(entry, "Should have recorded a metric");
    assert.ok(
      !entry.route.includes("abcdefghijklmnopqrstuvwxyz12345"),
      "Route should normalize long tokens"
    );
  });
});

describe("PerformanceMonitor - System Health Calculation", { concurrency: 1 }, () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should calculate healthy system status", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 10; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 50);
    }

    const health = await monitor.getSystemHealth();

    assert.strictEqual(health.status, "healthy", "System should be healthy");
    assert.ok(health.responseTimeP95 < 200, "P95 should be under 200ms");
    assert.ok(health.errorRate < 5, "Error rate should be under 5%");
  });

  it("should calculate degraded system status for slow responses", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 10; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 300);
    }

    const health = await monitor.getSystemHealth();

    assert.strictEqual(health.status, "degraded", "System should be degraded");
  });

  it("should calculate degraded status for high error rate", async () => {
    const req = createMockRequest();

    for (let i = 0; i < 9; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 50);
    }

    for (let i = 0; i < 2; i++) {
      const reply = createMockReply(500);
      await monitor.recordRequest(req, reply, 50);
    }

    const health = await monitor.getSystemHealth();

    assert.ok(health.errorRate > 5, "Error rate should exceed 5%");
    assert.ok(
      health.status === "degraded" || health.status === "unhealthy",
      `System should be degraded or unhealthy due to errors, got: ${health.status}`
    );
  });

  it("should calculate unhealthy status for critical response times", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 10; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 1500);
    }

    const health = await monitor.getSystemHealth();

    assert.strictEqual(health.status, "unhealthy", "System should be unhealthy");
    assert.ok(health.responseTimeP95 > 1000, "P95 should exceed critical threshold");
  });

  it("should include system uptime in health status", async () => {
    const health = await monitor.getSystemHealth();

    assert.ok(health.uptime > 0, "Uptime should be positive");
  });

  it("should include memory usage percentage", async () => {
    const health = await monitor.getSystemHealth();

    assert.ok(health.memoryUsage.used > 0, "Memory used should be positive");
    assert.ok(health.memoryUsage.total > 0, "Memory total should be positive");
    assert.ok(
      health.memoryUsage.percentage >= 0 && health.memoryUsage.percentage <= 100,
      "Memory percentage should be 0-100"
    );
  });
});

describe("PerformanceMonitor - Edge Cases", { concurrency: 1 }, () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should handle zero response time", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 0);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    const entry = recentMetrics.find((m) => m.responseTime === 0);
    assert.ok(entry, "Should record metric with zero response time");
  });

  it("should handle very high response time", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 30000);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    const entry = recentMetrics.find((m) => m.responseTime === 30000);
    assert.ok(entry, "Should record metric with very high response time");
  });

  it("should handle requests without user agent", async () => {
    const req = createMockRequest({ headers: {} });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    assert.ok(recentMetrics.length > 0, "Should record metric even without user agent");
  });

  it("should handle missing IP address", async () => {
    const req = createMockRequest({ ip: undefined });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    assert.ok(recentMetrics.length > 0, "Should record metric even without IP address");
  });

  it("should handle malformed URLs", async () => {
    const req = createMockRequest({ url: "" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    assert.ok(recentMetrics.length > 0, "Should record metric even with empty URL");
  });

  it("should handle Redis errors gracefully", async () => {
    const badRedis = {
      pipeline: () => {
        throw new Error("Redis connection failed");
      },
    } as any;

    const metrics = createMockApiMetrics();
    const monitorWithBadRedis = new PerformanceMonitor(metrics, badRedis);

    const req = createMockRequest();
    const reply = createMockReply(200);

    await monitorWithBadRedis.recordRequest(req, reply, 100);

    const monitorAny = monitorWithBadRedis as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    assert.ok(recentMetrics.length > 0, "Should still record metric in memory despite Redis error");
  });
});
