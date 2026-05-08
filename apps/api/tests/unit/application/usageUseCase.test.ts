/**
 * @file usageUseCase.test.ts
 * @description Tests for GetUsageUseCase — validation, happy path
 *              (rich DTO with plan + limits), missing-account NotFound,
 *              and zeroed counters when no UsageMetric row exists.
 * @layer infrastructure
 */

import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { GetUsageUseCase } from "../../../src/application/usage/GetUsageUseCase.js";

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    plan: "Pro",
    channelsCount: 4,
    postsLimit: 100,
    channelsLimit: 10,
    teamMembersLimit: 5,
    storageLimitGb: 10,
    isOnTrial: false,
    trialEndDate: null,
    nextBillingDate: new Date("2026-06-08T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo(opts: {
  metric?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
}) {
  return {
    findByPeriod: vi.fn(async () => opts.metric ?? null),
    findAccountContext: vi.fn(async () => opts.context ?? null),
    increment: vi.fn(async () => {}),
    set: vi.fn(async () => {}),
  };
}

describe("GetUsageUseCase", () => {
  it("returns NotFound when account does not exist", async () => {
    const uc = new GetUsageUseCase(makeRepo({ context: null }) as never);
    const r = await uc.execute({ accountId: "missing", year: 2026, month: 5 });
    assert.ok(!r.ok);
    if (r.ok) return;
    assert.match(r.error.message, /Account not found/);
  });

  it("returns zeroed counters + plan context when no UsageMetric row exists yet", async () => {
    const uc = new GetUsageUseCase(makeRepo({ metric: null, context: makeContext() }) as never);
    const r = await uc.execute({ accountId: "acc-1", year: 2026, month: 5 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.postsPublished, 0);
    assert.equal(r.value.aiCallsMade, 0);
    assert.equal(r.value.storageGb, 0);
    assert.equal(r.value.teamMemberCount, 0);
    assert.equal(r.value.plan, "Pro");
    assert.equal(r.value.channelsCount, 4);
    assert.equal(r.value.postsLimit, 100);
    assert.equal(r.value.channelsLimit, 10);
    assert.equal(r.value.storageLimitGb, 10);
    assert.equal(r.value.teamMembersLimit, 5);
    assert.equal(r.value.isOnTrial, false);
    assert.equal(r.value.trialEndDate, null);
    assert.equal(r.value.nextBillingDate, "2026-06-08T00:00:00.000Z");
  });

  it("returns stored counters merged with plan context when metric row exists", async () => {
    const metric = {
      accountId: "acc-1",
      periodYear: 2026,
      periodMonth: 5,
      postsPublished: 42,
      aiCallsMade: 10,
      storageGb: 2.5,
      teamMemberCount: 3,
    };
    const uc = new GetUsageUseCase(makeRepo({ metric, context: makeContext() }) as never);
    const r = await uc.execute({ accountId: "acc-1", year: 2026, month: 5 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.postsPublished, 42);
    assert.equal(r.value.aiCallsMade, 10);
    assert.equal(r.value.storageGb, 2.5);
    assert.equal(r.value.teamMemberCount, 3);
    assert.equal(r.value.plan, "Pro");
  });

  it("surfaces null limits as 'unlimited' (postsLimit + channelsLimit)", async () => {
    const uc = new GetUsageUseCase(
      makeRepo({
        context: makeContext({ postsLimit: null, channelsLimit: null }),
      }) as never
    );
    const r = await uc.execute({ accountId: "acc-1", year: 2026, month: 5 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.postsLimit, null);
    assert.equal(r.value.channelsLimit, null);
  });

  it("returns trial dates as ISO strings when in trial", async () => {
    const trialEnd = new Date("2026-05-15T12:00:00Z");
    const uc = new GetUsageUseCase(
      makeRepo({
        context: makeContext({ isOnTrial: true, trialEndDate: trialEnd }),
      }) as never
    );
    const r = await uc.execute({ accountId: "acc-1", year: 2026, month: 5 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.isOnTrial, true);
    assert.equal(r.value.trialEndDate, "2026-05-15T12:00:00.000Z");
  });

  it("rejects empty accountId", async () => {
    const uc = new GetUsageUseCase(makeRepo({}) as never);
    const r = await uc.execute({ accountId: "", year: 2026, month: 5 });
    assert.ok(!r.ok);
  });

  it("rejects month < 1", async () => {
    const uc = new GetUsageUseCase(makeRepo({}) as never);
    assert.ok(!(await uc.execute({ accountId: "a", year: 2026, month: 0 })).ok);
  });

  it("rejects month > 12", async () => {
    const uc = new GetUsageUseCase(makeRepo({}) as never);
    assert.ok(!(await uc.execute({ accountId: "a", year: 2026, month: 13 })).ok);
  });

  it("accepts month 1 (boundary)", async () => {
    const uc = new GetUsageUseCase(makeRepo({ context: makeContext() }) as never);
    assert.ok((await uc.execute({ accountId: "a", year: 2026, month: 1 })).ok);
  });

  it("accepts month 12 (boundary)", async () => {
    const uc = new GetUsageUseCase(makeRepo({ context: makeContext() }) as never);
    assert.ok((await uc.execute({ accountId: "a", year: 2026, month: 12 })).ok);
  });
});
