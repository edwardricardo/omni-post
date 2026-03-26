/**
 * @file usageUseCase.test.ts
 * @description Tests for GetUsageUseCase — validation, happy path, empty data.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { GetUsageUseCase } from "../../../src/application/usage/GetUsageUseCase.js";

function makeRepo(data: Record<string, any> | null = null) {
  return {
    findByPeriod: vi.fn(async () => data),
    upsert: vi.fn(async () => {}),
    increment: vi.fn(async () => {}),
  };
}

describe("GetUsageUseCase", () => {
  it("returns zeroed metrics when no data exists", async () => {
    const uc = new GetUsageUseCase(makeRepo(null) as any);
    const r = await uc.execute({ accountId: "acc-1", year: 2025, month: 3 });
    assert.ok(r.ok);
    assert.equal(r.value.postsPublished, 0);
    assert.equal(r.value.aiCallsMade, 0);
    assert.equal(r.value.storageGb, 0);
    assert.equal(r.value.teamMemberCount, 0);
    assert.equal(r.value.accountId, "acc-1");
    assert.equal(r.value.periodYear, 2025);
    assert.equal(r.value.periodMonth, 3);
  });

  it("returns stored metrics when data exists", async () => {
    const data = {
      accountId: "acc-1",
      periodYear: 2025,
      periodMonth: 3,
      postsPublished: 42,
      aiCallsMade: 10,
      storageGb: 2.5,
      teamMemberCount: 3,
    };
    const uc = new GetUsageUseCase(makeRepo(data) as any);
    const r = await uc.execute({ accountId: "acc-1", year: 2025, month: 3 });
    assert.ok(r.ok);
    assert.equal(r.value.postsPublished, 42);
    assert.equal(r.value.aiCallsMade, 10);
  });

  it("rejects empty accountId", async () => {
    const uc = new GetUsageUseCase(makeRepo() as any);
    const r = await uc.execute({ accountId: "", year: 2025, month: 3 });
    assert.ok(!r.ok);
  });

  it("rejects month < 1", async () => {
    const uc = new GetUsageUseCase(makeRepo() as any);
    assert.ok(!(await uc.execute({ accountId: "a", year: 2025, month: 0 })).ok);
  });

  it("rejects month > 12", async () => {
    const uc = new GetUsageUseCase(makeRepo() as any);
    assert.ok(!(await uc.execute({ accountId: "a", year: 2025, month: 13 })).ok);
  });

  it("accepts month 1 (boundary)", async () => {
    const uc = new GetUsageUseCase(makeRepo(null) as any);
    assert.ok((await uc.execute({ accountId: "a", year: 2025, month: 1 })).ok);
  });

  it("accepts month 12 (boundary)", async () => {
    const uc = new GetUsageUseCase(makeRepo(null) as any);
    assert.ok((await uc.execute({ accountId: "a", year: 2025, month: 12 })).ok);
  });
});
