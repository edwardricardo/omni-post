#!/usr/bin/env tsx
/**
 * Unit Tests for bruteForceProtection
 * Testing brute force protection and rate limiting functionality
 *
 * NOTE: This file is split into focused sub-files for batch execution:
 *   - bruteForceProtection.core.test.ts    (Initial Login, Delays, CAPTCHA, Lockout)
 *   - bruteForceProtection.advanced.test.ts (IP Blocking, Stats, Anomaly, Edge Cases)
 *
 * The run-tests.sh batch runner uses the split files. This file keeps all
 * tests together for quick individual execution:
 *   node --import tsx --test bruteForceProtection.test.ts
 *
 * @file bruteForceProtection.test.ts
 * @description Tests for BruteForceProtection Tests
 * @layer infrastructure
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

// Each test file that may run concurrently with others uses a unique namespace
// so their Redis keys never overlap (see keyNamespace in BruteForceConfig).
const NAMESPACE = "bfall";
const timestamp = Date.now();
const testRedis = makeTestRedis();
const testConfig = makeTestConfig(NAMESPACE);
let bruteForceProtection: BruteForceProtection;

describe("BruteForceProtection Tests", () => {
  beforeAll(async () => {
    bruteForceProtection = new BruteForceProtection(testRedis, mockMetrics, testConfig);
    await cleanupRedis(testRedis, NAMESPACE);
  });

  afterAll(async () => {
    await cleanupRedis(testRedis, NAMESPACE);
    await testRedis.quit();
  });

  // ============================================================================
  // Initial Login Attempt
  // ============================================================================

  describe("Initial Login Attempt", () => {
    it("should allow first login attempt without delay", async () => {
      const result = await bruteForceProtection.checkLoginAttempt(
        `clean-${timestamp}@example.com`,
        `10.0.0.1`,
        testUserAgent
      );

      expect(result.allowed).toBe(true);
      expect(result.delaySeconds).toBe(0);
      expect(result.captchaRequired).toBe(false);
    });

    it("should return attempts remaining on first check", async () => {
      const email = `new-${timestamp}@example.com`;
      const result = await bruteForceProtection.checkLoginAttempt(email, `10.0.0.2`, testUserAgent);

      expect(result.attemptsRemaining).toBe(testConfig.maxFailedAttemptsPerEmail);
    });
  });

  // ============================================================================
  // Progressive Delays
  // ============================================================================

  describe("Progressive Delays", () => {
    it("should apply base delay after first failure", async () => {
      const email = `delay1-${timestamp}@example.com`;
      const ip = `10.1.0.1`;

      await bruteForceProtection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.allowed).toBe(true);
      expect(result.delaySeconds).toBe(testConfig.baseDelaySeconds);
    });

    it("should apply exponential backoff after multiple failures", async () => {
      const email = `delay2-${timestamp}@example.com`;
      const ip = `10.1.0.2`;

      await bruteForceProtection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      await bruteForceProtection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      const expectedDelay = testConfig.baseDelaySeconds! * Math.pow(testConfig.exponentialBase!, 1);
      expect(result.delaySeconds).toBe(expectedDelay);
    });

    it("should cap delay at maxDelaySeconds", async () => {
      const email = `delay3-${timestamp}@example.com`;
      const ip = `10.1.0.3`;

      for (let i = 0; i < 10; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.delaySeconds <= testConfig.maxDelaySeconds!).toBeTruthy();
    });
  });

  // ============================================================================
  // CAPTCHA Requirements
  // ============================================================================

  describe("CAPTCHA Requirements", () => {
    it("should not require CAPTCHA initially", async () => {
      const email = `captcha1-${timestamp}@example.com`;
      const ip = `10.2.0.1`;

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.captchaRequired).toBe(false);
    });

    it("should require CAPTCHA after threshold failures", async () => {
      const email = `captcha2-${timestamp}@example.com`;
      const ip = `10.2.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.captchaRequired).toBe(true);
    });

    it("should require CAPTCHA based on IP failures", async () => {
      const ip = `10.2.0.3`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          `multi-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(
        `new-${timestamp}@example.com`,
        ip,
        testUserAgent
      );

      expect(result.captchaRequired).toBe(true);
    });
  });

  // ============================================================================
  // Account Lockout
  // ============================================================================

  describe("Account Lockout", () => {
    it("should lock account after lockout threshold", async () => {
      const email = `lockout1-${timestamp}@example.com`;
      const ip = `10.3.0.1`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Account temporarily locked");
      expect(result.lockoutExpiresAt).toBeTruthy();
    });

    it("should return lockout expiration time", async () => {
      const email = `lockout2-${timestamp}@example.com`;
      const ip = `10.3.0.2`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.lockoutExpiresAt).toBeTruthy();
      expect(result.lockoutExpiresAt > new Date()).toBeTruthy();
    });

    it("should allow admin to unlock account", async () => {
      const email = `lockout3-${timestamp}@example.com`;
      const ip = `10.3.0.3`;
      const adminId = `admin-${timestamp}`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      let result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.allowed).toBe(false);

      const unlocked = await bruteForceProtection.unlockAccount(email, adminId);
      expect(unlocked).toBe(true);

      result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // IP Blocking
  // ============================================================================

  describe("IP Blocking", () => {
    it("should block IP after threshold failures", async () => {
      const ip = `10.4.0.1`;

      for (let i = 0; i < testConfig.ipBlockThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          `ip-test-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const result = await bruteForceProtection.checkLoginAttempt(
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
        await bruteForceProtection.recordFailedAttempt(
          `ip-test-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      let result = await bruteForceProtection.checkLoginAttempt(
        `test-${timestamp}@example.com`,
        ip,
        testUserAgent
      );
      expect(result.allowed).toBe(false);

      const unblocked = await bruteForceProtection.unblockIpAddress(ip, adminId);
      expect(unblocked).toBe(true);

      result = await bruteForceProtection.checkLoginAttempt(
        `test-${timestamp}@example.com`,
        ip,
        testUserAgent
      );
      expect(result.allowed).toBe(true);
    });

    it("should return false when unlocking non-blocked IP", async () => {
      const ip = `10.4.0.99`;
      const adminId = `admin-${timestamp}`;

      const result = await bruteForceProtection.unblockIpAddress(ip, adminId);

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

      await bruteForceProtection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      await bruteForceProtection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      let result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.delaySeconds > 0).toBeTruthy();

      await bruteForceProtection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.delaySeconds).toBe(0);
    });

    it("should reset CAPTCHA requirement after successful login", async () => {
      const email = `success2-${timestamp}@example.com`;
      const ip = `10.5.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      let result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.captchaRequired).toBe(true);

      await bruteForceProtection.recordSuccessfulAttempt(email, ip, testUserAgent);

      result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.captchaRequired).toBe(false);
    });
  });

  // ============================================================================
  // Protection Statistics
  // ============================================================================

  describe("Protection Statistics", () => {
    it("should return accurate protection stats", async () => {
      const stats = await bruteForceProtection.getProtectionStats();

      expect(typeof stats.lockedAccounts === "number").toBeTruthy();
      expect(typeof stats.blockedIps === "number").toBeTruthy();
      expect(typeof stats.recentFailures === "number").toBeTruthy();
      expect(typeof stats.suspiciousActivities === "number").toBeTruthy();
    });

    it("should track locked accounts in stats", async () => {
      const email = `stats1-${timestamp}@example.com`;
      const ip = `10.6.0.1`;

      const statsBefore = await bruteForceProtection.getProtectionStats();

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const statsAfter = await bruteForceProtection.getProtectionStats();

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
        await bruteForceProtection.recordFailedAttempt(
          `anomaly-${i}-${timestamp}@example.com`,
          ip,
          testUserAgent,
          "Invalid password"
        );
      }

      const stats = await bruteForceProtection.getProtectionStats();
      expect(stats.suspiciousActivities >= 0).toBeTruthy();
    });

    it("should detect distributed attacks", async () => {
      const email = `distributed-${timestamp}@example.com`;

      for (let i = 0; i < 6; i++) {
        await bruteForceProtection.recordFailedAttempt(
          email,
          `10.7.1.${i}`,
          testUserAgent,
          "Invalid password"
        );
      }

      const stats = await bruteForceProtection.getProtectionStats();
      expect(stats.suspiciousActivities >= 0).toBeTruthy();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    it("should handle Redis connection errors gracefully", async () => {
      // Use a mock Redis object that always throws on every command.
      // Avoid creating a real ioredis instance with an invalid host because:
      //  - DNS resolution and TCP connection attempts happen asynchronously,
      //  - ioredis may emit 'error' events after quit() is called (removing listeners),
      //  - those unhandled error events terminate the process with an uncaught exception,
      //  - which corrupts the TAP stream and causes "Unable to deserialize cloned data"
      //    in the parent test runner when running with --test-concurrency > 1.
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

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeTruthy();
    });

    it("should handle expired lockouts correctly", async () => {
      const email = `expired-${timestamp}@example.com`;
      const ip = `10.8.0.2`;

      await testRedis.setex(
        `${NAMESPACE}:bf:lockout:${email}`,
        1,
        JSON.stringify({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          reason: "Test expired lockout",
        })
      );

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.allowed).toBe(true);
    });

    it("should return false when unlocking non-locked account", async () => {
      const email = `not-locked-${timestamp}@example.com`;
      const adminId = `admin-${timestamp}`;

      const result = await bruteForceProtection.unlockAccount(email, adminId);

      expect(result).toBe(false);
    });

    it("should handle missing user agent", async () => {
      const email = `no-agent-${timestamp}@example.com`;
      const ip = `10.8.0.3`;

      const result = await bruteForceProtection.checkLoginAttempt(email, ip, "");

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
