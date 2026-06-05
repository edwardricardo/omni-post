/**
 * @file CreateCustomReportUseCase.test.ts
 * @description Unit tests for CreateCustomReportUseCase — happy path, validation
 *   errors (missing name), and repository save failure.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CreateCustomReportUseCase } from "../../src/CreateCustomReportUseCase.js";
import type { CustomReportRepository } from "@core/domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(saveFails = false): CustomReportRepository {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok("report-uuid-001"))),
    findById: vi.fn(async () => err(new Error("not found"))),
    findByAccountId: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as CustomReportRepository;
}

const BASE_INPUT = {
  accountId: "acc-uuid-001",
  name: "Monthly Engagement Report",
  // Use canonical domain metric/dimension keys from MetricRegistry + ReportSchema
  metrics: ["impressions", "likes"],
  dimensions: ["platform"],
  createdById: "user-uuid-001",
};

describe("CreateCustomReportUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the report id when input is valid", async () => {
    const uc = new CreateCustomReportUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when the report name is empty", async () => {
    const uc = new CreateCustomReportUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, name: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the metrics array is empty", async () => {
    const uc = new CreateCustomReportUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, metrics: [] });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the repository save fails", async () => {
    const uc = new CreateCustomReportUseCase(makeMockRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
