/**
 * @file SetPrimaryChannelUseCase.test.ts
 * @description Unit tests for SetPrimaryChannelUseCase — happy path, already-primary
 *   no-op, channel not-found, and invalid channel-id validation against a mocked
 *   ChannelRepository.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { SetPrimaryChannelUseCase } from "../../src/SetPrimaryChannelUseCase.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const CHANNEL_ID = "550e8400-e29b-41d4-a716-446655440001";
const PREV_PRIMARY_ID = "550e8400-e29b-41d4-a716-446655440002";
const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440003";

const passthroughUow: UnitOfWork = {
  executeInTransaction: async (fn) => fn(),
};

function makeChannel(
  id: string,
  isPrimary: boolean,
  projectId = PROJECT_ID
): Record<string, unknown> {
  return {
    id: { value: id },
    projectId: { value: projectId },
    provider: { type: "INSTAGRAM" },
    isPrimary,
    markAsPrimary: vi.fn(),
    unmarkAsPrimary: vi.fn(),
  };
}

function makeMockRepo(opts: {
  targetFound?: boolean;
  targetIsPrimary?: boolean;
  prevPrimaryExists?: boolean;
  saveFails?: boolean;
}): ChannelRepository {
  const {
    targetFound = true,
    targetIsPrimary = false,
    prevPrimaryExists = true,
    saveFails = false,
  } = opts;

  const target = makeChannel(CHANNEL_ID, targetIsPrimary);
  const prevPrimary = makeChannel(PREV_PRIMARY_ID, true);

  return {
    findById: vi.fn(async () =>
      targetFound ? ok(target) : err(new EntityNotFoundError("Channel", CHANNEL_ID))
    ),
    findPrimaryByProjectAndProvider: vi.fn(async () =>
      prevPrimaryExists ? ok(prevPrimary) : err(new EntityNotFoundError("Channel", "none"))
    ),
    save: vi.fn(async () => (saveFails ? err(new Error("DB error")) : ok(undefined))),
  } as unknown as ChannelRepository;
}

describe("SetPrimaryChannelUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the promoted channel when it is not yet primary", async () => {
    const repo = makeMockRepo({ targetFound: true, targetIsPrimary: false });
    const uc = new SetPrimaryChannelUseCase(repo, passthroughUow);
    const r = await uc.execute({ channelId: CHANNEL_ID });
    assert.ok(r.ok, `expected ok: ${r.ok ? "" : r.error.message}`);
    assert.strictEqual(r.value.id, CHANNEL_ID);
    assert.strictEqual(r.value.previousPrimaryId, PREV_PRIMARY_ID);
  });

  it("returns ok immediately when the channel is already primary (no-op)", async () => {
    const repo = makeMockRepo({ targetFound: true, targetIsPrimary: true });
    const uc = new SetPrimaryChannelUseCase(repo, passthroughUow);
    const r = await uc.execute({ channelId: CHANNEL_ID });
    assert.ok(r.ok);
    assert.strictEqual(r.value.id, CHANNEL_ID);
    assert.strictEqual(r.value.previousPrimaryId, undefined);
  });

  it("returns NOT_FOUND when the channel does not exist", async () => {
    const repo = makeMockRepo({ targetFound: false });
    const uc = new SetPrimaryChannelUseCase(repo, passthroughUow);
    const r = await uc.execute({ channelId: CHANNEL_ID });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.NOT_FOUND);
  });

  it("returns VALIDATION_FAILED when the channel id is not a valid UUID", async () => {
    const repo = makeMockRepo({});
    const uc = new SetPrimaryChannelUseCase(repo, passthroughUow);
    const r = await uc.execute({ channelId: "not-a-uuid" });
    assert.ok(!r.ok);
    assert.strictEqual(r.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
  });
});
