/**
 * @file CreateScheduledReportUseCase.test.ts
 * @description Unit tests for CreateScheduledReportUseCase — happy path, invalid
 *   project id, invalid cron schedule (entity validation), empty name validation,
 *   parent-project ownership resolution (foreign/missing project → NOT_FOUND
 *   before any persistence), and accountId threading from the guard-resolved
 *   project, against mocked ScheduledReportRepository + ProjectRepositoryPort.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateScheduledReportUseCase } from "../../src/CreateScheduledReportUseCase.js";
import type { ScheduledReportRepository } from "@core/domain/repositories/ScheduledReportRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ScheduledReport } from "@core/domain/entities/ScheduledReport.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440030";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(
  saveFails = false
): ScheduledReportRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    findByProjectId: vi.fn(async () => []),
    findDueReports: vi.fn(async () => []),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as ScheduledReportRepository & { save: ReturnType<typeof vi.fn> };
}

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

// Narrow mock — the use case only calls findById. Cast to the port for the ctor.
const makeProjectRepo = (found = true) =>
  ({
    findById: vi
      .fn()
      .mockResolvedValue(
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

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
    const uc = new CreateScheduledReportUseCase(
      makeMockRepo(),
      makeProjectRepo(true),
      passthroughUow
    );
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when the project id is not a valid UUID", async () => {
    const uc = new CreateScheduledReportUseCase(
      makeMockRepo(),
      makeProjectRepo(true),
      passthroughUow
    );
    const r = await uc.execute({ ...BASE_INPUT, projectId: "bad-project-id" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the cron schedule is malformed", async () => {
    const uc = new CreateScheduledReportUseCase(
      makeMockRepo(),
      makeProjectRepo(true),
      passthroughUow
    );
    const r = await uc.execute({ ...BASE_INPUT, cronSchedule: "not-a-cron" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when the report name is empty", async () => {
    const uc = new CreateScheduledReportUseCase(
      makeMockRepo(),
      makeProjectRepo(true),
      passthroughUow
    );
    const r = await uc.execute({ ...BASE_INPUT, name: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns NOT_FOUND (never persisting) when the project is foreign/missing", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, makeProjectRepo(false), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok, "foreign project must fail");
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
    assert.strictEqual(
      repo.save.mock.calls.length,
      0,
      "no row may be persisted for a foreign project"
    );
  });

  it("threads the resolved project's accountId onto the persisted report", async () => {
    const repo = makeMockRepo();
    const uc = new CreateScheduledReportUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.save.mock.calls.length, 1);
    const savedReport = repo.save.mock.calls[0]?.[0] as ScheduledReport;
    assert.strictEqual(savedReport.accountId, ACCOUNT_ID, "accountId must come from the project");
  });
});
