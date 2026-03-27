#!/usr/bin/env tsx
/**
 * Unit Tests for rateLimitingDashboard
 * Testing rate limiting monitoring dashboard endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
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
function createMockRedis(): MockRedis {
  const mockData = new Map<string, string>();

  return {
    get: vi.fn(async (key: string) => mockData.get(key) || null),
    set: vi.fn(async (key: string, value: string) => {
      mockData.set(key, value);
      return "OK";
    }),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      mockData.set(key, value);
      return "OK";
    }),
    hgetall: vi.fn(async (_key: string) => ({
      active: "true",
      last_heartbeat: new Date().toISOString(),
      requests_handled: "1000",
    })),
    keys: vi.fn(async (pattern: string) => {
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
function createMockApiMetrics(): MockApiMetrics {
  return {
    recordRequest: vi.fn(),
    recordError: vi.fn(),
    recordLatency: vi.fn(),
  };
}

describe("rateLimitingDashboard - Unit Tests", () => {
  let app: FastifyInstance;
  let mockRedis: MockRedis;
  let mockMetrics: MockApiMetrics;
  let dashboard: RateLimitingDashboard;

  beforeEach(async (_t) => {
    mockRedis = createMockRedis();
    mockMetrics = createMockApiMetrics();

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

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should return metrics structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.total_requests === "number").toBeTruthy();
      expect(typeof body.data.rate_limited_requests === "number").toBeTruthy();
      expect(typeof body.data.burst_protected_requests === "number").toBeTruthy();
      expect(typeof body.data.emergency_mode_activations === "number").toBeTruthy();
      expect(typeof body.data.tenant_specific_blocks === "object").toBeTruthy();
      expect(typeof body.data.average_response_time === "number").toBeTruthy();
      expect(Array.isArray(body.data.peak_usage_periods)).toBeTruthy();
      expect(typeof body.data.distributed_instance_stats === "object").toBeTruthy();
    });

    it("should accept 1h time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=1h",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });

    it("should accept 24h time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=24h",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });

    it("should accept 7d time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=7d",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard?timeRange=invalid",
      });

      expect(response.statusCode).toBe(400);
    });

    it("should include tenant specific blocks", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.tenant_specific_blocks === "object").toBeTruthy();
    });

    it("should include distributed instance stats", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/dashboard",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.distributed_instance_stats === "object").toBeTruthy();
    });
  });

  describe("GET /admin/rate-limiting/realtime", () => {
    it("should return real-time metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include current requests per minute", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.current_requests_per_minute === "number").toBeTruthy();
    });

    it("should include active rate limits count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.active_rate_limits === "number").toBeTruthy();
    });

    it("should include emergency mode status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.emergency_mode_active === "boolean").toBeTruthy();
    });

    it("should include distributed instances count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/realtime",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.distributed_instances === "number").toBeTruthy();
    });
  });

  describe("GET /admin/rate-limiting/tenant/:tenantId", () => {
    it("should return tenant-specific metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-123",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.tenant).toBe("tenant-123");
      expect(body.data).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include tenant requests count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.requests === "number").toBeTruthy();
    });

    it("should include tenant blocks count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.blocks === "number").toBeTruthy();
    });

    it("should include tenant burst usage", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.burst_usage === "number").toBeTruthy();
    });

    it("should include tenant tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      expect(body.data.tier).toBeTruthy();
    });

    it("should include current usage metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-456",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.data.current_usage === "object").toBeTruthy();
    });

    it("should accept custom time range", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/tenant-789?timeRange=7d",
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid tenant ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/tenant/",
      });

      // Empty tenantId triggers validation error (400) or no-match (404)
      expect(response.statusCode === 400 || response.statusCode === 404).toBeTruthy();
    });
  });

  describe("GET /admin/rate-limiting/alerts", () => {
    it("should return alert configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.config).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include alert configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.config.enabled === "boolean").toBeTruthy();
      expect(typeof body.config.thresholds === "object").toBeTruthy();
      expect(typeof body.config.notification_channels === "object").toBeTruthy();
    });

    it("should include active alerts", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.active_alerts)).toBeTruthy();
    });

    it("should include threshold configuration", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/alerts",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.config.thresholds.rate_limit_ratio === "number").toBeTruthy();
      expect(typeof body.config.thresholds.emergency_activations === "number").toBeTruthy();
      expect(typeof body.config.thresholds.tenant_abuse_threshold === "number").toBeTruthy();
      expect(typeof body.config.thresholds.response_time_threshold === "number").toBeTruthy();
    });
  });

  describe("GET /admin/rate-limiting/emergency-status", () => {
    it("should return emergency mode status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.emergency_mode).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include emergency active status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.emergency_mode.active === "boolean").toBeTruthy();
    });

    it("should include activations count", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.emergency_mode.activations_today === "number").toBeTruthy();
    });

    it("should include current error rate", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rate-limiting/emergency-status",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.emergency_mode.current_error_rate === "number").toBeTruthy();
    });
  });

  describe("RateLimitingDashboard - getMetrics", () => {
    it("should aggregate metrics from multiple sources", async () => {
      const metrics = await dashboard.getMetrics("1h");

      expect(typeof metrics.total_requests === "number").toBeTruthy();
      expect(typeof metrics.rate_limited_requests === "number").toBeTruthy();
      expect(typeof metrics.burst_protected_requests === "number").toBeTruthy();
      expect(typeof metrics.emergency_mode_activations === "number").toBeTruthy();
    });

    it("should support different time ranges", async () => {
      const metrics1h = await dashboard.getMetrics("1h");
      const metrics24h = await dashboard.getMetrics("24h");
      const metrics7d = await dashboard.getMetrics("7d");

      expect(metrics1h).toBeTruthy();
      expect(metrics24h).toBeTruthy();
      expect(metrics7d).toBeTruthy();
    });
  });

  describe("RateLimitingDashboard - checkAlerts", () => {
    it("should not trigger alerts when disabled", async (_t) => {
      const disabledConfig: AlertConfig = {
        ...DEFAULT_ALERT_CONFIG,
        enabled: false,
      };

      const disabledRedis = createMockRedis();
      const disabledMetrics = createMockApiMetrics();
      const dashboardWithDisabledAlerts = new RateLimitingDashboard(
        disabledRedis as Redis,
        disabledMetrics as ApiMetrics,
        disabledConfig
      );

      await dashboardWithDisabledAlerts.checkAlerts();

      // When alerts are disabled, getMetrics should NOT be called (early return)
      // The mock redis.get is used by getMetrics internally — it should not have been called
      const getCalls = (disabledRedis.get as any).mock.calls.length;
      expect(getCalls).toBe(0);
    });

    it("should check rate limiting thresholds", async () => {
      await dashboard.checkAlerts();

      // checkAlerts calls getMetrics("1h") which queries Redis keys for tenant
      // and distributed stats via getTenantSpecificStats and getDistributedInstanceStats
      const keysCalls = (mockRedis.keys as any).mock.calls.length;
      expect(keysCalls > 0).toBeTruthy();
    });
  });

  describe("DEFAULT_ALERT_CONFIG", () => {
    it("should have proper default configuration", () => {
      expect(DEFAULT_ALERT_CONFIG.enabled).toBe(true);
      expect(DEFAULT_ALERT_CONFIG.thresholds).toBeTruthy();
      expect(DEFAULT_ALERT_CONFIG.notification_channels).toBeTruthy();
    });

    it("should have reasonable threshold values", () => {
      expect(DEFAULT_ALERT_CONFIG.thresholds.rate_limit_ratio > 0).toBeTruthy();
      expect(DEFAULT_ALERT_CONFIG.thresholds.emergency_activations > 0).toBeTruthy();
      expect(DEFAULT_ALERT_CONFIG.thresholds.tenant_abuse_threshold > 0).toBeTruthy();
      expect(DEFAULT_ALERT_CONFIG.thresholds.response_time_threshold > 0).toBeTruthy();
    });
  });
});
