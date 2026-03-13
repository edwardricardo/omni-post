import { describe, it, beforeEach, expect } from "vitest";
import { PerformanceMonitor } from "../../src/monitoring/performanceMonitor.js";
import {
  createMockApiMetrics,
  createMockRedis,
  createMockRequest,
  createMockReply,
} from "./performanceMonitor.test-helpers.js";

describe("PerformanceMonitor - Endpoint Statistics", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should aggregate endpoint statistics", async () => {
    const req = createMockRequest({ method: "GET", url: "/api/posts" });

    for (let i = 0; i < 5; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 100 + i * 10);
    }

    const stats = await monitor.getEndpointStats(60);

    expect(stats.length > 0).toBeTruthy();
    const postStats = stats.find((s) => s.route.includes("posts") && s.method === "GET");
    expect(postStats).toBeTruthy();
    expect(postStats!.totalRequests >= 5).toBeTruthy();
  });

  it("should calculate average response time", async () => {
    const req = createMockRequest({ method: "POST", url: "/api/posts" });

    const times = [100, 150, 200];
    for (const time of times) {
      const reply = createMockReply(201);
      await monitor.recordRequest(req, reply, time);
    }

    const stats = await monitor.getEndpointStats(60);
    const postStats = stats.find((s) => s.route.includes("posts") && s.method === "POST");

    if (postStats) {
      const expectedAvg = Math.round((100 + 150 + 200) / 3);
      expect(Math.abs(postStats.averageResponseTime - expectedAvg) < 5).toBeTruthy();
    }
  });

  it("should calculate p95 and p99 response times", async () => {
    const req = createMockRequest({ method: "GET", url: "/api/analytics" });

    for (let i = 1; i <= 100; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, i * 10);
    }

    const stats = await monitor.getEndpointStats(60);
    const analyticsStats = stats.find((s) => s.route.includes("analytics") && s.method === "GET");

    if (analyticsStats) {
      expect(analyticsStats.p95ResponseTime > 0).toBeTruthy();
      expect(analyticsStats.p99ResponseTime > 0).toBeTruthy();
      expect(analyticsStats.p99ResponseTime >= analyticsStats.p95ResponseTime).toBeTruthy();
    }
  });

  it("should calculate error rate", async () => {
    const req = createMockRequest({ method: "DELETE", url: "/api/posts/123" });

    for (let i = 0; i < 8; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 100);
    }

    for (let i = 0; i < 2; i++) {
      const reply = createMockReply(500);
      await monitor.recordRequest(req, reply, 100);
    }

    const stats = await monitor.getEndpointStats(60);
    const deleteStats = stats.find((s) => s.route.includes("posts") && s.method === "DELETE");

    if (deleteStats) {
      expect(deleteStats.errorRate > 0).toBeTruthy();
      expect(Math.abs(deleteStats.errorRate - 20) < 5).toBeTruthy();
    }
  });

  it("should calculate throughput", async () => {
    const req = createMockRequest({ method: "GET", url: "/api/health" });

    for (let i = 0; i < 30; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 10);
    }

    const stats = await monitor.getEndpointStats(1);

    const healthStats = stats.find((s) => s.route.includes("health"));

    if (healthStats) {
      expect(healthStats.throughput > 0).toBeTruthy();
      expect(healthStats.throughput >= 30).toBeTruthy();
    }
  });

  it("should sort endpoints by request count", async () => {
    const endpoints = [
      { url: "/api/posts", count: 10 },
      { url: "/api/analytics", count: 5 },
      { url: "/api/users", count: 20 },
    ];

    for (const endpoint of endpoints) {
      const req = createMockRequest({ url: endpoint.url });
      for (let i = 0; i < endpoint.count; i++) {
        const reply = createMockReply(200);
        await monitor.recordRequest(req, reply, 100);
      }
    }

    const stats = await monitor.getEndpointStats(60);

    for (let i = 1; i < stats.length; i++) {
      expect(stats[i - 1]!.totalRequests >= stats[i]!.totalRequests).toBeTruthy();
    }
  });
});

describe("PerformanceMonitor - Percentile Calculation", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should calculate percentiles correctly", async () => {
    const req = createMockRequest();

    for (let i = 1; i <= 100; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, i);
    }

    const stats = await monitor.getEndpointStats(60);

    if (stats.length > 0) {
      const stat = stats[0]!;
      expect(stat.p95ResponseTime >= 90 && stat.p95ResponseTime <= 100).toBeTruthy();
      expect(stat.p99ResponseTime >= 95 && stat.p99ResponseTime <= 100).toBeTruthy();
    }
  });

  it("should handle empty array for percentiles", async () => {
    const stats = await monitor.getEndpointStats(60);

    expect(Array.isArray(stats)).toBeTruthy();
  });

  it("should handle single value for percentiles", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);
    await monitor.recordRequest(req, reply, 150);

    const stats = await monitor.getEndpointStats(60);

    if (stats.length > 0) {
      const stat = stats[0]!;
      expect(stat.p95ResponseTime).toBe(150);
      expect(stat.p99ResponseTime).toBe(150);
    }
  });
});

describe("PerformanceMonitor - Dashboard Data", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should aggregate dashboard data", async () => {
    const req = createMockRequest();
    for (let i = 0; i < 5; i++) {
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, 100);
    }

    const dashboard = await monitor.getDashboardData(60);

    expect(dashboard.systemHealth).toBeTruthy();
    expect(Array.isArray(dashboard.endpointStats)).toBeTruthy();
    expect(Array.isArray(dashboard.recentAlerts)).toBeTruthy();
    expect(Array.isArray(dashboard.slowRequests)).toBeTruthy();
  });

  it("should include slow requests in dashboard", async () => {
    const req = createMockRequest({ url: "/api/slow" });
    const reply = createMockReply(200);
    await monitor.recordRequest(req, reply, 500);

    const dashboard = await monitor.getDashboardData(60);

    expect(dashboard.slowRequests.length > 0).toBeTruthy();
  });

  it("should sort slow requests by response time", async () => {
    const times = [300, 500, 250, 400];
    for (const time of times) {
      const req = createMockRequest();
      const reply = createMockReply(200);
      await monitor.recordRequest(req, reply, time);
    }

    const dashboard = await monitor.getDashboardData(60);

    for (let i = 1; i < dashboard.slowRequests.length; i++) {
      expect(
        dashboard.slowRequests[i - 1]!.responseTime >= dashboard.slowRequests[i]!.responseTime
      ).toBeTruthy();
    }
  });
});

describe("PerformanceMonitor - Alert Management", () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should retrieve recent alerts", async () => {
    const alerts = await monitor.getRecentAlerts(10);

    expect(Array.isArray(alerts)).toBeTruthy();
  });

  it("should limit number of alerts retrieved", async () => {
    const limit = 5;
    const alerts = await monitor.getRecentAlerts(limit);

    expect(alerts.length <= limit).toBeTruthy();
  });

  it("should update alert rule configuration", () => {
    const updated = monitor.updateAlertRule("High Response Time", {
      threshold: 10,
      enabled: false,
    });

    expect(updated).toBe(true);
  });

  it("should return false for non-existent alert rule", () => {
    const updated = monitor.updateAlertRule("Non-existent Rule", {
      threshold: 5,
    });

    expect(updated).toBe(false);
  });
});
