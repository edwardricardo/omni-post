/**
 * @file recurringPostUseCases.test.ts
 * @description Tests for CreateRecurringPostUseCase — cron validation, ID
 *   validation, triple parent-ownership (project guarded + template/channel
 *   project-consistency), and persistence.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { CreateRecurringPostUseCase } from "@core/recurring/CreateRecurringPostUseCase.js";
import { Project } from "@core/domain/entities/Project.js";
import { AccountId, ChannelId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const ACCOUNT_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "b3000000-0000-4000-8000-000000000001";

function makeRepo() {
  return {
    save: vi.fn(async (data: unknown) => ({ ok: true as const, value: data })),
    findById: vi.fn(async () => err(new EntityNotFoundError("RecurringPost", "x"))),
    findByProjectId: vi.fn(async () => ok([])),
    findActiveByNextScheduled: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
  };
}

const makeProject = (): Project => {
  const result = Project.create({
    accountId: AccountId.fromStringUnsafe(ACCOUNT_ID),
    name: "Test Project",
  });
  if (!result.ok) throw new Error("fixture: Project.create failed");
  return result.value;
};

const CHANNEL_A = "e3000000-0000-4000-8000-000000000001";
const CHANNEL_B = "e3000000-0000-4000-8000-000000000002";

const makeProjectRepo = () => ({ findById: vi.fn(async () => ok(makeProject())) });
const makePostRepo = () => ({
  findById: vi.fn(async () => ok({ projectId: { value: PROJECT_ID } })),
});
// Decryption-free ownership lookup — returns the project's owned channel ids.
const makeChannelRepo = () => ({
  findIdsByProjectId: vi.fn(async () => [
    ChannelId.fromStringUnsafe(CHANNEL_A),
    ChannelId.fromStringUnsafe(CHANNEL_B),
  ]),
});

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    templatePostId: "d3000000-0000-4000-8000-000000000001",
    name: "Weekly Update",
    cronExpression: "0 9 * * MON",
    startDate: new Date("2025-04-01").toISOString(),
    channels: [CHANNEL_A],
    ...overrides,
  };
}

describe("CreateRecurringPostUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: CreateRecurringPostUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new CreateRecurringPostUseCase(
      repo as never,
      makeProjectRepo() as never,
      makePostRepo() as never,
      makeChannelRepo() as never
    );
  });

  it("creates recurring post with valid cron and returns output", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.id);
    assert.equal(r.value.name, "Weekly Update");
    assert.equal(r.value.cronExpression, "0 9 * * MON");
    assert.equal(r.value.isActive, true);
    assert.equal(r.value.occurrenceCount, 0);
  });

  it("calls repository.save", async () => {
    await uc.execute(makeInput());
    expect(repo.save).toHaveBeenCalledOnce();
  });

  it("rejects invalid cron expression", async () => {
    const r = await uc.execute(makeInput({ cronExpression: "not-a-cron" }));
    assert.ok(!r.ok);
  });

  it("rejects invalid project ID", async () => {
    const r = await uc.execute(makeInput({ projectId: "not-a-uuid" }));
    assert.ok(!r.ok);
  });

  it("accepts optional timezone", async () => {
    const r = await uc.execute(makeInput({ timezone: "America/New_York" }));
    assert.ok(r.ok);
  });

  it("accepts optional endDate", async () => {
    const r = await uc.execute(makeInput({ endDate: new Date("2025-12-31").toISOString() }));
    assert.ok(r.ok);
  });

  it("accepts optional maxOccurrences", async () => {
    const r = await uc.execute(makeInput({ maxOccurrences: 52 }));
    assert.ok(r.ok);
  });

  it("includes channels in output", async () => {
    const r = await uc.execute(makeInput({ channels: [CHANNEL_A, CHANNEL_B] }));
    assert.ok(r.ok);
    assert.deepEqual(r.value.channels, [CHANNEL_A, CHANNEL_B]);
  });

  it("includes createdAt timestamp in output", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.createdAt);
  });
});
