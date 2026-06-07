/**
 * @file CreateCampaignUseCase.test.ts
 * @description Unit tests for CreateCampaignUseCase — happy path, invalid
 *   projectId, invalid campaign name, and repository save failure.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { CreateCampaignUseCase } from "../../src/CreateCampaignUseCase.js";
import type { CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeMockRepo(saveFails = false): CampaignRepository {
  return {
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
    findById: vi.fn(async () => err(new Error("not found"))),
    findByProjectId: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as CampaignRepository;
}

const BASE_INPUT = {
  projectId: VALID_PROJECT_ID,
  name: "Summer Campaign 2024",
};

describe("CreateCampaignUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the campaign id when projectId and name are valid", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok but got err: ${r.ok ? "" : r.error.message}`);
    assert.ok(r.value.id.length > 0);
  });

  it("returns VALIDATION_FAILED when projectId is not a valid UUID", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, projectId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns VALIDATION_FAILED when campaign name is empty", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(), passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, name: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when the repository save fails", async () => {
    const uc = new CreateCampaignUseCase(makeMockRepo(true), passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.INTERNAL_ERROR);
  });
});
