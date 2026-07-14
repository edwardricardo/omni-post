/**
 * @file campaignUseCases.test.ts
 * @description Tests for CreateCampaignUseCase — project ID validation, entity creation, persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { CreateCampaignUseCase } from "@core/campaigns/CreateCampaignUseCase.js";
import { ProjectId, AccountId } from "@core/domain/value-objects/EntityId.js";
import { Project } from "@core/domain/entities/Project.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function makeRepo() {
  return {
    save: vi.fn(async () => ({ ok: true as const, value: undefined })),
    findById: vi.fn(async () => ({ ok: false as const, error: new Error("Not found") })),
    findByProjectId: vi.fn(async () => []),
  };
}

function makeProjectRepo(found = true) {
  const created = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Owner Project",
  });
  const value = created.ok ? created.value : undefined;
  return {
    findById: vi.fn(async () =>
      found ? { ok: true as const, value } : { ok: false as const, error: new Error("Not found") }
    ),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: ProjectId.generate().value,
    name: "Q1 Launch Campaign",
    ...overrides,
  };
}

describe("CreateCampaignUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: CreateCampaignUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new CreateCampaignUseCase(repo as any, makeProjectRepo() as any);
  });

  it("creates campaign and returns ID", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.id);
    assert.ok(r.value.id.length > 10);
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects invalid project ID", async () => {
    const r = await uc.execute(makeInput({ projectId: "not-a-uuid" }));
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Invalid projectId");
  });

  it("passes name to Campaign entity", async () => {
    const r = await uc.execute(makeInput({ name: "Summer Sale" }));
    assert.ok(r.ok);
    // Campaign was saved — verify repo was called
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects empty name (domain validation)", async () => {
    const r = await uc.execute(makeInput({ name: "" }));
    assert.ok(!r.ok);
  });

  it("passes optional description", async () => {
    const r = await uc.execute(makeInput({ description: "Campaign description" }));
    assert.ok(r.ok);
  });

  it("passes optional dates", async () => {
    const r = await uc.execute(
      makeInput({
        startDate: new Date("2025-04-01"),
        endDate: new Date("2025-06-30"),
      })
    );
    assert.ok(r.ok);
  });

  it("passes optional UTM fields", async () => {
    const r = await uc.execute(
      makeInput({
        utmSource: "instagram",
        utmMedium: "social",
      })
    );
    assert.ok(r.ok);
  });

  it("returns error when repo save fails", async () => {
    repo.save.mockResolvedValueOnce({ ok: false, error: new Error("DB error") });
    const r = await uc.execute(makeInput());
    assert.ok(!r.ok);
    expect(r.error.message).toContain("Failed to save");
  });
});
