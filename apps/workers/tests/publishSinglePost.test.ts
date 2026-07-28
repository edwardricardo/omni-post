/**
 * @file publishSinglePost.test.ts
 * @description Tests for PublishHandler.publishSinglePost
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { createTestDeps, createTestRenderedPost, createTestPublishReceipt } from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishProvider } from "../src/publishHandler.js";

describe("PublishHandler.publishSinglePost", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;
  /** Shortcut to the "x" mock provider in the registry. */
  let xProvider: PublishProvider;

  const POST_ID = "post-single-001";
  const CHANNEL_ID = "channel-x-001";
  const DEDUPE_KEY = `${POST_ID}:${CHANNEL_ID}`;
  const PROVIDER_NAME = "x";
  const ACCOUNT_ID = "account-test";

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  it("should publish successfully and log OK status", async () => {
    const rendered = createTestRenderedPost({ body: "Hello world" });
    const receipt = createTestPublishReceipt();

    xProvider.publish = async () => ({ ok: true, value: receipt });

    let loggedStatus: string | undefined;
    let loggedPayload: Record<string, unknown> | undefined;
    deps.repo.logPublish = async (input) => {
      loggedStatus = input.status;
      loggedPayload = input.payload;
      return { ok: true, value: {} };
    };

    const result = await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    assert.deepStrictEqual(result, receipt);
    assert.strictEqual(loggedStatus, "OK");
    assert.ok(loggedPayload);
    assert.ok("correlationId" in loggedPayload);
  });

  it("should increment publishOk metric on success", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    const value = await deps.workerMetrics.metrics.publishOk.get();
    const match = value.values.find(
      (v) =>
        v.labels.provider === "x" &&
        v.labels.content_type === "single" &&
        v.labels.channel_id === CHANNEL_ID
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should call businessKPITracker with success metrics", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    let trackedMetrics: Record<string, unknown> | undefined;
    deps.businessKPITracker.trackContentPublication = (m) => {
      trackedMetrics = m as unknown as Record<string, unknown>;
    };

    await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    assert.ok(trackedMetrics);
    assert.strictEqual(trackedMetrics.postId, POST_ID);
    assert.strictEqual(trackedMetrics.provider, "x");
    assert.strictEqual(trackedMetrics.success, true);
    assert.strictEqual(trackedMetrics.contentType, "single");
  });

  it("should throw and log ERR when provider returns error", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: false,
      error: "RATE_LIMIT" as const,
    });

    let loggedStatus: string | undefined;
    deps.repo.logPublish = async (input) => {
      loggedStatus = input.status;
      return { ok: true, value: {} };
    };

    await assert.rejects(
      () =>
        handler.publishSinglePost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          rendered,
          PROVIDER_NAME,
          xProvider,
          ACCOUNT_ID
        ),
      (err: Error) => {
        assert.ok(err.message.includes("RATE_LIMIT"));
        return true;
      }
    );

    assert.strictEqual(loggedStatus, "ERR");
  });

  it("should increment publishErr metric on provider error", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: false,
      error: "NETWORK" as const,
    });

    try {
      await handler.publishSinglePost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        rendered,
        PROVIDER_NAME,
        xProvider,
        ACCOUNT_ID
      );
    } catch {
      // expected
    }

    const value = await deps.workerMetrics.metrics.publishErr.get();
    const match = value.values.find(
      (v) =>
        v.labels.provider === "x" &&
        v.labels.content_type === "single" &&
        v.labels.error_type === "provider_error"
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should call recordError on provider error", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: false,
      error: "AUTH" as const,
    });

    try {
      await handler.publishSinglePost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        rendered,
        PROVIDER_NAME,
        xProvider,
        ACCOUNT_ID
      );
    } catch {
      // expected
    }

    const value = await deps.workerMetrics.metrics.errorsByType.get();
    const match = value.values.find(
      (v) => v.labels.component === "publisher" && v.labels.error_type === "provider_error"
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should call businessKPITracker with failure metrics on error", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: false,
      error: "NETWORK" as const,
    });

    let trackedMetrics: Record<string, unknown> | undefined;
    deps.businessKPITracker.trackContentPublication = (m) => {
      trackedMetrics = m as unknown as Record<string, unknown>;
    };

    try {
      await handler.publishSinglePost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        rendered,
        PROVIDER_NAME,
        xProvider,
        ACCOUNT_ID
      );
    } catch {
      // expected
    }

    assert.ok(trackedMetrics);
    assert.strictEqual(trackedMetrics.success, false);
    assert.strictEqual(trackedMetrics.error, "NETWORK");
  });

  it("should generate and track correlation ID", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    // During execution, correlationId should be tracked
    let capturedCorrelationId: string | undefined;
    const originalLogPublish = deps.repo.logPublish;
    deps.repo.logPublish = async (input) => {
      if (input.status === "OK") {
        capturedCorrelationId = input.payload.correlationId as string;
      }
      return originalLogPublish(input);
    };

    await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    assert.ok(capturedCorrelationId);
    assert.match(
      capturedCorrelationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("should remove correlation ID after completion (success)", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    // After completion, the correlation should be cleaned up
    const corr = deps.workerMetrics.getCorrelationId(DEDUPE_KEY);
    assert.strictEqual(corr, undefined);
  });

  it("should remove correlation ID after completion (error)", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({
      ok: false,
      error: "NETWORK" as const,
    });

    try {
      await handler.publishSinglePost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        rendered,
        PROVIDER_NAME,
        xProvider,
        ACCOUNT_ID
      );
    } catch {
      // expected
    }

    const corr = deps.workerMetrics.getCorrelationId(DEDUPE_KEY);
    assert.strictEqual(corr, undefined);
  });

  it("should pass correct data to provider.publish", async () => {
    const rendered = createTestRenderedPost({ body: "specific body" });

    let publishInput: Record<string, unknown> | undefined;
    xProvider.publish = async (input: { channelId: string; post: unknown; dedupeKey: string }) => {
      publishInput = input as unknown as Record<string, unknown>;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.publishSinglePost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      rendered,
      PROVIDER_NAME,
      xProvider,
      ACCOUNT_ID
    );

    assert.ok(publishInput);
    assert.strictEqual(publishInput.channelId, CHANNEL_ID);
    assert.strictEqual(publishInput.dedupeKey, DEDUPE_KEY);
    assert.deepStrictEqual(publishInput.post, rendered);
  });
});
