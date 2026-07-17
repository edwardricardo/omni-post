/**
 * @file UntagPostFromCampaignUseCase.test.ts
 * @description Unit tests for UntagPostFromCampaignUseCase. Verifies that the
 *   parent campaign is resolved through the guard-scoped repository BEFORE the
 *   post association is removed: a foreign or missing campaign resolves to
 *   NOT_FOUND and `removePost` is never invoked, so the owner's join row is
 *   never touched. Closes the join-table IDOR that guard enrollment alone does
 *   not close (the join table carries no accountId column).
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { UntagPostFromCampaignUseCase } from "../../src/UntagPostFromCampaignUseCase.js";
import type { CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const VALID_CAMPAIGN_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_POST_ID = "660e8400-e29b-41d4-a716-446655440111";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

type MockCampaignRepo = CampaignRepository & {
  findById: ReturnType<typeof vi.fn>;
  removePost: ReturnType<typeof vi.fn>;
};

function makeMockRepo(campaignResolves: boolean): MockCampaignRepo {
  return {
    findById: vi.fn(async () =>
      campaignResolves
        ? ok({} as never)
        : err(new EntityNotFoundError("Campaign", VALID_CAMPAIGN_ID))
    ),
    removePost: vi.fn(async () => ok(undefined)),
    addPost: vi.fn(async () => ok(undefined)),
    save: vi.fn(async () => ok(undefined)),
    findByProjectId: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  } as unknown as MockCampaignRepo;
}

const BASE_INPUT = { campaignId: VALID_CAMPAIGN_ID, postId: VALID_POST_ID };

describe("UntagPostFromCampaignUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND and never calls removePost when the campaign is foreign/missing", async () => {
    const repo = makeMockRepo(false);
    const uc = new UntagPostFromCampaignUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(!r.ok, "foreign campaign must fail");
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
    assert.strictEqual(
      repo.removePost.mock.calls.length,
      0,
      "removePost must not run for a foreign campaign — the owner's join row survives"
    );
  });

  it("resolves the campaign then removes the post when the campaign belongs to the caller", async () => {
    const repo = makeMockRepo(true);
    const uc = new UntagPostFromCampaignUseCase(repo, passthroughUow);
    const r = await uc.execute(BASE_INPUT);
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.findById.mock.calls.length, 1, "campaign must be resolved first");
    assert.strictEqual(repo.removePost.mock.calls.length, 1);
  });

  it("returns VALIDATION_FAILED for a malformed campaignId before any repo call", async () => {
    const repo = makeMockRepo(true);
    const uc = new UntagPostFromCampaignUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, campaignId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
    assert.strictEqual(repo.findById.mock.calls.length, 0);
  });

  it("returns VALIDATION_FAILED when postId is empty", async () => {
    const repo = makeMockRepo(true);
    const uc = new UntagPostFromCampaignUseCase(repo, passthroughUow);
    const r = await uc.execute({ ...BASE_INPUT, postId: "" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
