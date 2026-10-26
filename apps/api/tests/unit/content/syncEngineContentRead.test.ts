/**
 * @file syncEngineContentRead.test.ts
 * @description Pins how SyncEngine.syncPost reads the post it syncs: a stored content locale
 *              outside CONTENT_LOCALES and a failed database read each fail the sync with their
 *              own message, never as the "Source content not found" a missing post gets, and a
 *              post in es syncs. Tier 0: doubles for Prisma, Redis and the event service.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import type { Redis } from "ioredis";
import type { SyncConfiguration } from "@shared/types/orchestration.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { SyncEngine } from "../../../src/content/SyncEngine.js";
import type { EventService } from "../../../src/events/EventService.js";
import type { ContentSynchronizer } from "../../../src/orchestration/ContentSynchronizer.js";
import type { ContentVersionManager } from "../../../src/content/ContentVersionManager.js";

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const CONTENT_ID = "d0000000-0000-4000-8000-000000000001";

const CONFIGURATION: SyncConfiguration = {
  mode: "ON_DEMAND",
  sources: ["x"],
  targets: ["facebook"],
  syncRules: [],
  conflictResolution: { strategy: "source_wins" },
};

/**
 * @description A post row with one content row in the given locale.
 * @param locale - The locale of the content row.
 * @returns The row findFirst answers.
 */
function postRow(locale: string) {
  return {
    id: POST_ID,
    projectId: "b0000000-0000-4000-8000-000000000001",
    contents: [{ id: CONTENT_ID, locale, body: "Hola" }],
  };
}

/**
 * @description A sync engine whose post read runs `findFirst`, with one enabled channel.
 * @param findFirst - The double of prisma.post.findFirst.
 * @returns The engine and the id of its channel.
 */
async function engineReading(findFirst: () => Promise<unknown>) {
  const engine = new SyncEngine({
    prisma: { post: { findFirst: vi.fn(findFirst) } } as unknown as PrismaClient,
    redis: { setex: vi.fn(async () => "OK") } as unknown as Redis,
    eventService: { publishEvent: vi.fn(async () => undefined) } as unknown as EventService,
    synchronizer: {} as ContentSynchronizer,
    versionManager: {} as ContentVersionManager,
    scheduler: new NoopBackgroundTaskScheduler(),
  });
  const channel = await engine.createSyncChannel("x-to-facebook", "x", "facebook", CONFIGURATION);
  if (!channel.ok) throw new Error(`test setup: ${channel.error.message}`);
  return { engine, channelId: channel.value.id };
}

describe("SyncEngine.syncPost — reading the post", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs a post whose content is in es", async () => {
    const { engine, channelId } = await engineReading(async () => postRow("es"));

    const result = await engine.syncPost(POST_ID, channelId);

    assert.ok(result.ok);
    expect(result.value.status).toBe("completed");
  });

  it("fails the sync naming the content row when its stored locale is fr", async () => {
    const { engine, channelId } = await engineReading(async () => postRow("fr"));

    const result = await engine.syncPost(POST_ID, channelId);

    assert.ok(!result.ok);
    expect(result.error.message).toBe(
      `Post sync failed: PostContent ${CONTENT_ID} holds locale "fr", which is not a content locale (en, es)`
    );
  });

  it("fails the sync with the database error when the post read fails", async () => {
    const { engine, channelId } = await engineReading(async () => {
      throw new Error("connection terminated");
    });

    const result = await engine.syncPost(POST_ID, channelId);

    assert.ok(!result.ok);
    expect(result.error.message).toBe("Post sync failed: connection terminated");
  });
});
