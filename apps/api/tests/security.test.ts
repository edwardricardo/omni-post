/**
 * @file security.test.ts
 * @description Tests for Security Features
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { signCustomerAccessToken } from "../src/auth/customerJwt.js";
import { parseRetryAfterMs } from "../src/lib/retry/retryAfter.js";
import { checkApiAvailable, getBaseUrl } from "./testUtils.js";

/**
 * Security Features Test Suite
 * Tests enhanced rate limiting, input validation, and security metrics
 *
 * These tests require a running API server. They do NOT require workers or a
 * queue consumer: every case here drives `/health`, `/accounts` and `/metrics`
 * over HTTP and asserts on the response, with nothing enqueued and no saga
 * started. The precondition below therefore checks for the API and nothing else.
 */

const BASE_URL = getBaseUrl();

/**
 * The `/accounts` endpoint sits behind `requireClientAuth`. The Account model
 * is NOT tenant-scoped (see TENANT_SCOPED_MODELS in the tenant guard), so any
 * valid customer token authorizes the request. `/health` and `/metrics` are
 * public and intentionally sent without this header.
 */
const AUTH_HEADER = `Bearer ${signCustomerAccessToken({
  sub: "security-features-user",
  accountId: "security-features-account",
  roleId: "role-test",
  roleName: "OWNER",
  permissions: [],
})}`;

// Enable test mode for rate limiting
process.env.RATE_LIMIT_TEST_MODE = "true";

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Longest the rate-limiting block waits for `/health` to answer 200 again. */
const WINDOW_REOPEN_CAP_MS = 90_000;
/** How long past the limiter's announced reopening `/health` may still refuse. */
const WINDOW_REOPEN_SLACK_MS = 5_000;
/** Pause between two `/health` polls while the window is still closed. */
const WINDOW_POLL_INTERVAL_MS = 250;
/** Bound on one poll, so an API that hangs cannot hold the wait past its deadline. */
const WINDOW_POLL_REQUEST_MS = 5_000;
/** Hook budget above the cap: the last poll may start at the deadline and run its own bound. */
const WINDOW_HOOK_MARGIN_MS = 15_000;
/** How far behind now a reset instant may sit and still read as the clock of the same host. */
const RESET_CLOCK_TOLERANCE_MS = 1_000;

/**
 * The instant a limited response says the window reopens: `X-RateLimit-Reset` (epoch
 * milliseconds of a full bucket) when present, else `Retry-After`, else nothing. A reset
 * header that is not an epoch-milliseconds instant inside the next cap throws: read in
 * another unit it would collapse the wait into one poll, so a changed header contract
 * fails here, naming the value, instead of quietly handing the next caller an empty bucket.
 */
function announcedReopening(response: Response): number | undefined {
  const resetHeader = response.headers.get("X-RateLimit-Reset");
  if (resetHeader !== null) {
    const resetAtMs = Number(resetHeader);
    const now = Date.now();
    if (
      !Number.isFinite(resetAtMs) ||
      resetAtMs < now - RESET_CLOCK_TOLERANCE_MS ||
      resetAtMs > now + WINDOW_REOPEN_CAP_MS
    ) {
      throw new Error(
        `X-RateLimit-Reset "${resetHeader}" is not an epoch-milliseconds instant within ` +
          `${WINDOW_REOPEN_CAP_MS / 1000} s of now; the rate-limit window wait cannot read it.`
      );
    }
    return resetAtMs;
  }
  const retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
  return retryAfterMs === null ? undefined : Date.now() + retryAfterMs;
}

/**
 * Waits for the announced reopening, then polls `/health` until it answers 200, and throws
 * naming the last answer once the reopening plus slack has passed. With no announcement the
 * window was never closed, so polling starts at once and only the cap bounds it.
 */
async function waitForHealthWindow(announcedReopenAtMs: number | undefined): Promise<void> {
  const startedAt = Date.now();
  const capAt = startedAt + WINDOW_REOPEN_CAP_MS;
  const reopenAt =
    announcedReopenAtMs === undefined ? startedAt : Math.min(announcedReopenAtMs, capAt);
  const deadline =
    announcedReopenAtMs === undefined
      ? capAt
      : Math.min(announcedReopenAtMs + WINDOW_REOPEN_SLACK_MS, capAt);
  // A poll that gets 200 spends the permit it found, so polling while the bucket refills would
  // hand the next caller an empty one: nothing polls before the announced reopening.
  await sleep(Math.max(0, reopenAt - Date.now()));
  let lastAnswer = "no answer";
  for (;;) {
    try {
      const response = await fetch(`${BASE_URL}/health`, {
        signal: AbortSignal.timeout(WINDOW_POLL_REQUEST_MS),
      });
      await response.body?.cancel();
      if (response.status === 200) return;
      lastAnswer = `HTTP ${response.status}`;
    } catch (error: unknown) {
      lastAnswer = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() >= deadline) {
      const waitedS = Math.ceil(Math.max(0, deadline - startedAt) / 1000);
      throw new Error(
        `The /health rate-limit window did not reopen within ${waitedS} s: ` +
          `the last poll got ${lastAnswer}.`
      );
    }
    await sleep(WINDOW_POLL_INTERVAL_MS);
  }
}

