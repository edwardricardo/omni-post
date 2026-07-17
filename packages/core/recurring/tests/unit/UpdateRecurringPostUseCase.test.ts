/**
 * @file UpdateRecurringPostUseCase.test.ts
 * @description Unit tests for UpdateRecurringPostUseCase — channel-repoint
 *   project-consistency (foreign channel → NOT_FOUND, never persisted) and
 *   accountId round-trip (fromPersistence → save carries the stored accountId).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { UpdateRecurringPostUseCase } from "../../src/UpdateRecurringPostUseCase.js";
import type {
  RecurringPostRepository,
  RecurringPostData,
} from "@core/domain/repositories/RecurringPostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { ChannelId } from "@core/domain/value-objects/EntityId.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "b2000000-0000-4000-8000-000000000001";
const REC_POST_ID = "a2000000-0000-4000-8000-000000000001";
const NEW_CHANNEL_ID = "e2000000-0000-4000-8000-000000000001";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

const storedData = (): RecurringPostData => ({
  id: REC_POST_ID,
  accountId: ACCOUNT_ID,
  projectId: PROJECT_ID,
  templatePostId: "d2000000-0000-4000-8000-000000000001",
  name: "Weekly",
  cronExpression: "0 9 * * MON",
  timezone: "UTC",
  startDate: new Date("2025-01-01T00:00:00.000Z"),
  occurrenceCount: 0,
  isActive: true,
  channels: ["e2000000-0000-4000-8000-000000000000"],
  contentVariation: "EXACT",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
});

function makeRepo(
  overrides?: Partial<RecurringPostRepository>
): RecurringPostRepository & { save: ReturnType<typeof vi.fn> } {
  return {
    findById: vi.fn(async () => ok(storedData())),
    save: vi.fn(async (data: RecurringPostData) => ok(data)),
    findByProjectId: vi.fn(async () => ok([])),
    findActiveByNextScheduled: vi.fn(async () => ok([])),
    delete: vi.fn(async () => ok(undefined)),
    ...overrides,
  } as unknown as RecurringPostRepository & { save: ReturnType<typeof vi.fn> };
}

// Channel ownership is checked via the decryption-free `findIdsByProjectId`.
// `owns=true` means the repointed channel belongs to the recurrence's own
// project; `owns=false` (foreign OR nonexistent) yields an empty set → reject.
const makeChannelRepo = (owns = true) =>
  ({
    findIdsByProjectId: vi
      .fn()
      .mockResolvedValue(owns ? [ChannelId.fromStringUnsafe(NEW_CHANNEL_ID)] : []),
  }) as unknown as ChannelRepository & { findIdsByProjectId: ReturnType<typeof vi.fn> };

describe("UpdateRecurringPostUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND when the recurring post does not exist", async () => {
    const repo = makeRepo({
      findById: vi.fn(async () => err(new EntityNotFoundError("RecurringPost", REC_POST_ID))),
    });
    const uc = new UpdateRecurringPostUseCase(repo, makeChannelRepo(), passthroughUow);
    const r = await uc.execute({ id: REC_POST_ID, name: "renamed" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("updates a simple field and round-trips the stored accountId onto the save", async () => {
    const repo = makeRepo();
    const uc = new UpdateRecurringPostUseCase(repo, makeChannelRepo(), passthroughUow);
    const r = await uc.execute({ id: REC_POST_ID, name: "renamed" });
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.save.mock.calls.length, 1);
    const saved = repo.save.mock.calls[0]?.[0] as RecurringPostData;
    assert.strictEqual(saved.accountId, ACCOUNT_ID, "accountId must round-trip unchanged");
  });

  it("rejects a channel-repoint to a FOREIGN or NON-EXISTENT channel with NOT_FOUND and persists nothing", async () => {
    const repo = makeRepo();
    const uc = new UpdateRecurringPostUseCase(repo, makeChannelRepo(false), passthroughUow);
    const r = await uc.execute({ id: REC_POST_ID, channels: [NEW_CHANNEL_ID] });
    assert.ok(!r.ok, "foreign/missing channel repoint must fail");
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
    assert.strictEqual(repo.save.mock.calls.length, 0, "no persistence on a rejected repoint");
  });

  it("accepts a channel-repoint when the new channel belongs to the recurrence's own project", async () => {
    const repo = makeRepo();
    const uc = new UpdateRecurringPostUseCase(repo, makeChannelRepo(true), passthroughUow);
    const r = await uc.execute({ id: REC_POST_ID, channels: [NEW_CHANNEL_ID] });
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(repo.save.mock.calls.length, 1);
  });
});
