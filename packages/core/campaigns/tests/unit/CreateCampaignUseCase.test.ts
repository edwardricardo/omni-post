/**
 * @file CreateCampaignUseCase.test.ts
 * @description Unit tests for CreateCampaignUseCase — happy path, invalid
 *   projectId, invalid campaign name, repository save failure, parent-project
 *   ownership resolution (foreign/missing project → NOT_FOUND before any
 *   persistence), and accountId threading from the guard-resolved project.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CreateCampaignUseCase } from "../../src/CreateCampaignUseCase.js";
import type { CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { Campaign } from "@core/domain/entities/Campaign.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(saveFails = false): CampaignRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    findByProjectId: vi.fn(async () => ok([])),
    addPost: vi.fn(async () => ok(undefined)),
    removePost: vi.fn(async () => ok(undefined)),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as CampaignRepository & { save: ReturnType<typeof vi.fn> };
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
        found ? ok(makeProject()) : err(new EntityNotFoundError("Project", VALID_PROJECT_ID))
      ),
  }) as unknown as ProjectRepositoryPort & { findById: ReturnType<typeof vi.fn> };

const BASE_INPUT = {
  projectId: VALID_PROJECT_ID,
  name: "Summer Campaign 2024",
};

describe("CreateCampaignUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the campaign id when projectId and name are valid", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when projectId is not a valid UUID", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), makeProjectRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, projectId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when campaign name is empty", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), makeProjectRepo(true), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, name: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the repository save fails", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(true), makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });

  it("returns NOT_FOUND (never persisting) when the project is foreign/missing", async () => {
    const repo = makeMockRepo();
    const uc = new CreateCampaignUseCase(repo, makeProjectRepo(false), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok, "foreign project must fail");
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
    assert.strictEqual(
      repo.save.mock.calls.length,
      0,
      "no row may be persisted for a foreign project"
    );
  });

  it("threads the resolved project's accountId onto the persisted campaign", async () => {
    const repo = makeMockRepo();
    const uc = new CreateCampaignUseCase(repo, makeProjectRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.save.mock.calls.length, 1);
    const savedCampaign = repo.save.mock.calls[0]?.[0] as Campaign;
    assert.strictEqual(savedCampaign.accountId, ACCOUNT_ID, "accountId must come from the project");
  });
});
