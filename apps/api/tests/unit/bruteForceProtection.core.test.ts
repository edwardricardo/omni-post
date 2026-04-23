#!/usr/bin/env tsx
/**
 * Unit Tests for bruteForceProtection — core behavior
 * Covers: Initial Login, Progressive Delays, CAPTCHA, Account Lockout
 *
 * Uses keyNamespace="bfcore" so Redis keys are isolated from
 * bruteForceProtection.advanced.test.ts which runs concurrently.
 *
 * @file bruteForceProtection.core.test.ts
 * @description Tests for BruteForceProtection — core
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
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

describe("BruteForceProtection — core", () => {
  beforeAll(async () => {
    protection = new BruteForceProtection(testRedis, mockMetrics, testConfig);
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
      const result = await protection.checkLoginAttempt(
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
      const result = await protection.checkLoginAttempt(email, `10.0.0.2`, testUserAgent);

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

      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.allowed).toBe(true);
      expect(result.delaySeconds).toBe(testConfig.baseDelaySeconds);
    });

    it("should apply exponential backoff after multiple failures", async () => {
      const email = `delay2-${timestamp}@example.com`;
      const ip = `10.1.0.2`;

      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      const expectedDelay = testConfig.baseDelaySeconds! * Math.pow(testConfig.exponentialBase!, 1);
      expect(result.delaySeconds).toBe(expectedDelay);
    });

    it("should cap delay at maxDelaySeconds", async () => {
      const email = `delay3-${timestamp}@example.com`;
      const ip = `10.1.0.3`;

      for (let i = 0; i < 10; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

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

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.captchaRequired).toBe(false);
    });

    it("should require CAPTCHA after threshold failures", async () => {
      const email = `captcha2-${timestamp}@example.com`;
      const ip = `10.2.0.2`;

      for (let i = 0; i < testConfig.captchaThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.captchaRequired).toBe(true);
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
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Account temporarily locked");
      expect(result.lockoutExpiresAt).toBeTruthy();
    });

    it("should return lockout expiration time", async () => {
      const email = `lockout2-${timestamp}@example.com`;
      const ip = `10.3.0.2`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      const result = await protection.checkLoginAttempt(email, ip, testUserAgent);

      expect(result.lockoutExpiresAt).toBeTruthy();
      expect(result.lockoutExpiresAt > new Date()).toBeTruthy();
    });

    it("should allow admin to unlock account", async () => {
      const email = `lockout3-${timestamp}@example.com`;
      const ip = `10.3.0.3`;
      const adminId = `admin-${timestamp}`;

      for (let i = 0; i < testConfig.lockoutThreshold!; i++) {
        await protection.recordFailedAttempt(email, ip, testUserAgent, "Invalid password");
      }

      let result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.allowed).toBe(false);

      const unlocked = await protection.unlockAccount(email, adminId);
      expect(unlocked).toBe(true);

      result = await protection.checkLoginAttempt(email, ip, testUserAgent);
      expect(result.allowed).toBe(true);
    });
  });
});
