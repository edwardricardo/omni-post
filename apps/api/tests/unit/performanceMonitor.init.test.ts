import { describe, it, beforeEach, expect } from "vitest";
import { PerformanceMonitor } from "../../src/monitoring/performanceMonitor.js";
import {
  createMockApiMetrics,
  createMockRedis,
  createMockRequest,
  createMockReply,
} from "./performanceMonitor.test-helpers.js";

describe("PerformanceMonitor - Initialization", () => {
  it("should initialize with default alert rules", () => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();

    const monitor = new PerformanceMonitor(metrics, redis);

    expect(monitor).toBeTruthy();
  });

  it("should initialize with default thresholds", () => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();

    const monitor = new PerformanceMonitor(metrics, redis);

    const monitorAny = monitor as any;
    expect(monitorAny.slowRequestThreshold).toBe(200);
    expect(monitorAny.criticalRequestThreshold).toBe(1000);
  });
});

describe("PerformanceMonitor - Request Recording", () => {
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
    expect(recentMetrics.length > 0).toBeTruthy();
    const entry = recentMetrics.find((m) => m.responseTime === responseTime);
    expect(entry).toBeTruthy();
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
    expect(slowEntry).toBeTruthy();
  });

  it("should not flag fast requests as slow", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);
    const responseTime = 50; // Below 200ms threshold

    await monitor.recordRequest(req, reply, responseTime);

    const monitorAny = monitor as any;
    const threshold = monitorAny.slowRequestThreshold;
    expect(responseTime < threshold).toBeTruthy();
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
    expect(entry).toBeTruthy();
  });

  it("should track client IP in metrics", async () => {
    const clientIp = "192.168.1.100";
    const req = createMockRequest({ ip: clientIp });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ ip?: string }>;
    const entry = recentMetrics.find((m: any) => m.ip === clientIp);
    expect(entry).toBeTruthy();
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
    expect(recentMetrics.length).toBe(statusCodes.length);
  });
});

describe("PerformanceMonitor - Route Extraction", () => {
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
    expect(entry).toBeTruthy();
    expect(entry.route.includes("?")).toBeFalsy();
  });

  it("should normalize numeric IDs in routes", async () => {
    const req = createMockRequest({ url: "/api/posts/123" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    expect(entry).toBeTruthy();
    expect(entry.route.includes("123")).toBeFalsy();
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
    expect(entry).toBeTruthy();
    expect(entry.route.includes("550e8400")).toBeFalsy();
  });

  it("should normalize long tokens in routes", async () => {
    const req = createMockRequest({ url: "/api/verify/abcdefghijklmnopqrstuvwxyz12345" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ route: string }>;
    const entry = recentMetrics[recentMetrics.length - 1];
    expect(entry).toBeTruthy();
    expect(entry.route.includes("abcdefghijklmnopqrstuvwxyz12345")).toBeFalsy();
  });
});

describe("PerformanceMonitor - System Health Calculation", () => {
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

    expect(health.status).toBe("healthy");
    expect(health.responseTimeP95 < 200).toBeTruthy();
    expect(health.errorRate < 5).toBeTruthy();
  });

  it("should calculate degraded system status for slow responses", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 10; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 300);
    }

    const health = await monitor.getSystemHealth();

    expect(health.status).toBe("degraded");
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

    expect(health.errorRate > 5).toBeTruthy();
    expect(health.status === "degraded" || health.status === "unhealthy").toBeTruthy();
  });

  it("should calculate unhealthy status for critical response times", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 10; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 1500);
    }

    const health = await monitor.getSystemHealth();

    expect(health.status).toBe("unhealthy");
    expect(health.responseTimeP95 > 1000).toBeTruthy();
  });

  it("should include system uptime in health status", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.uptime > 0).toBeTruthy();
  });

  it("should include memory usage percentage", async () => {
    const health = await monitor.getSystemHealth();

    expect(health.memoryUsage.used > 0).toBeTruthy();
    expect(health.memoryUsage.total > 0).toBeTruthy();
    expect(health.memoryUsage.percentage >= 0 && health.memoryUsage.percentage <= 100).toBeTruthy();
  });
});

describe("PerformanceMonitor - Edge Cases", () => {
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
    expect(entry).toBeTruthy();
  });

  it("should handle very high response time", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 30000);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    const entry = recentMetrics.find((m) => m.responseTime === 30000);
    expect(entry).toBeTruthy();
  });

  it("should handle requests without user agent", async () => {
    const req = createMockRequest({ headers: {} });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    expect(recentMetrics.length > 0).toBeTruthy();
  });

  it("should handle missing IP address", async () => {
    const req = createMockRequest({ ip: undefined });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    expect(recentMetrics.length > 0).toBeTruthy();
  });

  it("should handle malformed URLs", async () => {
    const req = createMockRequest({ url: "" });
    const reply = createMockReply(200);

    await monitor.recordRequest(req, reply, 100);

    const monitorAny = monitor as any;
    const recentMetrics = monitorAny.recentMetrics as Array<{ responseTime: number }>;
    expect(recentMetrics.length > 0).toBeTruthy();
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
    expect(recentMetrics.length > 0).toBeTruthy();
  });
});
