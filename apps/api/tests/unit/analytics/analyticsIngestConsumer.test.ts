/**
 * @file analyticsIngestConsumer.test.ts
 * @description Unit tests for the in-process analytics-ingest consumer handler:
 *   delegates to IngestChannelAnalyticsUseCase, flags reauth on AUTH, distinguishes
 *   terminal (no-retry) from retryable failures.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err } from "@shared/types";
import { processAnalyticsIngestJob } from "../../../src/analytics/analyticsIngestConsumer.js";
import {
  IngestChannelAnalyticsError,
  INGEST_ERRORS,
  type IngestChannelAnalyticsUseCase,
} from "@core/application/analytics/IngestChannelAnalyticsUseCase.js";
import type { UpdateChannelAuthStateUseCase } from "@core/application/channels/UpdateChannelAuthStateUseCase.js";

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const makeIngest = (result: unknown): IngestChannelAnalyticsUseCase =>
  ({ execute: vi.fn(async () => result) }) as unknown as IngestChannelAnalyticsUseCase;

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

const payload = { channelId: "ch-1", accountId: "acc-1", since: "2024-01-01T00:00:00Z" };

describe("processAnalyticsIngestJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the ingest use case with the mapped payload and resolves on success", async () => {
    const ingest = makeIngest(ok({ ingested: 5, channelId: "ch-1" }));
    const markReauth = makeReauth();

    await processAnalyticsIngestJob({ ingest, markReauth, logger: makeLogger() }, payload);

    expect(ingest.execute).toHaveBeenCalledWith({
      channelId: "ch-1",
      accountId: "acc-1",
      since: new Date("2024-01-01T00:00:00Z"),
    });
    expect(markReauth.execute).not.toHaveBeenCalled();
  });

  it("flags the channel for reauth and throws on an AUTH error", async () => {
    const ingest = makeIngest(
      err(new IngestChannelAnalyticsError("auth", INGEST_ERRORS.AUTH_ERROR))
    );
    const markReauth = makeReauth();

    await expect(
      processAnalyticsIngestJob({ ingest, markReauth, logger: makeLogger() }, payload)
    ).rejects.toThrow(/ch-1/);

    expect(markReauth.execute).toHaveBeenCalledWith({
      channelId: "ch-1",
      reason: expect.stringContaining("analytics"),
    });
  });

  it("does NOT throw or flag reauth on a terminal error (channel gone)", async () => {
    const ingest = makeIngest(
      err(new IngestChannelAnalyticsError("gone", INGEST_ERRORS.CHANNEL_NOT_FOUND))
    );
    const markReauth = makeReauth();

    await expect(
      processAnalyticsIngestJob({ ingest, markReauth, logger: makeLogger() }, payload)
    ).resolves.toBeUndefined();

    expect(markReauth.execute).not.toHaveBeenCalled();
  });

  it("throws (for BullMQ retry) on a retryable provider error without flagging reauth", async () => {
    const ingest = makeIngest(
      err(new IngestChannelAnalyticsError("boom", INGEST_ERRORS.PROVIDER_ERROR))
    );
    const markReauth = makeReauth();

    await expect(
      processAnalyticsIngestJob({ ingest, markReauth, logger: makeLogger() }, payload)
    ).rejects.toThrow(/ch-1/);

    expect(markReauth.execute).not.toHaveBeenCalled();
  });

  it("omits since when the payload has none", async () => {
    const ingest = makeIngest(ok({ ingested: 0, channelId: "ch-1" }));

    await processAnalyticsIngestJob(
      { ingest, markReauth: makeReauth(), logger: makeLogger() },
      { channelId: "ch-1", accountId: "acc-1" }
    );

    expect(ingest.execute).toHaveBeenCalledWith({ channelId: "ch-1", accountId: "acc-1" });
  });
});
