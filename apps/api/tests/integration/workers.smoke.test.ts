/**
 * Tier 5 — Workers smoke tests
 *
 * The deep handler logic (publish flow per provider, retry classification,
 * provider-error mapping) is exercised by the unit suite at
 * `apps/workers/tests/jobHandler.test.ts` + `publishHandlerEdgeCases.test.ts`
 * (real handler, mocked deps). The end-to-end pipeline (saga → BullMQ →
 * publishWorker → provider → saga.publish.completed event → resume saga)
 * is covered by `sagaCustomerFlow.test.ts`'s publish-now test.
 *
 * This file fills the gap in between: confirms the worker process is up,
 * exposes the documented endpoints, and reports the canonical health +
 * metrics shape. A regression in worker bootstrap (e.g., crash on
 * BullMQ canon mismatch as we hit earlier in the canon retrofit) shows
 * up here as the test connection refused, not as silent saga timeouts.
 *
 * @file workers.smoke.test.ts
 * @description Tier 5 worker smoke E2E
 * @layer infrastructure
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const WORKERS_BASE_URL = process.env.WORKERS_BASE_URL || "http://localhost:3300";

describe("Tier 5 — Workers smoke", () => {
  before(async () => {
    let reachable = false;
    try {
      const response = await fetch(`${WORKERS_BASE_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      reachable = response.ok;
    } catch {
      reachable = false;
    }
    assert.ok(
      reachable,
      `Workers not reachable at ${WORKERS_BASE_URL} — start \`pnpm dev\` (or \`pnpm dev:workers\`) before running smoke tests`
    );
  });

  // -----------------------------------------------------------------------
  // Health endpoint
  // -----------------------------------------------------------------------

  it("worker /health returns ok=true", async () => {
    const response = await fetch(`${WORKERS_BASE_URL}/health`);
    assert.strictEqual(response.status, 200);
    const body = (await response.json()) as { ok?: boolean; availableProviders?: string[] };
    assert.strictEqual(body.ok, true, "health body must include ok: true");
  });

  it("worker /health enumerates registered providers", async () => {
    const response = await fetch(`${WORKERS_BASE_URL}/health`);
    const body = (await response.json()) as { availableProviders?: string[] };
    assert.ok(Array.isArray(body.availableProviders), "availableProviders must be an array");
    // The worker registers 11 providers (X / Instagram / Facebook / YouTube
    // / TikTok / Snapchat / Telegram / Pinterest / LinkedIn / Bluesky /
    // Threads). Allow 8+ to avoid brittleness on a renamed provider; the
    // smoke catches the case where the provider registry drops to <8.
    assert.ok(
      (body.availableProviders?.length ?? 0) >= 8,
      `expected ≥8 providers, got ${body.availableProviders?.length}`
    );
  });

  // -----------------------------------------------------------------------
  // Prometheus /metrics endpoint
  // -----------------------------------------------------------------------

  it("worker /metrics returns Prometheus text format", async () => {
    const response = await fetch(`${WORKERS_BASE_URL}/metrics`);
    assert.strictEqual(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assert.ok(
      contentType.includes("text/plain") || contentType.includes("application/openmetrics-text"),
      `expected Prometheus content-type, got: ${contentType}`
    );
    const body = await response.text();
    // Expose-format check: Prometheus payload is line-oriented, has HELP/TYPE
    // comments, and includes worker-specific metric names.
    assert.ok(
      body.includes("# HELP") || body.includes("# TYPE"),
      "metrics must include HELP/TYPE comments"
    );
  });

  it("worker /metrics includes the canon worker metric families", async () => {
    const response = await fetch(`${WORKERS_BASE_URL}/metrics`);
    const body = await response.text();
    // jobs_active / threads_in_progress / queue_depth / worker_health are the
    // four metrics the WorkerMetrics class declares as canonical. If any go
    // missing, dashboards break silently in production.
    const expected = ["worker_health", "jobs_active", "threads_in_progress", "queue_depth"];
    for (const metric of expected) {
      assert.ok(
        body.includes(metric),
        `expected metric "${metric}" in /metrics output; absent indicates WorkerMetrics regression`
      );
    }
  });

  // -----------------------------------------------------------------------
  // Unknown route — confirms the metrics server is not blanket 200
  // -----------------------------------------------------------------------

  it("worker server returns 404 on unknown paths", async () => {
    const response = await fetch(`${WORKERS_BASE_URL}/unknown-path`);
    assert.strictEqual(response.status, 404);
  });
});
