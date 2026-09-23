/**
 * @file publishHandlerEdgeCases.test.ts
 * @description Edge-case tests for PublishHandler.handleJob: unknown provider,
 *              provider error propagation, multi-provider independence, and
 *              idempotency on already-published dedupeKeys.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok } from "@shared/types";
import {
  createTestDeps,
  createTestPublishReceipt,
  createMockProvider,
  StubPublicationRecordProbe,
  TEST_ATTEMPT,
} from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishJobInput } from "../src/publishHandler.js";

describe("PublishHandler.handleJob edge cases", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;

  /** A well-formed job for one target, so a scenario states only what it is about. */
  const jobFor = (postId: string, channelId: string, provider?: string): PublishJobInput => ({
    payload: {
      postId,
      channelId,
      accountId: TEST_ATTEMPT.accountId,
      ...(provider !== undefined && { provider }),
    },
    dedupeKey: `publish-${postId}-${channelId}-e1`,
    attemptsMade: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    handler = new PublishHandler(deps);
  });

  // ── 1. Unknown provider ──────────────────────────────────────────────

  describe("unknown provider", () => {
    it("resolves without throwing but increments jobsFailed metric", async () => {
      const job = jobFor("post-001", "ch-001", "nonexistent");

      // handleJob re-throws so BullMQ retries; metrics still incremented.
      await assert.rejects(handler.handleJob(job));

      const jobsFailed = await deps.workerMetrics.metrics.jobsFailed.get();
      const match = jobsFailed.values.find((v) => v.labels.error_category === "processing_error");
      assert.ok(match, "jobsFailed should have been incremented");
      assert.strictEqual(match.value, 1);
    });

    it("records worker error via recordError", async () => {
      const job = jobFor("post-001", "ch-001", "nonexistent");

      await assert.rejects(handler.handleJob(job));

      const errorsByType = await deps.workerMetrics.metrics.errorsByType.get();
      const match = errorsByType.values.find(
        (v) => v.labels.component === "worker" && v.labels.error_type === "job_failed"
      );
      assert.ok(match, "errorsByType should track the worker error");
      assert.strictEqual(match.value, 1);
    });

    it("notifies saga on unknown provider when sagaId is present", async () => {
      const sagaMessages: string[] = [];
      deps.notifyRedis = {
        publish: async (_channel: string, message: string) => {
          sagaMessages.push(message);
          return 1;
        },
      };
      handler = new PublishHandler(deps);

      const base = jobFor("post-001", "ch-001", "nonexistent");
      const job: PublishJobInput = {
        ...base,
        payload: { ...base.payload, sagaId: "saga-001" },
      };

      await assert.rejects(handler.handleJob(job));

      assert.strictEqual(sagaMessages.length, 1);
      const parsed = JSON.parse(sagaMessages[0]!) as {
        type: string;
        data: { error: string };
      };
      assert.strictEqual(parsed.type, "publish.job.failed");
      assert.ok(parsed.data.error.includes("Unknown provider"));
    });
  });

  // ── 2. Provider error propagation ────────────────────────────────────

  describe("provider error propagation", () => {
    it("catches provider error in handleJob and records both publishErr and jobsFailed", async () => {
      const xProvider = deps.providerRegistry["x"]!;

      // Provider publish returns an error result
      xProvider.publish = async () => ({
        ok: false as const,
        error: "RATE_LIMIT" as const,
      });

      const job = jobFor("post-001", "ch-001", "x");

      // handleJob re-throws so BullMQ retries; metrics still recorded.
      await assert.rejects(handler.handleJob(job));

      // publishErr should be incremented by publishSinglePost
      const publishErr = await deps.workerMetrics.metrics.publishErr.get();
      const errMatch = publishErr.values.find(
        (v) => v.labels.provider === "x" && v.labels.error_type === "provider_error"
      );
      assert.ok(errMatch, "publishErr should be incremented");
      assert.strictEqual(errMatch.value, 1);

      // jobsFailed should also be incremented by handleJob's catch
      const jobsFailed = await deps.workerMetrics.metrics.jobsFailed.get();
      const failMatch = jobsFailed.values.find(
        (v) => v.labels.error_category === "processing_error"
      );
      assert.ok(failMatch, "jobsFailed should be incremented");
      assert.strictEqual(failMatch.value, 1);
    });

    it("writes no publish log row for a failure — the record is what says so", async () => {
      const xProvider = deps.providerRegistry["x"]!;
      xProvider.publish = async () => ({
        ok: false as const,
        error: "NETWORK" as const,
      });

      const logStatuses: string[] = [];
      deps.repo.logPublish = async (input) => {
        logStatuses.push(input.status);
        return { ok: true, value: {} };
      };
      handler = new PublishHandler(deps);

      await assert.rejects(handler.handleJob(jobFor("post-001", "ch-001", "x")));

      // The log is a receipt mirror: it carries what DID publish. A failure row
      // there was the only durable trace of an outcome nothing else accounted for.
      assert.deepStrictEqual(logStatuses, []);
    });

    it("tracks failed post KPI via businessKPITracker", async () => {
      const xProvider = deps.providerRegistry["x"]!;
      xProvider.publish = async () => ({
        ok: false as const,
        error: "AUTH" as const,
      });

      let trackedSuccess: boolean | undefined;
      deps.businessKPITracker.trackContentPublication = (m) => {
        trackedSuccess = (m as unknown as { success: boolean }).success;
      };
      handler = new PublishHandler(deps);

      // AUTH excludes the channel, so the job COMPLETES: another attempt would
      // meet the same credential and the record already names the cause.
      await handler.handleJob(jobFor("post-001", "ch-001", "x"));

      assert.strictEqual(trackedSuccess, false);
    });
  });

  // ── 3. Multi-provider independence ───────────────────────────────────

  describe("multi-provider independence", () => {
    it("failing provider does not prevent successful provider from publishing", async () => {
      // Set up two providers: instagram fails, x succeeds
      const igProvider = createMockProvider();
      igProvider.publish = async () => ({
        ok: false as const,
        error: "RATE_LIMIT" as const,
      });

      const xProvider = createMockProvider();
      const receipt = createTestPublishReceipt({ providerPostId: "x-ok-123" });
      xProvider.publish = async () => ({
        ok: true as const,
        value: receipt,
      });

      deps.providerRegistry = { instagram: igProvider, x: xProvider };
      handler = new PublishHandler(deps);

      const igJob = jobFor("post-ig", "ch-ig", "instagram");

      const xJob = jobFor("post-x", "ch-x", "x");

      // Run instagram job (fails — re-throws) then x job (succeeds).
      await assert.rejects(handler.handleJob(igJob));
      await handler.handleJob(xJob);

      // x should have a successful publish logged
      const publishOk = await deps.workerMetrics.metrics.publishOk.get();
      const okMatch = publishOk.values.find(
        (v) => v.labels.provider === "x" && v.labels.content_type === "single"
      );
      assert.ok(okMatch, "x publishOk should be incremented");
      assert.strictEqual(okMatch.value, 1);

      // instagram should have a failed publish logged
      const publishErr = await deps.workerMetrics.metrics.publishErr.get();
      const errMatch = publishErr.values.find(
        (v) => v.labels.provider === "instagram" && v.labels.error_type === "provider_error"
      );
      assert.ok(errMatch, "instagram publishErr should be incremented");
      assert.strictEqual(errMatch.value, 1);
    });

    it("each provider job records its own metrics independently", async () => {
      const igProvider = createMockProvider();
      igProvider.publish = async () => ({
        ok: true as const,
        value: createTestPublishReceipt({ providerPostId: "ig-001" }),
      });

      const xProvider = createMockProvider();
      xProvider.publish = async () => ({
        ok: true as const,
        value: createTestPublishReceipt({ providerPostId: "x-001" }),
      });

      deps.providerRegistry = { instagram: igProvider, x: xProvider };
      handler = new PublishHandler(deps);

      await handler.handleJob(jobFor("p1", "c1", "instagram"));
      await handler.handleJob(jobFor("p2", "c2", "x"));

      const publishOk = await deps.workerMetrics.metrics.publishOk.get();

      const igOk = publishOk.values.find((v) => v.labels.provider === "instagram");
      const xOk = publishOk.values.find((v) => v.labels.provider === "x");

      assert.ok(igOk, "instagram publishOk should exist");
      assert.ok(xOk, "x publishOk should exist");
      assert.strictEqual(igOk.value, 1);
      assert.strictEqual(xOk.value, 1);
    });
  });

  // ── 4. Idempotency: already-published job is skipped ─────────────────

  describe("idempotency", () => {
    it("skips a job whose channel the record already published", async () => {
      (deps.publicationRecord as StubPublicationRecordProbe).answer = () =>
        ok({ episode: 1, outcome: "published" });
      handler = new PublishHandler(deps);

      let publishCalled = false;
      const xProvider = deps.providerRegistry["x"]!;
      xProvider.publish = async () => {
        publishCalled = true;
        return { ok: true, value: createTestPublishReceipt() };
      };

      await handler.handleJob(jobFor("p1", "c1", "x"));

      assert.strictEqual(publishCalled, false, "provider.publish should not be called");

      const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
      assert.ok(skipped.values.length > 0, "jobsSkipped should be incremented");
      assert.strictEqual(skipped.values[0]!.value, 1);
    });
  });
});
