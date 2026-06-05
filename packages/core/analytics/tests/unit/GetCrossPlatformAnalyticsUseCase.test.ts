/**
 * @file GetCrossPlatformAnalyticsUseCase.test.ts
 * @description Unit tests for GetCrossPlatformAnalyticsUseCase — happy path,
 *   validation errors for missing accountId, invalid time range, and missing
 *   custom date range fields.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  GetCrossPlatformAnalyticsUseCase,
  type CrossPlatformAnalyticsPort,
} from "../../src/GetCrossPlatformAnalyticsUseCase.js";

function makeMetricsStub() {
  return {
    summary: {
      totalPosts: 100,
      totalEngagements: 500,
      avgEngagementRate: 5.0,
      totalReach: 10000,
    },
  };
}

function makeMockEngine(fails = false): CrossPlatformAnalyticsPort {
  return {
    generateCrossPlatformMetrics: vi.fn(async () => {
      if (fails) throw new Error("Engine failure");
      return makeMetricsStub();
    }),
  };
}

const BASE_INPUT = {
  accountId: "acc-uuid-001",
  timeRange: "30d" as const,
};

describe("GetCrossPlatformAnalyticsUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns analytics summary when accountId and timeRange are valid", async () => {
    const uc = new GetCrossPlatformAnalyticsUseCase(makeMockEngine());
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(r.value.summary.totalPosts, 100);
    assert.strictEqual(r.value.summary.totalEngagements, 500);
  });

  it("returns VALIDATION_FAILED when accountId is empty", async () => {
    const uc = new GetCrossPlatformAnalyticsUseCase(makeMockEngine());
    const r = await uc.execute({ ...BASE_INPUT, accountId: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when timeRange is not a recognised value", async () => {
    const uc = new GetCrossPlatformAnalyticsUseCase(makeMockEngine());
    const r = await uc.execute({ ...BASE_INPUT, timeRange: "60d" as never });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED for custom timeRange without startDate and endDate", async () => {
    const uc = new GetCrossPlatformAnalyticsUseCase(makeMockEngine());
    const r = await uc.execute({ ...BASE_INPUT, timeRange: "custom" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the analytics engine throws", async () => {
    const uc = new GetCrossPlatformAnalyticsUseCase(makeMockEngine(true));
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
