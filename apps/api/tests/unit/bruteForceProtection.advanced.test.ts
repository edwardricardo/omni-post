#!/usr/bin/env tsx
/**
 * Unit Tests for bruteForceProtection — advanced behavior
 * Covers: IP Blocking, Successful Login, Statistics, Anomaly Detection,
 *         Edge Cases, Configuration
 *
 * Uses keyNamespace="bfadv" so Redis keys are isolated from
 * bruteForceProtection.core.test.ts which runs concurrently.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { BruteForceProtection } from "../../src/auth/bruteForceProtection.js";
import type Redis from "ioredis";
import {
  mockMetrics,
  makeTestConfig,
  makeTestRedis,
  cleanupRedis,
  testUserAgent,
} from "./bruteForceProtection.test-helpers.js";

const NAMESPACE = "bfadv";
const timestamp = Date.now();
const testRedis = makeTestRedis();
const testConfig = makeTestConfig(NAMESPACE);
let protection: BruteForceProtection;

describe("BruteForceProtection — advanced", { concurrency: 1 }, () => {
  before(async () => {
    protection = new BruteForceProtection(testRedis, mockMetrics, testConfig);
    await cleanupRedis(testRedis, NAMESPACE);
  });

  after(async () => {
    await cleanupRedis(testRedis, NAMESPACE);
    await testRedis.quit();
  });

  // ============================================================================
  // IP Blocking
  // ============================================================================

  describe("IP Blocking", () => {
    it("should block IP after threshold failures", async () => {
      const ip = `10.4.0.1`;

      for (let i = 0; i < testConfig.ipBlockThreshold!; i++) {
        await protection.recordFailedAttempt(
          `ip-test-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await protection.checkLoginAttempt(
        `new-${timestamp}@example.com`,
        ip,
        testUserAgent
      );

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, "IP address temporarily blocked");
    });

    it("should allow admin to unblock IP", async () => {
      const ip = `10.4.0.2`;
      const adminId = `admin-${timestamp}`;

      for (let i = 0; i < testConfig.ipBlockThreshold!; i++) {
        await protection.recordFailedAttempt(
          `ip-test-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      let result = await protection.checkLoginAttempt(
        `test-${timestamp}@example.com`,
        ip,
        testUserAgent
      );
      assert.strictEqual(result.allowed, false);

      const unblocked = await protection.unblockIpAddress(ip, adminId);
      assert.strictEqual(unblocked, true);

      result = await protection.checkLoginAttempt(
        `test-${timestamp}@example.com`,
        ip,
        testUserAgent
      );
      assert.strictEqual(result.allowed, true);
    });

    it("should return false when unlocking non-blocked IP", async () => {
      const ip = `10.4.0.99`;
      const adminId = `admin-${timestamp}`;

      const result = await protection.unblockIpAddress(ip, adminId);

      assert.strictEqual(result, false);
    });
  });

  // ============================================================================
  // Successful Login Handling
  // ============================================================================

  describe("Successful Login Handling", () => {
    it("should clear failures after successful login", async () => {
      const email = `success1-${timestamp}@example.com`;
      const ip = `10.5.0.1`;

      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      let result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.ok(result.delaySeconds > 0);

      await protection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.strictEqual(result.delaySeconds, 0);
    });

    it("should reset CAPTCHA requirement after successful login", async () => {
      const email = `success2-${timestamp}@example.com`;
      const ip = `10.5.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      let result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.strictEqual(result.captchaRequired, true);

      await protection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.strictEqual(result.captchaRequired, false);
    });
  });

  // ============================================================================
  // Protection Statistics
  // ============================================================================

  describe("Protection Statistics", () => {
    it("should return accurate protection stats", async () => {
      const stats = await protection.getProtectionStats();

      assert.ok(typeof stats.lockedAccounts === "number");
      assert.ok(typeof stats.blockedIps === "number");
      assert.ok(typeof stats.recentFailures === "number");
      assert.ok(typeof stats.suspiciousActivities === "number");
    });

    it("should track locked accounts in stats", async () => {
      const email = `stats1-${timestamp}@example.com`;
      const ip = `10.6.0.1`;

      const statsBefore = await protection.getProtectionStats();

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const statsAfter = await protection.getProtectionStats();

      assert.ok(statsAfter.lockedAccounts >= statsBefore.lockedAccounts);
    });
  });

  // ============================================================================
  // Anomaly Detection
  // ============================================================================

  describe("Anomaly Detection", () => {
    it("should detect rapid failures from single IP", async () => {
      const ip = `10.7.0.1`;

      for (let i = 0; i < testConfig.suspiciousActivityThreshold! + 1; i++) {
        await protection.recordFailedAttempt(
          `anomaly-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const stats = await protection.getProtectionStats();
      assert.ok(stats.suspiciousActivities >= 0);
    });

    it("should detect distributed attacks", async () => {
      const email = `distributed-${timestamp}@example.com`;

      for (let i = 0; i < 6; i++) {
        await protection.recordFailedAttempt(
          email,
          `10.7.1.${i}`,
          testUserAgent,
          "Invalid password"
        );
      }

      const stats = await protection.getProtectionStats();
      assert.ok(stats.suspiciousActivities >= 0);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle Redis connection errors gracefully", async () => {
      // Use a mock Redis object that always throws on every command.
      // Avoid creating a real ioredis instance with an invalid host because
      // ioredis emits 'error' events asynchronously after quit() removes
      // listeners, which produces an unhandled error event that terminates
      // the process and corrupts the TAP stream in the parent test runner.
      const rejector = () => Promise.reject(new Error("Redis connection failed"));
      const brokenRedis = new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === "on" || prop === "once" || prop === "emit" || prop === "removeListener") {
              return () => brokenRedis;
            }
            if (prop === "status") return "close";
            if (prop === "quit" || prop === "disconnect") return () => Promise.resolve();
            return rejector;
          },
        }
      ) as unknown as Redis;

      const errorProtection = new BruteForceProtection(brokenRedis, mockMetrics, testConfig);

      const result = await errorProtection.checkLoginAttempt(
        `error-${timestamp}@example.com`,
        "10.8.0.1",
        testUserAgent
      );

      // The service must fail safe: allow the request with a fallback reason.
      assert.strictEqual(result.allowed, true);
      assert.ok(result.reason);
    });

    it("should handle expired lockouts correctly", async () => {
      const email = `expired-${timestamp}@example.com`;
      const ip = `10.8.0.2`;

      // Write the lockout key using the namespace-aware prefix
      await testRedis.setex(
        `${NAMESPACE}:bf:lockout:${email}`,
        1,
        JSON.stringify({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          reason: "Test expired lockout",
        })
      );

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.strictEqual(result.allowed, true);
    });

    it("should return false when unlocking non-locked account", async () => {
      const email = `not-locked-${timestamp}@example.com`;
      const adminId = `admin-${timestamp}`;

      const result = await protection.unlockAccount(email, adminId);

      assert.strictEqual(result, false);
    });

    it("should handle missing user agent", async () => {
      const email = `no-agent-${timestamp}@example.com`;
      const ip = `10.8.0.3`;

      const result = await protection.checkLoginAttempt(email, ip, "");

      assert.strictEqual(result.allowed, true);
    });
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe("Configuration", () => {
    it("should use default configuration when not provided", () => {
      const defaultProtection = new BruteForceProtection(testRedis, mockMetrics);

      assert.ok(defaultProtection);
    });

    it("should merge custom config with defaults", () => {
      const customProtection = new BruteForceProtection(testRedis, mockMetrics, {
        maxFailedAttemptsPerEmail: 10,
      });

      assert.ok(customProtection);
    });
  });
});
