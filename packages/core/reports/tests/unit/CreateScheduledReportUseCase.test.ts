/**
 * @file CreateScheduledReportUseCase.test.ts
 * @description Unit tests for CreateScheduledReportUseCase — happy path, invalid
 *   project id, invalid cron schedule (entity validation), and empty name validation
 *   against a mocked ScheduledReportRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateScheduledReportUseCase } from "../../src/CreateScheduledReportUseCase.js";
import type { ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440030";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(saveFails = false): ScheduledReportRepository {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    list: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as ScheduledReportRepository;
}

const BASE_INPUT = {
  projectId: PROJECT_ID,
  name: "Weekly Performance",
  cronSchedule: "0 9 * * 1",
  recipients: ["admin@example.com"],
};

describe("CreateScheduledReportUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the new report id when all fields are valid", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when the project id is not a valid UUID", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, projectId: "bad-project-id" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the cron schedule is malformed", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, cronSchedule: "not-a-cron" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the report name is empty", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, name: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
