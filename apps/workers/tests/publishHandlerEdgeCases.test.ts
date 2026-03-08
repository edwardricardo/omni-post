/**
 * Edge-case tests for PublishHandler.handleJob
 *
 * Covers three scenarios not tested elsewhere:
 *   1. Unknown provider → job resolves but records failure metrics
 *   2. Provider error propagation → publishSinglePost throws, handleJob catches
 *   3. Multi-provider independence → one provider failure does not affect others
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDeps, createTestPublishReceipt, createMockProvider } from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishJobInput } from "../src/publishHandler.js";

describe("PublishHandler.handleJob edge cases", { concurrency: 1 }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;

  beforeEach(() => {
    deps = createTestDeps();
    handler = new PublishHandler(deps);
  });

  // ── 1. Unknown provider ──────────────────────────────────────────────

  describe("unknown provider", () => {
    it("resolves without throwing but increments jobsFailed metric", async () => {
      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "nonexistent",
        },
      };

      // handleJob catches the error from resolveProvider — should NOT throw
      await handler.handleJob(job);

      const jobsFailed = await deps.workerMetrics.metrics.jobsFailed.get();
      const match = jobsFailed.values.find((v) => v.labels.error_category === "processing_error");
      assert.ok(match, "jobsFailed should have been incremented");
      assert.strictEqual(match.value, 1);
    });

    it("records worker error via recordError", async () => {
      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "nonexistent",
        },
      };

      await handler.handleJob(job);

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

      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "nonexistent",
          sagaId: "saga-001",
        },
      };

      await handler.handleJob(job);

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

      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "x",
        },
      };

      // handleJob should resolve (not throw) even though the provider failed
      await handler.handleJob(job);

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

    it("logs ERR status to publish log before handleJob catches", async () => {
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

      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "x",
        },
      };

      await handler.handleJob(job);

      // Should have logged RUNNING first, then ERR
      assert.ok(logStatuses.includes("RUNNING"), "Should log RUNNING status");
      assert.ok(logStatuses.includes("ERR"), "Should log ERR status");
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

      const job: PublishJobInput = {
        payload: {
          postId: "post-001",
          channelId: "ch-001",
          provider: "x",
        },
      };

      await handler.handleJob(job);

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

      const igJob: PublishJobInput = {
        payload: {
          postId: "post-ig",
          channelId: "ch-ig",
          provider: "instagram",
        },
      };

      const xJob: PublishJobInput = {
        payload: {
          postId: "post-x",
          channelId: "ch-x",
          provider: "x",
        },
      };

      // Run instagram job (fails) then x job (succeeds) — both resolve
      await handler.handleJob(igJob);
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

      await handler.handleJob({
        payload: { postId: "p1", channelId: "c1", provider: "instagram" },
      });
      await handler.handleJob({
        payload: { postId: "p2", channelId: "c2", provider: "x" },
      });

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
    it("skips job when dedupeKey already has OK status", async () => {
      deps.repo.getLogByDedupeKey = async () => ({
        ok: true,
        value: { status: "OK" },
      });
      handler = new PublishHandler(deps);

      let publishCalled = false;
      const xProvider = deps.providerRegistry["x"]!;
      xProvider.publish = async () => {
        publishCalled = true;
        return { ok: true, value: createTestPublishReceipt() };
      };

      await handler.handleJob({
        payload: { postId: "p1", channelId: "c1", provider: "x" },
      });

      assert.strictEqual(publishCalled, false, "provider.publish should not be called");

      const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
      assert.ok(skipped.values.length > 0, "jobsSkipped should be incremented");
      assert.strictEqual(skipped.values[0]!.value, 1);
    });
  });
});