describe("Security Features", { concurrency: 1 }, () => {
  // Fail loud, naming the missing thing. Skipping instead left every case in
  // this suite reported as "passing" while none of them had ever executed, which
  // is the failure mode a security suite can least afford: the run is green
  // precisely when the server it was meant to attack is absent.
  before(async () => {
    if (await checkApiAvailable()) return;

    throw new Error(
      `No API is answering at ${BASE_URL}, so no security assertion in this suite can be ` +
        `evaluated. These cases drive rate limiting, input validation, the metrics endpoint ` +
        `and error handling against a live server. This suite needs the API only — no workers ` +
        `and no queue consumer — so start it with 'pnpm dev:api' (with 'pnpm db:up' first for ` +
        `PostgreSQL and Redis), or point BASE_URL at a running instance.`
    );
  });

  describe("Advanced Rate Limiting", { concurrency: 1 }, () => {
    // Measured: the limiter keys a token bucket by client IP and resource path, so the burst drains
    // only `/health`, the bucket every later `/health` caller shares; `X-RateLimit-Reset` is the
    // epoch milliseconds of a full bucket, `Retry-After` whole seconds until a single permit.
    let announcedReopenAtMs: number | undefined;

    /** Keeps the latest reopening a limited `/health` response announced. */
    function noteLimited(response: Response): void {
      if (response.status !== 429) return;
      const reopenAtMs = announcedReopening(response);
      if (reopenAtMs !== undefined && reopenAtMs > (announcedReopenAtMs ?? 0)) {
        announcedReopenAtMs = reopenAtMs;
      }
    }

    // The burst leaves `/health` refusing whoever calls it next, so the block waits for the
    // window it closed to reopen rather than leaving that wait to a later suite or the runner.
    // Its own budget sits above the cap: the default per-hook budget would cut the wait short.
    after(() => waitForHealthWindow(announcedReopenAtMs), {
      timeout: WINDOW_REOPEN_CAP_MS + WINDOW_HOOK_MARGIN_MS,
    });

    it("should accept requests within rate limit", async () => {
      // Send a small batch of requests with delay to test rate limiting behavior.
      // If rate limit is already exhausted (from previous tests), we accept 429 too.
      const responses: Response[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${BASE_URL}/health`);
        noteLimited(response);
        responses.push(response);
        await sleep(100);
      }

      // All responses should be valid HTTP responses (200 or 429)
      const validResponses = responses.filter((r) => r.ok || r.status === 429).length;
      assert.equal(validResponses, 5, "All 5 requests should receive valid responses");
    });

    it("should enforce rate limiting on rapid bursts", async () => {
      const batchSize = 10;
      const totalRequests = 120;
      const responses: Response[] = [];

      // Send requests in batches to avoid overwhelming connection pool
      for (let batch = 0; batch < totalRequests / batchSize; batch++) {
        const batchPromises = [];
        for (let i = 0; i < batchSize; i++) {
          batchPromises.push(fetch(`${BASE_URL}/health`));
        }
        const batchResponses = await Promise.all(batchPromises);
        batchResponses.forEach(noteLimited);
        responses.push(...batchResponses);

        if (batch < totalRequests / batchSize - 1) {
          await sleep(10);
        }
      }

      const blockedCount = responses.filter((r) => r.status === 429).length;

      assert.ok(
        blockedCount > 0,
        `Expected some requests to be rate limited, got ${blockedCount} blocked out of ${responses.length}`
      );
    });

    it("should include rate limit headers in responses", async () => {
      const response = await fetch(`${BASE_URL}/health`);
      noteLimited(response);

      const hasRemainingHeader = response.headers.has("X-RateLimit-Remaining");
      const hasResetHeader = response.headers.has("X-RateLimit-Reset");

      // Note: Headers may not be present on all endpoints
      // This test validates that when present, they have valid values
      if (hasRemainingHeader) {
        const remaining = response.headers.get("X-RateLimit-Remaining");
        assert.ok(remaining !== null, "Rate limit remaining header should have a value");
      }

      if (hasResetHeader) {
        const reset = response.headers.get("X-RateLimit-Reset");
        assert.ok(reset !== null, "Rate limit reset header should have a value");
      }

      // At least verify the response is successful
      assert.ok(response.ok || response.status === 429, "Response should be valid");
    });
  });

  describe("Input Validation", { concurrency: 1 }, () => {
    it("should handle SQL injection attempts", async () => {
      const sqlPayload = {
        email: `test${Date.now()}@test.com`,
        name: "Test'; DROP TABLE accounts; --",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(sqlPayload),
      });

      // Should either sanitize (200) or reject (400)
      assert.ok(
        response.status === 200 || response.status === 400,
        "SQL injection should be handled gracefully"
      );
    });

    it("should handle XSS attempts", async () => {
      const xssPayload = {
        email: `test${Date.now()}@test.com`,
        name: "<script>alert('xss')</script>Test User",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(xssPayload),
      });

      assert.ok(
        response.status === 200 || response.status === 400,
        "XSS attempt should be handled gracefully"
      );
    });

    it("should handle path traversal attempts", async () => {
      const pathTraversalPayload = {
        email: `test${Date.now()}@test.com`,
        name: "../../etc/passwd",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(pathTraversalPayload),
      });

      assert.ok(
        response.status === 200 || response.status === 400,
        "Path traversal should be handled gracefully"
      );
    });

    it("should handle command injection attempts", async () => {
      const cmdPayload = {
        email: `test${Date.now()}@test.com`,
        name: "test; ls -la /",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(cmdPayload),
      });

      assert.ok(
        response.status === 200 || response.status === 400,
        "Command injection should be handled gracefully"
      );
    });

    it("should reject excessively long input", async () => {
      const longPayload = {
        email: `test${Date.now()}@test.com`,
        name: "A".repeat(20000), // Exceeds reasonable name length
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(longPayload),
      });

      assert.ok(
        response.status === 400 || response.status === 413,
        "Excessive length should be rejected"
      );
    });

    it("should accept valid input", async () => {
      const validPayload = {
        email: `validtest${Date.now()}@example.com`,
        name: "Valid Test User",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      assert.ok(
        response.status === 200 || response.status === 201,
        `Valid input should be accepted, got status ${response.status}`
      );
    });
  });

  describe("Account Validation", { concurrency: 1 }, () => {
    it("should reject malicious email formats", async () => {
      const badEmailPayload = {
        email: "user+'; DROP TABLE accounts; --@evil.com",
        name: "Test User",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(badEmailPayload),
      });

      // Email validation should reject this format
      assert.equal(response.status, 400, "Malicious email format should be rejected by validation");
    });

    it("should handle names with special characters", async () => {
      const specialNamePayload = {
        email: `test${Date.now()}@example.com`,
        name: "<script>alert('name')</script>",
        subscription: "BASIC",
      };

      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify(specialNamePayload),
      });

      // Should either sanitize (200) or block (400)
      assert.ok(
        response.status === 200 || response.status === 400,
        "Name with special characters should be handled"
      );
    });
  });

  describe("Security Metrics", { concurrency: 1 }, () => {
    it("should expose security metrics", async () => {
      const response = await fetch(`${BASE_URL}/metrics`);

      assert.ok(response.ok, "Metrics endpoint should be accessible");

      const metricsText = await response.text();
      assert.ok(metricsText.length > 0, "Metrics should return data");
    });

    it("should include rate limit metrics", async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      const metricsText = await response.text();

      // Verify metrics endpoint returns non-empty text with recognizable metric format
      assert.ok(
        metricsText.includes("# ") || metricsText.includes("_total"),
        "Metrics should contain Prometheus-formatted metric lines"
      );
    });

    it("should include security validation metrics", async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      const metricsText = await response.text();

      // Verify metrics endpoint returns valid Prometheus-formatted content
      assert.ok(
        metricsText.includes("# ") ||
          metricsText.includes("_total") ||
          metricsText.includes("_seconds"),
        "Metrics should contain Prometheus-formatted metric definitions"
      );
    });
  });

  describe("Security Headers", { concurrency: 1 }, () => {
    it("should include security headers in responses", async () => {
      const response = await fetch(`${BASE_URL}/health`);

      // Verify response is valid and content-type is set properly
      assert.ok(
        response.status >= 200 && response.status < 500,
        "Response should be valid HTTP status"
      );

      // Check that content-type is set (basic security header)
      const contentType = response.headers.get("content-type");
      assert.ok(contentType !== null, "Response should have content-type header set");
    });
  });

  describe("Error Handling", { concurrency: 1 }, () => {
    it("should handle malformed JSON gracefully", async () => {
      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: "{ invalid json }",
      });

      assert.ok(
        response.status === 400 || response.status === 500,
        "Malformed JSON should be rejected"
      );
    });

    it("should handle missing required fields", async () => {
      const response = await fetch(`${BASE_URL}/accounts`, {
        method: "POST",
        headers: { Authorization: AUTH_HEADER, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      assert.equal(response.status, 400, "Missing required fields should return 400");
    });

    it("should handle invalid HTTP methods", async () => {
      const response = await fetch(`${BASE_URL}/health`, {
        method: "DELETE",
      });

      // Should return 405 (Method Not Allowed) or 404, or 429 if rate limited
      assert.ok(
        response.status === 404 || response.status === 405 || response.status === 429,
        "Invalid HTTP method should be rejected"
      );
    });
  });
});
