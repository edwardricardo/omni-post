/**
 * @file inboxSyncConsumer.test.ts
 * @description Unit tests for the in-process inbox-sync consumer handler:
 *   delegates to SyncProviderCommentsUseCase, flags reauth on FORBIDDEN (AUTH),
 *   distinguishes terminal (no-retry) from retryable failures.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { processInboxSyncJob } from "../../../src/inbox/inboxSyncConsumer.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { SyncProviderCommentsUseCase } from "@core/application/inbox/SyncProviderCommentsUseCase.js";
import type { UpdateChannelAuthStateUseCase } from "@core/application/channels/UpdateChannelAuthStateUseCase.js";

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const makeSync = (result: unknown): SyncProviderCommentsUseCase =>
  ({ execute: vi.fn(async () => result) }) as unknown as SyncProviderCommentsUseCase;

const makeReauth = (): UpdateChannelAuthStateUseCase =>
  ({
    execute: vi.fn(async () =>
      ok({
        channelId: "ch-1",
        projectId: "proj-1",
        provider: "X",
        needsReauth: true as const,
        authFailedAt: new Date().toISOString(),
      })
    ),
  }) as unknown as UpdateChannelAuthStateUseCase;

const payload = {
  channelId: "ch-1",
  accountId: "acc-1",
  projectId: "proj-1",
  since: "2024-01-01T00:00:00Z",
};

describe("processInboxSyncJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the sync use case with the mapped payload and resolves on success", async () => {
    const sync = makeSync(ok({ synced: 3, skipped: 1 }));
    const markReauth = makeReauth();

    await processInboxSyncJob({ sync, markReauth, logger: makeLogger() }, payload);

    expect(sync.execute).toHaveBeenCalledWith({
      channelId: "ch-1",
      accountId: "acc-1",
      projectId: "proj-1",
      since: new Date("2024-01-01T00:00:00Z"),
    });
    expect(markReauth.execute).not.toHaveBeenCalled();
  });

  it("flags the channel for reauth and throws on FORBIDDEN (AUTH)", async () => {
    const sync = makeSync(err(new UseCaseError("auth", USE_CASE_ERRORS.FORBIDDEN)));
    const markReauth = makeReauth();

    await expect(
      processInboxSyncJob({ sync, markReauth, logger: makeLogger() }, payload)
    ).rejects.toThrow(/ch-1/);

    expect(markReauth.execute).toHaveBeenCalledWith({
      channelId: "ch-1",
      reason: expect.stringContaining("inbox"),
    });
  });

  it("does NOT throw or flag reauth on a terminal error (channel not found)", async () => {
    const sync = makeSync(err(new UseCaseError("gone", USE_CASE_ERRORS.NOT_FOUND)));
    const markReauth = makeReauth();

    await expect(
      processInboxSyncJob({ sync, markReauth, logger: makeLogger() }, payload)
    ).resolves.toBeUndefined();

    expect(markReauth.execute).not.toHaveBeenCalled();
  });

  it("throws (for BullMQ retry) on a retryable internal error without flagging reauth", async () => {
    const sync = makeSync(err(new UseCaseError("boom", USE_CASE_ERRORS.INTERNAL_ERROR)));
    const markReauth = makeReauth();

    await expect(
      processInboxSyncJob({ sync, markReauth, logger: makeLogger() }, payload)
    ).rejects.toThrow(/ch-1/);

    expect(markReauth.execute).not.toHaveBeenCalled();
  });
});
