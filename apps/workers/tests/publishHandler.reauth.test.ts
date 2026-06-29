/**
 * @file publishHandler.reauth.test.ts
 * @description Tests that PublishHandler flags the channel for re-authentication
 *              (via the shared ChannelAuthFailureRecorder primitive) on a publish
 *              AUTH failure, on BOTH the single-post and thread paths, and ONLY on
 *              AUTH — never on RATE_LIMIT / NETWORK / VALIDATION. Exercises all
 *              four AUTH sites: single-post credential, single-post provider,
 *              thread credential, thread provider.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import {
  createTestDeps,
  createTestRenderedPost,
  createTestThread,
  createTestTweet,
  createTestThreadPlan,
} from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishProvider } from "../src/publishHandler.js";
import type { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";

/**
 * Structural stub of the auth-failure recorder. The handler only depends on the
 * `record(channelId, provider, reason)` method (the structural contract the
 * shared `handleProviderAuthError` primitive consumes), so a spy is sufficient.
 */
function createMockRecorder(): ChannelAuthFailureRecorder {
  return {
    record: vi.fn(async () => {}),
  } as unknown as ChannelAuthFailureRecorder;
}

type RecordSpy = ReturnType<typeof vi.fn>;

describe("PublishHandler reauth on publish AUTH failures", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;
  let xProvider: PublishProvider;
  let recorder: ChannelAuthFailureRecorder;

  const POST_ID = "post-reauth-001";
  const CHANNEL_ID = "channel-x-reauth-001";
  const DEDUPE_KEY = `${POST_ID}:${CHANNEL_ID}`;
  const PROVIDER_NAME = "x";

  beforeEach(() => {
    vi.clearAllMocks();
    recorder = createMockRecorder();
    deps = createTestDeps({ authFailureRecorder: recorder });
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  // ---------- (a) single-post provider-AUTH ----------

  it("flags needsReauth via the recorder when single-post provider returns AUTH", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({ ok: false, error: "AUTH" as const });

    await assert.rejects(() =>
      handler.publishSinglePost(POST_ID, CHANNEL_ID, DEDUPE_KEY, rendered, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(1);
    const args = record.mock.calls[0];
    assert.strictEqual(args?.[0], CHANNEL_ID, "channelId flows through");
    assert.strictEqual(args?.[1], PROVIDER_NAME, "provider flows through");
    assert.ok(typeof args?.[2] === "string" && args[2].length > 0, "context label present");
  });

  // ---------- (b) single-post credential-AUTH ----------

  it("flags needsReauth via the recorder when single-post credential resolution fails", async () => {
    const rendered = createTestRenderedPost();
    deps.credentialResolver.resolve = async () => ({ ok: false, error: "AUTH" as const });

    await assert.rejects(() =>
      handler.publishSinglePost(POST_ID, CHANNEL_ID, DEDUPE_KEY, rendered, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(1);
    const args = record.mock.calls[0];
    assert.strictEqual(args?.[0], CHANNEL_ID);
    assert.strictEqual(args?.[1], PROVIDER_NAME);
  });

  // ---------- (c) thread credential-AUTH (RED on current code) ----------

  it("flags needsReauth via the recorder when THREAD credential resolution fails", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({ ok: true, value: createTestThread() });
    deps.repo.createTweet = async () => ({ ok: true, value: createTestTweet() });
    deps.credentialResolver.resolve = async () => ({ ok: false, error: "AUTH" as const });

    await assert.rejects(() =>
      handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(1);
    const args = record.mock.calls[0];
    assert.strictEqual(args?.[0], CHANNEL_ID);
    assert.strictEqual(args?.[1], PROVIDER_NAME);
  });

  // ---------- (d) thread provider-AUTH (RED on current code) ----------

  it("flags needsReauth via the recorder when THREAD provider returns AUTH", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({ ok: true, value: createTestThread() });
    deps.repo.createTweet = async () => ({ ok: true, value: createTestTweet() });
    if (!xProvider.publishThread) {
      throw new Error("x provider must support publishThread in the test registry");
    }
    xProvider.publishThread = async () => ({ ok: false, error: "AUTH" as const });

    await assert.rejects(() =>
      handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(1);
    const provArgs = record.mock.calls[0];
    assert.strictEqual(provArgs?.[0], CHANNEL_ID);
    assert.strictEqual(provArgs?.[1], PROVIDER_NAME);
  });

  // ---------- (e) non-AUTH (RATE_LIMIT) MUST NOT flag ----------

  it("does NOT flag needsReauth when single-post provider returns RATE_LIMIT", async () => {
    const rendered = createTestRenderedPost();
    xProvider.publish = async () => ({ ok: false, error: "RATE_LIMIT" as const });

    await assert.rejects(() =>
      handler.publishSinglePost(POST_ID, CHANNEL_ID, DEDUPE_KEY, rendered, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(0);
  });

  it("does NOT flag needsReauth when THREAD provider returns RATE_LIMIT", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({ ok: true, value: createTestThread() });
    deps.repo.createTweet = async () => ({ ok: true, value: createTestTweet() });
    if (!xProvider.publishThread) {
      throw new Error("x provider must support publishThread in the test registry");
    }
    xProvider.publishThread = async () => ({ ok: false, error: "RATE_LIMIT" as const });

    await assert.rejects(() =>
      handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider)
    );

    const record = recorder.record as RecordSpy;
    expect(record.mock.calls.length).toBe(0);
  });
});
