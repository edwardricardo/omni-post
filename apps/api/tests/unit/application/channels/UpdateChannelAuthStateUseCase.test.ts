/**
 * @file UpdateChannelAuthStateUseCase.test.ts
 * @description Unit tests for the admin force-reauth use case. Stubs the
 *              ChannelRepository to verify validation, not-found, success
 *              path, and persistence-failure handling.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import { UpdateChannelAuthStateUseCase } from "@core/channels/UpdateChannelAuthStateUseCase.js";
import { Channel } from "@core/domain/entities/Channel.js";
import { ChannelId, ProjectId } from "@core/domain/value-objects/EntityId.js";
import { Provider } from "@core/domain/value-objects/Provider.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

const VALID_CHANNEL_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeChannel(): Channel {
  const providerResult = Provider.fromString("X");
  if (!providerResult.ok) throw providerResult.error;
  return Channel.reconstitute(ChannelId.fromStringUnsafe(VALID_CHANNEL_ID), {
    projectId: ProjectId.fromStringUnsafe(VALID_PROJECT_ID),
    provider: providerResult.value,
    handle: "@test",
    credentials: { accessToken: "tok" },
    isPrimary: false,
    status: "CONNECTED",
    errorCount: 0,
    needsReauth: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("UpdateChannelAuthStateUseCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty reason with VALIDATION_FAILED", async () => {
    const repo = {
      findById: vi.fn(),
      save: vi.fn(),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const useCase = new UpdateChannelAuthStateUseCase(repo);
    const result = await useCase.execute({ channelId: VALID_CHANNEL_ID, reason: "   " });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
    assert.equal(repo.findById.mock.calls.length, 0);
  });

  it("rejects invalid channel id with VALIDATION_FAILED", async () => {
    const repo = {
      findById: vi.fn(),
      save: vi.fn(),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const useCase = new UpdateChannelAuthStateUseCase(repo);
    const result = await useCase.execute({ channelId: "not-a-uuid", reason: "x" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "VALIDATION_FAILED");
  });

  it("returns NOT_FOUND when channel does not exist", async () => {
    const repo = {
      findById: vi
        .fn()
        .mockResolvedValue(err(new EntityNotFoundError("Channel", VALID_CHANNEL_ID))),
      save: vi.fn(),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const useCase = new UpdateChannelAuthStateUseCase(repo);
    const result = await useCase.execute({ channelId: VALID_CHANNEL_ID, reason: "x" });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "NOT_FOUND");
    assert.equal(repo.save.mock.calls.length, 0);
  });

  it("flips needsReauth + persists + returns DTO on success", async () => {
    const channel = makeChannel();
    const saveResults: Result<void, Error>[] = [];
    const repo = {
      findById: vi.fn().mockResolvedValue(ok(channel)),
      save: vi.fn().mockImplementation(async () => {
        const r = ok(undefined);
        saveResults.push(r);
        return r;
      }),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const useCase = new UpdateChannelAuthStateUseCase(repo);
    const result = await useCase.execute({
      channelId: VALID_CHANNEL_ID,
      reason: "admin force-reauth",
    });
    assert.ok(result.ok, result.ok ? "" : result.error.message);
    assert.equal(result.value.channelId, VALID_CHANNEL_ID);
    assert.equal(result.value.needsReauth, true);
    assert.equal(typeof result.value.authFailedAt, "string");
    assert.equal(channel.needsReauth, true);
    assert.equal(channel.authFailureReason, "admin force-reauth");
    assert.equal(saveResults.length, 1);
  });

  it("returns INTERNAL_ERROR when save fails", async () => {
    const channel = makeChannel();
    const repo = {
      findById: vi.fn().mockResolvedValue(ok(channel)),
      save: vi.fn().mockResolvedValue(err(new Error("DB exploded"))),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const useCase = new UpdateChannelAuthStateUseCase(repo);
    const result = await useCase.execute({
      channelId: VALID_CHANNEL_ID,
      reason: "x",
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, "INTERNAL_ERROR");
  });

  it("runs inside UnitOfWork.executeInTransaction when UoW is provided", async () => {
    const channel = makeChannel();
    const repo = {
      findById: vi.fn().mockResolvedValue(ok(channel)),
      save: vi.fn().mockResolvedValue(ok(undefined)),
      findByProjectId: vi.fn(),
      findByProjectAndProvider: vi.fn(),
      findPrimaryByProjectAndProvider: vi.fn(),
      delete: vi.fn(),
      hardDelete: vi.fn(),
    };
    const uowExecute = vi.fn(async (cb: () => Promise<void>) => {
      await cb();
    });
    const useCase = new UpdateChannelAuthStateUseCase(repo, {
      executeInTransaction: uowExecute,
    });
    const result = await useCase.execute({
      channelId: VALID_CHANNEL_ID,
      reason: "x",
    });
    assert.ok(result.ok);
    assert.equal(uowExecute.mock.calls.length, 1);
  });
});
