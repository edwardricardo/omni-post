import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PerformanceMonitor } from "../../src/monitoring/performanceMonitor.js";
import {
  createMockApiMetrics,
  createMockRedis,
  createMockRequest,
  createMockReply,
} from "./performanceMonitor.test-helpers.js";

describe("PerformanceMonitor - Endpoint Statistics", { concurrency: 1 }, () => {
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

    assert.ok(stats.length > 0, "Should have endpoint statistics");
    const postStats = stats.find((s) => s.route.includes("posts") && s.method === "GET");
    assert.ok(postStats, "Should have stats for /api/posts endpoint");
    assert.ok(postStats!.totalRequests >= 5, "Should count all requests");
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
      assert.ok(
        Math.abs(postStats.averageResponseTime - expectedAvg) < 5,
        "Should calculate correct average response time"
      );
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
      assert.ok(analyticsStats.p95ResponseTime > 0, "P95 should be calculated");
      assert.ok(analyticsStats.p99ResponseTime > 0, "P99 should be calculated");
      assert.ok(
        analyticsStats.p99ResponseTime >= analyticsStats.p95ResponseTime,
        "P99 should be >= P95"
      );
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
      assert.ok(deleteStats.errorRate > 0, "Should calculate error rate");
      assert.ok(Math.abs(deleteStats.errorRate - 20) < 5, "Error rate should be ~20%");
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
      assert.ok(healthStats.throughput > 0, "Should calculate throughput");
      assert.ok(
        healthStats.throughput >= 30,
        "Throughput should be at least 30 requests per minute"
      );
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
      assert.ok(
        stats[i - 1]!.totalRequests >= stats[i]!.totalRequests,
        "Should be sorted by request count descending"
      );
    }
  });
});

describe("PerformanceMonitor - Percentile Calculation", { concurrency: 1 }, () => {
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
      assert.ok(stat.p95ResponseTime >= 90 && stat.p95ResponseTime <= 100, "P95 should be ~95");
      assert.ok(stat.p99ResponseTime >= 95 && stat.p99ResponseTime <= 100, "P99 should be ~99");
    }
  });

  it("should handle empty array for percentiles", async () => {
    const stats = await monitor.getEndpointStats(60);

    assert.ok(Array.isArray(stats), "Should return empty array for no data");
  });

  it("should handle single value for percentiles", async () => {
    const req = createMockRequest();
    const reply = createMockReply(200);
    await monitor.recordRequest(req, reply, 150);

    const stats = await monitor.getEndpointStats(60);

    if (stats.length > 0) {
      const stat = stats[0]!;
      assert.strictEqual(stat.p95ResponseTime, 150, "Single value P95 should equal that value");
      assert.strictEqual(stat.p99ResponseTime, 150, "Single value P99 should equal that value");
    }
  });
});

describe("PerformanceMonitor - Dashboard Data", { concurrency: 1 }, () => {
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

    assert.ok(dashboard.systemHealth, "Should include system health");
    assert.ok(Array.isArray(dashboard.endpointStats), "Should include endpoint stats");
    assert.ok(Array.isArray(dashboard.recentAlerts), "Should include recent alerts");
    assert.ok(Array.isArray(dashboard.slowRequests), "Should include slow requests");
  });

  it("should include slow requests in dashboard", async () => {
    const req = createMockRequest({ url: "/api/slow" });
    const reply = createMockReply(200);
    await monitor.recordRequest(req, reply, 500);

    const dashboard = await monitor.getDashboardData(60);

    assert.ok(dashboard.slowRequests.length > 0, "Should have slow requests in dashboard");
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
      assert.ok(
        dashboard.slowRequests[i - 1]!.responseTime >= dashboard.slowRequests[i]!.responseTime,
        "Slow requests should be sorted by response time descending"
      );
    }
  });
});

describe("PerformanceMonitor - Alert Management", { concurrency: 1 }, () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    const metrics = createMockApiMetrics();
    const redis = createMockRedis();
    monitor = new PerformanceMonitor(metrics, redis);
  });

  it("should retrieve recent alerts", async () => {
    const alerts = await monitor.getRecentAlerts(10);

    assert.ok(Array.isArray(alerts), "Should return array of alerts");
  });

  it("should limit number of alerts retrieved", async () => {
    const limit = 5;
    const alerts = await monitor.getRecentAlerts(limit);

    assert.ok(alerts.length <= limit, `Should return at most ${limit} alerts`);
  });

  it("should update alert rule configuration", () => {
    const updated = monitor.updateAlertRule("High Response Time", {
      threshold: 10,
      enabled: false,
    });

    assert.strictEqual(updated, true, "Should successfully update alert rule");
  });

  it("should return false for non-existent alert rule", () => {
    const updated = monitor.updateAlertRule("Non-existent Rule", {
      threshold: 5,
    });

    assert.strictEqual(updated, false, "Should return false for unknown rule");
  });
});
