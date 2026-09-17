/**
 * @file postEvents.publication.test.ts
 * @description Unit tests for the publication-facing post events — the internal
 *   channel-keyed producers and the two alert events, plus the two EXTERNAL contracts
 *   that must keep their v1 key set byte for byte while their values are now built
 *   from the per-channel record.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  PostChannelPublished,
  PostChannelExcluded,
  PostChannelRetractionAlertRaised,
  PostChannelRetractionAlertResolved,
  PostPublished,
  PostPublishingFailed,
} from "@core/domain/events/PostEvents.js";
import { CHANNEL_FAILURE_CODES } from "@core/domain/value-objects/ExclusionReason.js";
import { CHANNEL_RETRACTION_BLOCKS } from "@core/domain/value-objects/PublicationOutcome.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const POST_ID = "c0000000-0000-4000-8000-000000000001";
const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const CHANNEL_A = "aa000000-0000-4000-8000-000000000001";
const PUBLISHED_AT = new Date("2026-03-01T09:00:00.000Z");
const CONTENT_HASH = "f".repeat(64);
const ALERT_KEY = `${POST_ID}:${CHANNEL_A}:${"a".repeat(64)}`;

describe("channel-keyed publication events", () => {
  it("returns the published payload naming the post, the tenant, the channel and the fragment count", () => {
    const event = new PostChannelPublished({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      externalId: "tweet-1",
      fragmentCount: 3,
      publishedAt: PUBLISHED_AT,
      contentHash: CONTENT_HASH,
    });

    assert.strictEqual(event.eventType, "PostChannelPublished");
    assert.strictEqual(event.aggregateType, "Post");
    assert.strictEqual(event.aggregateId, POST_ID);
    assert.deepStrictEqual(event.toPayload(), {
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      externalId: "tweet-1",
      fragmentCount: 3,
      publishedAt: PUBLISHED_AT.toISOString(),
      contentHash: CONTENT_HASH,
    });
  });

  it("returns a published payload without an external id when the provider returned none", () => {
    const event = new PostChannelPublished({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      fragmentCount: 1,
      publishedAt: PUBLISHED_AT,
      contentHash: CONTENT_HASH,
    });

    assert.ok(!Object.keys(event.toPayload()).includes("externalId"));
  });

  it("returns the excluded payload naming the reason, the attempts and the live-fragment count", () => {
    const event = new PostChannelExcluded({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      reasonCode: CHANNEL_FAILURE_CODES.THREAD_INTERRUPTED,
      attempts: 2,
      pendingRetraction: true,
      liveFragmentCount: 2,
    });

    assert.strictEqual(event.eventType, "PostChannelExcluded");
    assert.deepStrictEqual(event.toPayload(), {
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      reasonCode: "THREAD_INTERRUPTED",
      attempts: 2,
      pendingRetraction: true,
      liveFragmentCount: 2,
    });
  });

  it("returns the raised alert naming every live fragment and the cause", () => {
    const event = new PostChannelRetractionAlertRaised({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      liveFragments: [
        { index: 1, externalId: "tweet-1", url: "https://x.com/1" },
        { index: 2, externalId: "tweet-2" },
      ],
      cause: CHANNEL_RETRACTION_BLOCKS.NO_CAPABILITY,
      alertKey: ALERT_KEY,
    });

    assert.strictEqual(event.eventType, "PostChannelRetractionAlertRaised");
    assert.deepStrictEqual(event.toPayload(), {
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      liveFragments: [
        { index: 1, externalId: "tweet-1", url: "https://x.com/1" },
        { index: 2, externalId: "tweet-2" },
      ],
      cause: "NO_CAPABILITY",
      alertKey: ALERT_KEY,
    });
  });

  it("returns the raised alert naming the key it supersedes when the live set changed", () => {
    const event = new PostChannelRetractionAlertRaised({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      liveFragments: [{ index: 2, externalId: "tweet-2" }],
      cause: CHANNEL_RETRACTION_BLOCKS.EXHAUSTED,
      alertKey: ALERT_KEY,
      supersededAlertKey: `${POST_ID}:${CHANNEL_A}:${"b".repeat(64)}`,
    });

    assert.strictEqual(
      (event.toPayload() as { supersededAlertKey?: string }).supersededAlertKey,
      `${POST_ID}:${CHANNEL_A}:${"b".repeat(64)}`
    );
  });

  it("returns the resolved alert naming the key and the cause that ended it", () => {
    const event = new PostChannelRetractionAlertResolved({
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      alertKey: ALERT_KEY,
      cause: CHANNEL_FAILURE_CODES.ACTION_WINDOW_EXPIRED,
    });

    assert.strictEqual(event.eventType, "PostChannelRetractionAlertResolved");
    assert.deepStrictEqual(event.toPayload(), {
      postId: POST_ID,
      projectId: PROJECT_ID,
      accountId: ACCOUNT_ID,
      channelId: CHANNEL_A,
      alertKey: ALERT_KEY,
      cause: "ACTION_WINDOW_EXPIRED",
    });
  });
});

describe("the external contracts stay at v1", () => {
  it("returns exactly the v1 key set for a published post, keyed by channel", () => {
    const event = new PostPublished(POST_ID, PUBLISHED_AT, {
      [CHANNEL_A]: { success: true, externalId: "tweet-1" },
    });

    const payload = event.toPayload();

    assert.deepStrictEqual(Object.keys(payload).sort(), [
      "postId",
      "providerResults",
      "publishedAt",
    ]);
    assert.deepStrictEqual(payload, {
      postId: POST_ID,
      publishedAt: PUBLISHED_AT.toISOString(),
      providerResults: { [CHANNEL_A]: { success: true, externalId: "tweet-1" } },
    });
  });

  it("returns exactly the v1 key set for a failed post", () => {
    const event = new PostPublishingFailed(POST_ID, "THREAD_INTERRUPTED", ["X"], true);

    const payload = event.toPayload();

    assert.deepStrictEqual(Object.keys(payload).sort(), [
      "error",
      "failedProviders",
      "postId",
      "retryable",
    ]);
    assert.deepStrictEqual(payload, {
      postId: POST_ID,
      error: "THREAD_INTERRUPTED",
      failedProviders: ["X"],
      retryable: true,
    });
  });
});
