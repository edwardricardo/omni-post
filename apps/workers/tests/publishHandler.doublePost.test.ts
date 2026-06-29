/**
 * @file publishHandler.doublePost.test.ts
 * @description WRK-DOUBLE-POST regression suite. Exercises the "claim + confirm
 *              receipt" pattern that narrows the double-post window: a publish
 *              job that crashes AFTER the provider accepts the post but BEFORE the
 *              OK log commits must NOT re-publish on BullMQ retry. The RUNNING row
 *              carries the durable `providerPostId` receipt (a real DB column, not
 *              a payload field) written immediately after provider success, so the
 *              retry confirms the existing receipt instead of calling the provider
 *              again.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createTestDeps,
  createTestPost,
  createTestRenderedPost,
  createTestPublishReceipt,
} from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishProvider } from "../src/publishHandler.js";

describe("PublishHandler.handleJob — WRK-DOUBLE-POST receipt guard", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;
  let xProvider: PublishProvider;

  const POST_ID = "post-double-001";
  const CHANNEL_ID = "channel-x-double-001";
  const DEDUPE_KEY = `${POST_ID}:${CHANNEL_ID}`;
  const PROVIDER_POST_ID = "x-post-receipt-999";

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  it("does not re-publish on retry when a non-ERR row already carries a provider receipt", async () => {
    // Real produced state: the provider already accepted the post on a prior
    // attempt, so the publish_log row is RUNNING (the crash happened before the
    // OK log committed) AND carries the durable providerPostId receipt written
    // immediately after the provider returned success.
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "RUNNING", providerPostId: PROVIDER_POST_ID },
    });

    let publishCalled = 0;
    xProvider.publish = async () => {
      publishCalled += 1;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      dedupeKey: DEDUPE_KEY,
    });

    // The provider MUST NOT be called again — the existing receipt is confirmed.
    assert.strictEqual(publishCalled, 0, "provider.publish must be invoked 0x on retry");

    // The job resolves as already-published (counted as skipped, not a fresh publish).
    const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
    assert.strictEqual(skipped.values[0]?.value, 1, "retry confirms receipt -> job skipped");
  });

  it("still re-publishes when the row is ERR even if no receipt is present", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "ERR", providerPostId: null },
    });

    const post = createTestPost({ id: POST_ID });
    deps.repo.getPostById = async () => ({ ok: true, value: post });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });

    let publishCalled = 0;
    xProvider.publish = async () => {
      publishCalled += 1;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      dedupeKey: DEDUPE_KEY,
    });

    assert.strictEqual(publishCalled, 1, "ERR row must re-publish exactly once");
  });

  it("records the receipt immediately after provider success, before the OK log", async () => {
    // No prior receipt — this is the first successful attempt (the producing path).
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "RUNNING", providerPostId: null },
    });

    const post = createTestPost({ id: POST_ID });
    deps.repo.getPostById = async () => ({ ok: true, value: post });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });

    const callOrder: string[] = [];

    xProvider.publish = async () => {
      callOrder.push("provider.publish");
      return { ok: true, value: createTestPublishReceipt({ providerPostId: PROVIDER_POST_ID }) };
    };

    let recordedReceipt: { dedupeKey: string; providerPostId: string } | null = null;
    deps.repo.recordReceipt = async (dedupeKey: string, providerPostId: string) => {
      callOrder.push("recordReceipt");
      recordedReceipt = { dedupeKey, providerPostId };
      return { ok: true, value: undefined };
    };

    const originalLogPublish = deps.repo.logPublish;
    deps.repo.logPublish = async (input) => {
      if (input.status === "OK") {
        callOrder.push("logPublish:OK");
      }
      return originalLogPublish(input);
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      dedupeKey: DEDUPE_KEY,
    });

    assert.deepStrictEqual(
      recordedReceipt,
      { dedupeKey: DEDUPE_KEY, providerPostId: PROVIDER_POST_ID },
      "recordReceipt must persist the provider post id under the dedupe key"
    );

    const receiptIdx = callOrder.indexOf("recordReceipt");
    const okLogIdx = callOrder.indexOf("logPublish:OK");
    assert.ok(receiptIdx >= 0, "recordReceipt must be called");
    assert.ok(okLogIdx >= 0, "OK log must be written");
    assert.ok(
      receiptIdx < okLogIdx,
      "recordReceipt must run BEFORE the OK log so a crash-then-retry finds the receipt"
    );
  });
});
