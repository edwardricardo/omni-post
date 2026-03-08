#!/usr/bin/env tsx
/**
 * Unit Tests for bruteForceProtection — core behavior
 * Covers: Initial Login, Progressive Delays, CAPTCHA, Account Lockout
 *
 * Uses keyNamespace="bfcore" so Redis keys are isolated from
 * bruteForceProtection.advanced.test.ts which runs concurrently.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { BruteForceProtection } from "../../src/auth/bruteForceProtection.js";
import {
  mockMetrics,
  makeTestConfig,
  makeTestRedis,
  cleanupRedis,
  testUserAgent,
} from "./bruteForceProtection.test-helpers.js";

const NAMESPACE = "bfcore";
const timestamp = Date.now();
const testRedis = makeTestRedis();
const testConfig = makeTestConfig(NAMESPACE);
let protection: BruteForceProtection;

describe("BruteForceProtection — core", { concurrency: 1 }, () => {
  before(async () => {
    protection = new BruteForceProtection(testRedis, mockMetrics, testConfig);
    await cleanupRedis(testRedis, NAMESPACE);
  });

  after(async () => {
    await cleanupRedis(testRedis, NAMESPACE);
    await testRedis.quit();
  });

  // ============================================================================
  // Initial Login Attempt
  // ============================================================================

  describe("Initial Login Attempt", () => {
    it("should allow first login attempt without delay", async () => {
      const result = await protection.checkLoginAttempt(
        `clean-${timestamp}@example.com`,
        `10.0.0.1`,
        testUserAgent
      );

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.delaySeconds, 0);
      assert.strictEqual(result.captchaRequired, false);
    });

    it("should return attempts remaining on first check", async () => {
      const email = `new-${timestamp}@example.com`;
      const result = await protection.checkLoginAttempt(email, `10.0.0.2`, testUserAgent);

      assert.strictEqual(result.attemptsRemaining, testConfig.maxFailedAttemptsPerEmail);
    });
  });

  // ============================================================================
  // Progressive Delays
  // ============================================================================

  describe("Progressive Delays", () => {
    it("should apply base delay after first failure", async () => {
      const email = `delay1-${timestamp}@example.com`;
      const ip = `10.1.0.1`;

      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.strictEqual(result.allowed, true);
      assert.strictEqual(result.delaySeconds, testConfig.baseDelaySeconds);
    });

    it("should apply exponential backoff after multiple failures", async () => {
      const email = `delay2-${timestamp}@example.com`;
      const ip = `10.1.0.2`;

      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      const expectedDelay = testConfig.baseDelaySeconds! * Math.pow(testConfig.exponentialBase!, 1);
      assert.strictEqual(result.delaySeconds, expectedDelay);
    });

    it("should cap delay at maxDelaySeconds", async () => {
      const email = `delay3-${timestamp}@example.com`;
      const ip = `10.1.0.3`;

      for (let i = 0; i < 10; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.ok(result.delaySeconds <= testConfig.maxDelaySeconds!);
    });
  });

  // ============================================================================
  // CAPTCHA Requirements
  // ============================================================================

  describe("CAPTCHA Requirements", () => {
    it("should not require CAPTCHA initially", async () => {
      const email = `captcha1-${timestamp}@example.com`;
      const ip = `10.2.0.1`;

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.strictEqual(result.captchaRequired, false);
    });

    it("should require CAPTCHA after threshold failures", async () => {
      const email = `captcha2-${timestamp}@example.com`;
      const ip = `10.2.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.strictEqual(result.captchaRequired, true);
    });

    it("should require CAPTCHA based on IP failures", async () => {
      const ip = `10.2.0.3`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await protection.recordFailedAttempt(
          `multi-${i}-${timestamp}@example.com`,
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

      assert.strictEqual(result.captchaRequired, true);
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
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.reason, "Account temporarily locked");
      assert.ok(result.lockoutExpiresAt);
    });

    it("should return lockout expiration time", async () => {
      const email = `lockout2-${timestamp}@example.com`;
      const ip = `10.3.0.2`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      assert.ok(result.lockoutExpiresAt);
      assert.ok(result.lockoutExpiresAt > new Date());
    });

    it("should allow admin to unlock account", async () => {
      const email = `lockout3-${timestamp}@example.com`;
      const ip = `10.3.0.3`;
      const adminId = `admin-${timestamp}`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      let result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.strictEqual(result.allowed, false);

      const unlocked = await protection.unlockAccount(email, adminId);
      assert.strictEqual(unlocked, true);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      assert.strictEqual(result.allowed, true);
    });
  });
});
