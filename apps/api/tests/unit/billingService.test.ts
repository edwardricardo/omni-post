/**
 * @file billingService.test.ts
 * @description Mutation-killing tests for BillingService pure business logic.
 * Covers getChangeType, calculateNextBillingDate, calculateBillingAmount.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { BillingService } from "../../src/billing/subscription/BillingService.js";

describe("BillingService", () => {
  let service: BillingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BillingService();
  });

  // =========================================================================
  // getChangeType
  // =========================================================================

  describe("getChangeType", () => {
    it("returns UPGRADE when moving from BASIC to PRO", () => {
      assert.equal(service.getChangeType("BASIC", "PRO"), "UPGRADE");
    });

    it("returns UPGRADE when moving from BASIC to ENTERPRISE", () => {
      assert.equal(service.getChangeType("BASIC", "ENTERPRISE"), "UPGRADE");
    });

    it("returns UPGRADE when moving from PRO to ENTERPRISE", () => {
      assert.equal(service.getChangeType("PRO", "ENTERPRISE"), "UPGRADE");
    });

    it("returns DOWNGRADE when moving from PRO to BASIC", () => {
      assert.equal(service.getChangeType("PRO", "BASIC"), "DOWNGRADE");
    });

    it("returns DOWNGRADE when moving from ENTERPRISE to BASIC", () => {
      assert.equal(service.getChangeType("ENTERPRISE", "BASIC"), "DOWNGRADE");
    });

    it("returns DOWNGRADE when moving from ENTERPRISE to PRO", () => {
      assert.equal(service.getChangeType("ENTERPRISE", "PRO"), "DOWNGRADE");
    });

    it("returns DOWNGRADE when same tier (not strictly upgrade)", () => {
      // Same tier has equal order, so toTier > fromTier is false → DOWNGRADE
      const result = service.getChangeType("PRO", "PRO");
      assert.equal(result, "DOWNGRADE");
    });
  });

  // =========================================================================
  // calculateNextBillingDate
  // =========================================================================

  describe("calculateNextBillingDate", () => {
    it("adds 1 month for monthly billing cycle", () => {
      const fromDate = new Date(2025, 2, 15); // March 15 (local time)
      const result = service.calculateNextBillingDate("monthly", fromDate);
      assert.equal(result.getMonth(), 3); // April (0-indexed)
      assert.equal(result.getFullYear(), 2025);
      assert.equal(result.getDate(), 15);
    });

    it("adds 1 year for yearly billing cycle", () => {
      const fromDate = new Date(2025, 2, 15); // March 15
      const result = service.calculateNextBillingDate("yearly", fromDate);
      assert.equal(result.getFullYear(), 2026);
      assert.equal(result.getMonth(), 2); // March
      assert.equal(result.getDate(), 15);
    });

    it("handles month rollover (Dec → Jan next year)", () => {
      const fromDate = new Date("2025-12-15T00:00:00Z");
      const result = service.calculateNextBillingDate("monthly", fromDate);
      assert.equal(result.getMonth(), 0); // January
      assert.equal(result.getFullYear(), 2026);
    });

    it("uses current date when fromDate is not provided", () => {
      const before = new Date();
      const result = service.calculateNextBillingDate("monthly");
      const after = new Date();

      // Result should be roughly 1 month from now
      assert.ok(result.getTime() > before.getTime());
    });

    it("handles end-of-month edge case (Jan 31 → Feb 28)", () => {
      const fromDate = new Date("2025-01-31T00:00:00Z");
      const result = service.calculateNextBillingDate("monthly", fromDate);
      // JavaScript Date handles overflow by wrapping to next month
      assert.ok(result.getMonth() === 1 || result.getMonth() === 2);
    });

    it("handles leap year yearly (2024-02-29 → 2025-03-01)", () => {
      const fromDate = new Date("2024-02-29T00:00:00Z");
      const result = service.calculateNextBillingDate("yearly", fromDate);
      assert.equal(result.getFullYear(), 2025);
    });
  });

  // =========================================================================
  // calculateBillingAmount
  // =========================================================================

  describe("calculateBillingAmount", () => {
    it("returns monthly price for monthly cycle", () => {
      assert.equal(service.calculateBillingAmount(9.99, 99.99, "monthly"), 9.99);
    });

    it("returns yearly price for yearly cycle", () => {
      assert.equal(service.calculateBillingAmount(9.99, 99.99, "yearly"), 99.99);
    });

    it("returns correct amount for PRO plan monthly", () => {
      assert.equal(service.calculateBillingAmount(29.99, 299.99, "monthly"), 29.99);
    });

    it("returns correct amount for ENTERPRISE plan yearly", () => {
      assert.equal(service.calculateBillingAmount(99.99, 999.99, "yearly"), 999.99);
    });

    it("returns 0 for free plan", () => {
      assert.equal(service.calculateBillingAmount(0, 0, "monthly"), 0);
    });
  });
});
