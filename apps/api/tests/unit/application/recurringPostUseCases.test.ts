/**
 * @file recurringPostUseCases.test.ts
 * @description Tests for CreateRecurringPostUseCase — cron validation, ID validation, persistence.
 * @layer test
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { CreateRecurringPostUseCase } from "../../../src/application/recurring/CreateRecurringPostUseCase.js";
import { ProjectId } from "../../../src/domain/value-objects/EntityId.js";

function makeRepo() {
  return {
    save: vi.fn(async (data: any) => ({ ok: true as const, value: data })),
    findById: vi.fn(async () => null),
    findByProjectId: vi.fn(async () => []),
  };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: ProjectId.generate().value,
    templatePostId: "template-post-1",
    name: "Weekly Update",
    cronExpression: "0 9 * * MON",
    startDate: new Date("2025-04-01").toISOString(),
    channels: ["channel-1"],
    ...overrides,
  };
}

describe("CreateRecurringPostUseCase", () => {
  let repo: ReturnType<typeof makeRepo>;
  let uc: CreateRecurringPostUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeRepo();
    uc = new CreateRecurringPostUseCase(repo as any);
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
    const r = await uc.execute(makeInput({ channels: ["ch-1", "ch-2"] }));
    assert.ok(r.ok);
    assert.deepEqual(r.value.channels, ["ch-1", "ch-2"]);
  });

  it("includes createdAt timestamp in output", async () => {
    const r = await uc.execute(makeInput());
    assert.ok(r.ok);
    assert.ok(r.value.createdAt);
  });
});
