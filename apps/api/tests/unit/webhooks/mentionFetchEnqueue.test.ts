/**
 * @file mentionFetchEnqueue.test.ts
 * @description Contract tests for the mention-fetch enqueue callback used by the
 *   webhook layer. Pins the MentionFetchJob shape (the payload the mention-ingest
 *   worker's "fetch" branch consumes) and that MentionFetchEnqueue is an awaitable
 *   callback, so a drift in either breaks here.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import type {
  MentionFetchJob,
  MentionFetchEnqueue,
} from "../../../src/webhooks/mentionFetchEnqueue.js";

const SAMPLE_JOB: MentionFetchJob = {
  kind: "fetch",
  channelId: "ch-1",
  accountId: "acc-1",
  projectId: "proj-1",
  provider: "instagram",
  providerMentionId: "media-123",
};

describe("MentionFetchJob contract", () => {
  it("carries the fields the worker's fetch branch needs", () => {
    assert.deepStrictEqual(Object.keys(SAMPLE_JOB).sort(), [
      "accountId",
      "channelId",
      "kind",
      "projectId",
      "provider",
      "providerMentionId",
    ]);
    assert.strictEqual(SAMPLE_JOB.kind, "fetch");
  });

  it("is enqueued via an awaitable MentionFetchEnqueue callback", async () => {
    const received: MentionFetchJob[] = [];
    const enqueue: MentionFetchEnqueue = vi.fn(async (job) => {
      received.push(job);
    });

    await enqueue(SAMPLE_JOB);

    expect(enqueue).toHaveBeenCalledOnce();
    assert.deepStrictEqual(received[0], SAMPLE_JOB);
  });
});
