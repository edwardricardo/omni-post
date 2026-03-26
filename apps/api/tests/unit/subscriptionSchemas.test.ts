/**
 * @file subscriptionSchemas.test.ts
 * @description Mutation-killing tests for Zod subscription schemas.
 * Tests validation logic: required fields, enum values, coercion, min/max bounds.
 * @layer test
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import {
  SubscriptionChangeSchema,
  ValidateLimitsSchema,
  BulkUpgradeSchema,
  SubscriptionFiltersSchema,
  ExportQuerySchema,
  StartTrialSchema,
  ConvertTrialSchema,
  ExpiringTrialsQuerySchema,
} from "../../src/billing/subscriptionSchemas.js";

describe("SubscriptionChangeSchema", () => {
  it("accepts valid change request", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "PRO",
      billingCycle: "monthly",
    });
    assert.ok(result.success);
  });

  it("rejects invalid tier", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "INVALID",
      billingCycle: "monthly",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid billing cycle", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "PRO",
      billingCycle: "weekly",
    });
    assert.ok(!result.success);
  });

  it("accepts optional reason", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "ENTERPRISE",
      billingCycle: "yearly",
      reason: "Business growth",
    });
    assert.ok(result.success);
  });

  it("accepts optional effectiveDate", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "PRO",
      billingCycle: "monthly",
      effectiveDate: "2025-04-01T00:00:00Z",
    });
    assert.ok(result.success);
  });

  it("requires newTier", () => {
    const result = SubscriptionChangeSchema.safeParse({
      billingCycle: "monthly",
    });
    assert.ok(!result.success);
  });

  it("requires billingCycle", () => {
    const result = SubscriptionChangeSchema.safeParse({
      newTier: "PRO",
    });
    assert.ok(!result.success);
  });
});

describe("ValidateLimitsSchema", () => {
  it("accepts valid operation", () => {
    const result = ValidateLimitsSchema.safeParse({
      operation: "CREATE_PROJECT",
    });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.amount, 1); // default
    }
  });

  it("accepts all valid operations", () => {
    for (const op of ["CREATE_PROJECT", "ADD_TEAM_MEMBER", "UPLOAD_MEDIA"]) {
      assert.ok(ValidateLimitsSchema.safeParse({ operation: op }).success);
    }
  });

  it("rejects invalid operation", () => {
    assert.ok(!ValidateLimitsSchema.safeParse({ operation: "DELETE" }).success);
  });

  it("rejects amount less than 1", () => {
    assert.ok(!ValidateLimitsSchema.safeParse({ operation: "CREATE_PROJECT", amount: 0 }).success);
  });

  it("accepts custom amount", () => {
    const result = ValidateLimitsSchema.safeParse({
      operation: "UPLOAD_MEDIA",
      amount: 5,
    });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.amount, 5);
  });
});

describe("BulkUpgradeSchema", () => {
  it("accepts valid bulk upgrade", () => {
    const result = BulkUpgradeSchema.safeParse({
      accountIds: ["550e8400-e29b-41d4-a716-446655440000"],
      newTier: "PRO",
      billingCycle: "monthly",
    });
    assert.ok(result.success);
  });

  it("rejects empty accountIds", () => {
    assert.ok(
      !BulkUpgradeSchema.safeParse({
        accountIds: [],
        newTier: "PRO",
        billingCycle: "monthly",
      }).success
    );
  });

  it("rejects more than 50 accountIds", () => {
    const ids = Array.from({ length: 51 }, () => "550e8400-e29b-41d4-a716-446655440000");
    assert.ok(
      !BulkUpgradeSchema.safeParse({
        accountIds: ids,
        newTier: "PRO",
        billingCycle: "monthly",
      }).success
    );
  });

  it("accepts exactly 50 accountIds", () => {
    const ids = Array.from({ length: 50 }, () => "550e8400-e29b-41d4-a716-446655440000");
    assert.ok(
      BulkUpgradeSchema.safeParse({
        accountIds: ids,
        newTier: "PRO",
        billingCycle: "monthly",
      }).success
    );
  });
});

describe("SubscriptionFiltersSchema", () => {
  it("accepts empty filters with defaults", () => {
    const result = SubscriptionFiltersSchema.safeParse({});
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.page, 1);
      assert.equal(result.data.limit, 50);
    }
  });

  it("accepts valid sort options", () => {
    for (const sortBy of ["createdAt", "updatedAt", "email", "subscription"]) {
      assert.ok(SubscriptionFiltersSchema.safeParse({ sortBy }).success);
    }
  });

  it("rejects invalid sortBy", () => {
    assert.ok(!SubscriptionFiltersSchema.safeParse({ sortBy: "invalid" }).success);
  });

  it("rejects limit > 100", () => {
    assert.ok(!SubscriptionFiltersSchema.safeParse({ limit: "101" }).success);
  });

  it("rejects page < 1", () => {
    assert.ok(!SubscriptionFiltersSchema.safeParse({ page: "0" }).success);
  });

  it("coerces string numbers", () => {
    const result = SubscriptionFiltersSchema.safeParse({ page: "3", limit: "25" });
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.data.page, 3);
      assert.equal(result.data.limit, 25);
    }
  });
});

describe("ExportQuerySchema", () => {
  it("defaults format to json", () => {
    const result = ExportQuerySchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.format, "json");
  });

  it("accepts csv format", () => {
    const result = ExportQuerySchema.safeParse({ format: "csv" });
    assert.ok(result.success);
  });

  it("rejects invalid format", () => {
    assert.ok(!ExportQuerySchema.safeParse({ format: "xml" }).success);
  });

  it("accepts date range", () => {
    const result = ExportQuerySchema.safeParse({
      startDate: "2025-01-01T00:00:00Z",
      endDate: "2025-12-31T23:59:59Z",
    });
    assert.ok(result.success);
  });
});

describe("StartTrialSchema", () => {
  it("defaults tier to PRO", () => {
    const result = StartTrialSchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.tier, "PRO");
  });

  it("defaults trialDurationDays to 7", () => {
    const result = StartTrialSchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.trialDurationDays, 7);
  });

  it("defaults autoRenewal to false", () => {
    const result = StartTrialSchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.autoRenewal, false);
  });

  it("rejects trial duration > 30 days", () => {
    assert.ok(!StartTrialSchema.safeParse({ trialDurationDays: 31 }).success);
  });

  it("rejects trial duration < 1 day", () => {
    assert.ok(!StartTrialSchema.safeParse({ trialDurationDays: 0 }).success);
  });

  it("accepts exactly 30 days", () => {
    assert.ok(StartTrialSchema.safeParse({ trialDurationDays: 30 }).success);
  });

  it("accepts exactly 1 day", () => {
    assert.ok(StartTrialSchema.safeParse({ trialDurationDays: 1 }).success);
  });
});

describe("ConvertTrialSchema", () => {
  it("defaults billingCycle to monthly", () => {
    const result = ConvertTrialSchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.billingCycle, "monthly");
  });

  it("accepts yearly billing cycle", () => {
    const result = ConvertTrialSchema.safeParse({ billingCycle: "yearly" });
    assert.ok(result.success);
  });
});

describe("ExpiringTrialsQuerySchema", () => {
  it("defaults days to 1", () => {
    const result = ExpiringTrialsQuerySchema.safeParse({});
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.days, 1);
  });

  it("rejects days > 30", () => {
    assert.ok(!ExpiringTrialsQuerySchema.safeParse({ days: "31" }).success);
  });

  it("rejects days < 1", () => {
    assert.ok(!ExpiringTrialsQuerySchema.safeParse({ days: "0" }).success);
  });

  it("coerces string to number", () => {
    const result = ExpiringTrialsQuerySchema.safeParse({ days: "15" });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.days, 15);
  });
});
