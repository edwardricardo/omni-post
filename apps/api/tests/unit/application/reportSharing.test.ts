/**
 * @file reportSharing.test.ts
 * @description Unit tests for EnableReportSharingUseCase and DisableReportSharingUseCase.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { EnableReportSharingUseCase } from "../../../src/application/custom-reports/EnableReportSharingUseCase.js";
import { DisableReportSharingUseCase } from "../../../src/application/custom-reports/DisableReportSharingUseCase.js";
import { ok, err } from "@shared/types";

function makeMockRepo(dto = { id: "r-1", accountId: "acc-1", isShared: false }) {
  return {
    findById: vi.fn().mockResolvedValue(ok(dto)),
    findByAccountId: vi.fn().mockResolvedValue([]),
    save: vi.fn().mockResolvedValue(ok("id")),
    update: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    saveSchedule: vi.fn().mockResolvedValue(ok("id")),
    findSchedulesByReportId: vi.fn().mockResolvedValue([]),
  };
}

describe("EnableReportSharingUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: EnableReportSharingUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new EnableReportSharingUseCase(repo as never);
  });

  it("generates unique share token", async () => {
    const result = await useCase.execute({ reportId: "r-1", accountId: "acc-1" });

    assert.ok(result.ok);
    assert.ok(result.value.shareToken.length > 0);
    assert.ok(result.value.shareUrl.includes(result.value.shareToken));
  });

  it("calls repository.update with shareToken and shareEnabled", async () => {
    await useCase.execute({ reportId: "r-1", accountId: "acc-1" });

    expect(repo.update).toHaveBeenCalledOnce();
    const updateCall = repo.update.mock.calls[0] as [string, Record<string, unknown>];
    assert.strictEqual(updateCall[0], "r-1");
    assert.strictEqual(updateCall[1].shareEnabled, true);
    assert.ok(typeof updateCall[1].shareToken === "string");
  });

  it("sets expiry date when provided", async () => {
    await useCase.execute({ reportId: "r-1", accountId: "acc-1", expiresAt: "2026-06-01" });

    const updateCall = repo.update.mock.calls[0] as [string, Record<string, unknown>];
    assert.ok(updateCall[1].shareExpiresAt instanceof Date);
  });

  it("rejects access for different account", async () => {
    const result = await useCase.execute({ reportId: "r-1", accountId: "other-acc" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("Access denied"));
  });

  it("returns NOT_FOUND for missing report", async () => {
    repo.findById.mockResolvedValue(err({ name: "EntityNotFoundError", message: "Not found" }));

    const result = await useCase.execute({ reportId: "nope", accountId: "acc-1" });

    assert.ok(!result.ok);
    assert.ok(result.error.message.includes("not found"));
  });
});

describe("DisableReportSharingUseCase", () => {
  let repo: ReturnType<typeof makeMockRepo>;
  let useCase: DisableReportSharingUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    useCase = new DisableReportSharingUseCase(repo as never);
  });

  it("clears shareToken and disables sharing", async () => {
    const result = await useCase.execute({ reportId: "r-1", accountId: "acc-1" });

    assert.ok(result.ok);
    expect(repo.update).toHaveBeenCalledOnce();
    const updateCall = repo.update.mock.calls[0] as [string, Record<string, unknown>];
    assert.strictEqual(updateCall[1].shareEnabled, false);
    assert.strictEqual(updateCall[1].shareToken, null);
    assert.strictEqual(updateCall[1].shareExpiresAt, null);
  });

  it("rejects access for different account", async () => {
    const result = await useCase.execute({ reportId: "r-1", accountId: "other-acc" });

    assert.ok(!result.ok);
  });
});
