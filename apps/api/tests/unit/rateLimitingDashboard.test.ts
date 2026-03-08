#!/usr/bin/env tsx
/**
 * Unit Tests for rateLimitingDashboard
 * Testing rate limiting monitoring dashboard endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import {
  RateLimitingDashboard,
  DEFAULT_ALERT_CONFIG,
  type AlertConfig,
} from "../../src/monitoring/rateLimitingDashboard.js";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockRedis = Pick<Redis, "get" | "set" | "setex" | "hgetall" | "keys">;
type MockApiMetrics = Pick<ApiMetrics, "recordRequest" | "recordError" | "recordLatency">;

// Mock Redis client
function createMockRedis(t: TestContext): MockRedis {
  const mockData = new Map<string, string>();

  return {
    get: t.mock.fn(async (key: string) => mockData.get(key) || null),
    set: t.mock.fn(async (key: string, value: string) => {
      mockData.set(key, value);
      return "OK";
    }),
    setex: t.mock.fn(async (key: string, _ttl: number, value: string) => {
      mockData.set(key, value);
      return "OK";
    }),
    hgetall: t.mock.fn(async (_key: string) => ({
      active: "true",
      last_heartbeat: new Date().toISOString(),
      requests_handled: "1000",
    })),
    keys: t.mock.fn(async (pattern: string) => {
      if (pattern.includes("tenant")) {
        return [
          "rate_limit:metrics:tenant:tenant-1:blocks",
          "rate_limit:metrics:tenant:tenant-2:blocks",
        ];
      }
      if (pattern.includes("instances")) {
        return ["rate_limit:instances:instance-1", "rate_limit:instances:instance-2"];
      }
      if (pattern.includes("alerts")) {
        return ["rate_limit:alerts:alert-1"];
      }
      return [];
    }),
  };
}

// Mock ApiMetrics
function createMockApiMetrics(t: TestContext): MockApiMetrics {
  return {
    recordRequest: t.mock.fn(),
    recordError: t.mock.fn(),
    recordLatency: t.mock.fn(),
  };
}

describe("rateLimitingDashboard - Unit Tests", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let mockRedis: MockRedis;
  let mockMetrics: MockApiMetrics;
  let dashboard: RateLimitingDashboard;

  beforeEach(async (t) => {
    mockRedis = createMockRedis(t);
    mockMetrics = createMockApiMetrics(t);

    dashboard = new RateLimitingDashboard(
      mockRedis as Redis,
      mockMetrics as ApiMetrics,
      DEFAULT_ALERT_CONFIG
    );

    app = Fastify({ logger: false });
    await dashboard.register(app);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /admin/rate-limiting/dashboard", () => {
    it("should return dashboard metrics with default time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data);
      assert.ok(body.timestamp);
    });

    it("should return metrics structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.total_requests === "number");
      assert.ok(typeof body.data.rate_limited_requests === "number");
      assert.ok(typeof body.data.burst_protected_requests === "number");
      assert.ok(typeof body.data.emergency_mode_activations === "number");
      assert.ok(typeof body.data.tenant_specific_blocks === "object");
      assert.ok(typeof body.data.average_response_time === "number");
      assert.ok(Array.isArray(body.data.peak_usage_periods));
      assert.ok(typeof body.data.distributed_instance_stats === "object");
    });

    it("should accept 1h time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=1h",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
    });

    it("should accept 24h time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=24h",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
    });

    it("should accept 7d time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=7d",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
    });

    it("should reject invalid time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=invalid",
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should include tenant specific blocks", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.tenant_specific_blocks === "object");
    });

    it("should include distributed instance stats", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.distributed_instance_stats === "object");
    });
  });

  describe("GET /admin/rate-limiting/realtime", () => {
    it("should return real-time metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data);
      assert.ok(body.timestamp);
    });

    it("should include current requests per minute", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.current_requests_per_minute === "number");
    });

    it("should include active rate limits count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.active_rate_limits === "number");
    });

    it("should include emergency mode status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.emergency_mode_active === "boolean");
    });

    it("should include distributed instances count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.distributed_instances === "number");
    });
  });

  describe("GET /admin/rate-limiting/tenant/:tenantId", () => {
    it("should return tenant-specific metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-123",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.tenant, "tenant-123");
      assert.ok(body.data);
      assert.ok(body.timestamp);
    });

    it("should include tenant requests count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.requests === "number");
    });

    it("should include tenant blocks count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.blocks === "number");
    });

    it("should include tenant burst usage", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.burst_usage === "number");
    });

    it("should include tenant tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.data.tier);
    });

    it("should include current usage metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.data.current_usage === "object");
    });

    it("should accept custom time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-789?timeRange=7d",
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should reject invalid tenant ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/",
      });

      // Empty tenantId triggers validation error (400) or no-match (404)
      assert.ok(
        response.statusCode === 400 || response.statusCode === 404,
        `Expected 400 or 404, got ${response.statusCode}`
      );
    });
  });

  describe("GET /admin/rate-limiting/alerts", () => {
    it("should return alert configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.config);
      assert.ok(body.timestamp);
    });

    it("should include alert configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.config.enabled === "boolean");
      assert.ok(typeof body.config.thresholds === "object");
      assert.ok(typeof body.config.notification_channels === "object");
    });

    it("should include active alerts", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.active_alerts));
    });

    it("should include threshold configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.config.thresholds.rate_limit_ratio === "number");
      assert.ok(typeof body.config.thresholds.emergency_activations === "number");
      assert.ok(typeof body.config.thresholds.tenant_abuse_threshold === "number");
      assert.ok(typeof body.config.thresholds.response_time_threshold === "number");
    });
  });

  describe("GET /admin/rate-limiting/emergency-status", () => {
    it("should return emergency mode status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.ok(body.emergency_mode);
      assert.ok(body.timestamp);
    });

    it("should include emergency active status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.emergency_mode.active === "boolean");
    });

    it("should include activations count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.emergency_mode.activations_today === "number");
    });

    it("should include current error rate", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.emergency_mode.current_error_rate === "number");
    });
  });

  describe("RateLimitingDashboard - getMetrics", () => {
    it("should aggregate metrics from multiple sources", async () => {
      const metrics = await dashboard.getMetrics("1h");

      assert.ok(typeof metrics.total_requests === "number");
      assert.ok(typeof metrics.rate_limited_requests === "number");
      assert.ok(typeof metrics.burst_protected_requests === "number");
      assert.ok(typeof metrics.emergency_mode_activations === "number");
    });

    it("should support different time ranges", async () => {
      const metrics1h = await dashboard.getMetrics("1h");
      const metrics24h = await dashboard.getMetrics("24h");
      const metrics7d = await dashboard.getMetrics("7d");

      assert.ok(metrics1h);
      assert.ok(metrics24h);
      assert.ok(metrics7d);
    });
  });

  describe("RateLimitingDashboard - checkAlerts", () => {
    it("should not trigger alerts when disabled", async (t) => {
      const disabledConfig: AlertConfig = {
        ...DEFAULT_ALERT_CONFIG,
        enabled: false,
      };

      const disabledRedis = createMockRedis(t);
      const disabledMetrics = createMockApiMetrics(t);
      const dashboardWithDisabledAlerts = new RateLimitingDashboard(
        disabledRedis as Redis,
        disabledMetrics as ApiMetrics,
        disabledConfig
      );

      await dashboardWithDisabledAlerts.checkAlerts();

      // When alerts are disabled, getMetrics should NOT be called (early return)
      // The mock redis.get is used by getMetrics internally — it should not have been called
      const getCalls = (disabledRedis.get as any).mock.callCount();
      assert.strictEqual(getCalls, 0, "getMetrics should not be called when alerts are disabled");
    });

    it("should check rate limiting thresholds", async () => {
      await dashboard.checkAlerts();

      // checkAlerts calls getMetrics("1h") which queries Redis keys for tenant
      // and distributed stats via getTenantSpecificStats and getDistributedInstanceStats
      const keysCalls = (mockRedis.keys as any).mock.callCount();
      assert.ok(keysCalls > 0, "checkAlerts should query Redis keys for metrics aggregation");
    });
  });

  describe("DEFAULT_ALERT_CONFIG", () => {
    it("should have proper default configuration", () => {
      assert.strictEqual(DEFAULT_ALERT_CONFIG.enabled, true);
      assert.ok(DEFAULT_ALERT_CONFIG.thresholds);
      assert.ok(DEFAULT_ALERT_CONFIG.notification_channels);
    });

    it("should have reasonable threshold values", () => {
      assert.ok(DEFAULT_ALERT_CONFIG.thresholds.rate_limit_ratio > 0);
      assert.ok(DEFAULT_ALERT_CONFIG.thresholds.emergency_activations > 0);
      assert.ok(DEFAULT_ALERT_CONFIG.thresholds.tenant_abuse_threshold > 0);
      assert.ok(DEFAULT_ALERT_CONFIG.thresholds.response_time_threshold > 0);
    });
  });
});
