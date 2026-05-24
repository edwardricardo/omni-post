/**
 * @file instagramWebhookMention.test.ts
 * @description Unit tests for the Instagram webhook processor's mention path:
 *   a mention notification enqueues a fetch-before-process job (it does not
 *   persist the mention inline).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { InstagramWebhookProcessor } from "../../src/webhooks/processors/instagramWebhookProcessor.js";
import { makeWebhookPrismaFake } from "./helpers/webhookPrismaFake.js";
import type { MentionFetchJob } from "../../src/webhooks/mentionFetchEnqueue.js";

describe("InstagramWebhookProcessor - mention enqueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a fetch job when a mention is received with full context", async () => {
    const enqueued: MentionFetchJob[] = [];
    const processor = new InstagramWebhookProcessor(
      makeWebhookPrismaFake().prisma,
      undefined,
      async (job) => {
        enqueued.push(job);
      }
    );

    await processor.process(
      { eventType: "mention_received", mediaId: "media-123", username: "fan", userId: "u-1" },
      { accountId: "acc-1", projectId: "proj-1", channelId: "ch-1" }
    );

    assert.strictEqual(enqueued.length, 1);
    assert.deepStrictEqual(enqueued[0], {
      kind: "fetch",
      channelId: "ch-1",
      accountId: "acc-1",
      projectId: "proj-1",
      provider: "instagram",
      providerMentionId: "media-123",
    });
  });

  it("falls back to commentId when no mediaId is present", async () => {
    const enqueued: MentionFetchJob[] = [];
    const processor = new InstagramWebhookProcessor(
      makeWebhookPrismaFake().prisma,
      undefined,
      async (job) => {
        enqueued.push(job);
      }
    );

    await processor.process(
      { eventType: "mention_received", commentId: "comment-9", username: "fan", userId: "u-1" },
      { accountId: "acc-1", projectId: "proj-1", channelId: "ch-1" }
    );

    assert.strictEqual(enqueued[0]?.providerMentionId, "comment-9");
  });

  it("does not enqueue when channel context is missing", async () => {
    const enqueued: MentionFetchJob[] = [];
    const processor = new InstagramWebhookProcessor(
      makeWebhookPrismaFake().prisma,
      undefined,
      async (job) => {
        enqueued.push(job);
      }
    );

    await processor.process(
      { eventType: "mention_received", mediaId: "media-123" },
      { accountId: "acc-1", projectId: "proj-1" }
    );

    assert.strictEqual(enqueued.length, 0);
  });
});
