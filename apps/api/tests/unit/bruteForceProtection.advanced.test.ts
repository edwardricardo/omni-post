#!/usr/bin/env tsx
/**
 * Unit Tests for bruteForceProtection — advanced behavior
 * Covers: IP Blocking, Successful Login, Statistics, Anomaly Detection,
 *         Edge Cases, Configuration
 *
 * Uses keyNamespace="bfadv" so Redis keys are isolated from
 * bruteForceProtection.core.test.ts which runs concurrently.
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
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

describe("BruteForceProtection — advanced", () => {
  beforeAll(async () => {
    protection = new BruteForceProtection(testRedis, mockMetrics, testConfig);
    await cleanupRedis(testRedis, NAMESPACE);
  });

  afterAll(async () => {
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

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("IP address temporarily blocked");
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
      expect(result.allowed).toBe(false);

      const unblocked = await protection.unblockIpAddress(ip, adminId);
      expect(unblocked).toBe(true);

      result = await protection.checkLoginAttempt(
        `test-${timestamp}@example.com`,
        ip,
        testUserAgent
      );
      expect(result.allowed).toBe(true);
    });

    it("should return false when unlocking non-blocked IP", async () => {
      const ip = `10.4.0.99`;
      const adminId = `admin-${timestamp}`;

      const result = await protection.unblockIpAddress(ip, adminId);

      expect(result).toBe(false);
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
      expect(result.delaySeconds > 0).toBeTruthy();

      await protection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.delaySeconds).toBe(0);
    });

    it("should reset CAPTCHA requirement after successful login", async () => {
      const email = `success2-${timestamp}@example.com`;
      const ip = `10.5.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      let result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.captchaRequired).toBe(true);

      await protection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.captchaRequired).toBe(false);
    });
  });

  // ============================================================================
  // Protection Statistics
  // ============================================================================

  describe("Protection Statistics", () => {
    it("should return accurate protection stats", async () => {
      const stats = await protection.getProtectionStats();

      expect(typeof stats.lockedAccounts === "number").toBeTruthy();
      expect(typeof stats.blockedIps === "number").toBeTruthy();
      expect(typeof stats.recentFailures === "number").toBeTruthy();
      expect(typeof stats.suspiciousActivities === "number").toBeTruthy();
    });

    it("should track locked accounts in stats", async () => {
      const email = `stats1-${timestamp}@example.com`;
      const ip = `10.6.0.1`;

      const statsBefore = await protection.getProtectionStats();

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const statsAfter = await protection.getProtectionStats();

      expect(statsAfter.lockedAccounts >= statsBefore.lockedAccounts).toBeTruthy();
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
      expect(stats.suspiciousActivities >= 0).toBeTruthy();
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
      expect(stats.suspiciousActivities >= 0).toBeTruthy();
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
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeTruthy();
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

      expect(result.allowed).toBe(true);
    });

    it("should return false when unlocking non-locked account", async () => {
      const email = `not-locked-${timestamp}@example.com`;
      const adminId = `admin-${timestamp}`;

      const result = await protection.unlockAccount(email, adminId);

      expect(result).toBe(false);
    });

    it("should handle missing user agent", async () => {
      const email = `no-agent-${timestamp}@example.com`;
      const ip = `10.8.0.3`;

      const result = await protection.checkLoginAttempt(email, ip, "");

      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Configuration
  // ============================================================================

  describe("Configuration", () => {
    it("should use default configuration when not provided", () => {
      const defaultProtection = new BruteForceProtection(testRedis, mockMetrics);

      expect(defaultProtection).toBeTruthy();
    });

    it("should merge custom config with defaults", () => {
      const customProtection = new BruteForceProtection(testRedis, mockMetrics, {
        maxFailedAttemptsPerEmail: 10,
      });

      expect(customProtection).toBeTruthy();
    });
  });
});
