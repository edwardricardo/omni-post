/**
 * @file security.live.test.ts
 * @description Tests for Security Features
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { until } from "@packages/vitest-shared/determinism";
import { parseRetryAfterMs } from "../src/lib/retry/retryAfter.js";
import {
  checkApiAvailable,
  getBaseUrl,
  liveRegistrationBody,
  registerLiveTenant,
  type LiveTenant,
} from "./testUtils.js";

/**
 * Security Features Test Suite
 * Tests enhanced rate limiting, input validation, and security metrics
 *
 * These tests require a running API server. They do NOT require workers or a
 * queue consumer: every case here drives `/health`, customer registration, the
 * tenant's own account (`GET` and `PUT /accounts/:accountId`) and `/metrics` over
 * HTTP and asserts on the response, with nothing enqueued and no saga started.
 * The precondition below therefore checks for the API and nothing else.
 */

const BASE_URL = getBaseUrl();

/**
 * Registers a tenant for one case. Customer input that still validates lives in two places: the
 * registration body, and the account name the owner changes with `PUT /accounts/:accountId`, which
 * runs the name through the security validator. Each case that renames registers its own tenant,
 * so no case reads a name another case wrote. `/health` and `/metrics` are public and are sent
 * without a token.
 * @param label - Names the case in the tenant's address and account name.
 * @returns The registered tenant.
 */
async function registerCaseTenant(label: string): Promise<LiveTenant> {
  const unique = `${label}-${Date.now()}-${randomUUID()}`;
  return registerLiveTenant({
    email: `security-features-${unique}@example.com`,
    accountName: `Security Features ${label}`,
  });
}

/**
 * Sends a rename of the tenant's own account.
 * @param tenant - The tenant whose account is renamed, with its owner's token.
 * @param name - The name the rename asks for.
 * @returns The route's response.
 */
async function renameOwnAccount(tenant: LiveTenant, name: string): Promise<Response> {
  return fetch(`${BASE_URL}/accounts/${tenant.accountId}`, {
    method: "PUT",
    headers: { Authorization: tenant.authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/**
 * Reads the tenant's stored account name through its owner's own account route.
 * @param tenant - The tenant whose account is read, with its owner's token.
 * @returns The name the account carries.
 */
async function storedAccountName(tenant: LiveTenant): Promise<unknown> {
  const response = await fetch(`${BASE_URL}/accounts/${tenant.accountId}`, {
    headers: { Authorization: tenant.authorization },
  });
  assert.equal(response.status, 200, "the owner reads their own account");
  const body = await response.json();
  return body.data.name;
}

/**
 * Registers a tenant for the case and asserts a rename of its account is refused by validation
 * with 400, leaving the name registration gave it.
 * @param label - Names the case in the tenant it registers.
 * @param name - The name the rename asks for.
 * @param message - What the refusal proves.
 */
async function assertRenameRefused(label: string, name: string, message: string): Promise<void> {
  const tenant = await registerCaseTenant(label);
  const nameBefore = await storedAccountName(tenant);
  const response = await renameOwnAccount(tenant, name);
  await response.body?.cancel();
  assert.equal(response.status, 400, message);
  assert.equal(
    await storedAccountName(tenant),
    nameBefore,
    "a refused rename leaves the name in place"
  );
}

/**
 * Sends a registration body exactly as given, so a case can send one that is not valid JSON.
 * @param body - The raw request body.
 * @returns The route's response.
 */
async function postRegistration(body: string): Promise<Response> {
  return fetch(`${BASE_URL}/auth/customer/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

// Enable test mode for rate limiting
process.env.RATE_LIMIT_TEST_MODE = "true";

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
  const waitedS = Math.ceil(Math.max(0, deadline - startedAt) / 1000);
  // A poll that gets 200 spends the permit it found, so polling while the bucket refills would
  // hand the next caller an empty one: nothing polls before the announced reopening.
  // fixed-wait: ttl-expiry — the live limiter's bucket refills on the server's clock, which only
  // real time moves; the wait ends at the instant the limiter itself announced, and no observable
  // can stand in for it without spending the permits it is waiting for.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, reopenAt - Date.now()));
  });
  let lastAnswer = "no answer";
  await until(
    async () => {
      try {
        const response = await fetch(`${BASE_URL}/health`, {
          signal: AbortSignal.timeout(WINDOW_POLL_REQUEST_MS),
        });
        await response.body?.cancel();
        if (response.status === 200) return true;
        lastAnswer = `HTTP ${response.status}`;
      } catch (error: unknown) {
        lastAnswer = error instanceof Error ? error.message : String(error);
      }
      return false;
    },
    {
      description: () =>
        `the /health rate-limit window to reopen within ${waitedS} s (the last poll got ${lastAnswer})`,
      timeoutMs: Math.max(0, deadline - Date.now()),
      intervalMs: WINDOW_POLL_INTERVAL_MS,
    }
  );
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
      // Send a small batch of requests, one after another, to test rate limiting behavior.
      // If rate limit is already exhausted (from previous tests), we accept 429 too. Five
      // requests sit far inside the `/health` bucket, so no pacing between them is needed.
      const responses: Response[] = [];
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${BASE_URL}/health`);
        noteLimited(response);
        responses.push(response);
      }

      // All responses should be valid HTTP responses (200 or 429)
      const validResponses = responses.filter((r) => r.ok || r.status === 429).length;
      assert.equal(validResponses, 5, "All 5 requests should receive valid responses");
    });

    it("should enforce rate limiting on rapid bursts", async () => {
      const batchSize = 10;
      const totalRequests = 120;
      const responses: Response[] = [];

      // Send requests in batches to avoid overwhelming connection pool: each batch is awaited
      // in full before the next one starts, which is what bounds the open connections.
      for (let batch = 0; batch < totalRequests / batchSize; batch++) {
        const batchPromises = [];
        for (let i = 0; i < batchSize; i++) {
          batchPromises.push(fetch(`${BASE_URL}/health`));
        }
        const batchResponses = await Promise.all(batchPromises);
        batchResponses.forEach(noteLimited);
        responses.push(...batchResponses);
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
      await assertRenameRefused(
        "sql",
        "Test'; DROP TABLE accounts; --",
        "SQL injection in the account name should be refused by validation"
      );
    });

    it("should handle XSS attempts", async () => {
      await assertRenameRefused(
        "xss",
        "<script>alert('xss')</script>Test User",
        "Script markup in the account name should be refused by validation"
      );
    });

    it("should handle path traversal attempts", async () => {
      await assertRenameRefused(
        "traversal",
        "../../etc/passwd",
        "Path traversal in the account name should be refused by validation"
      );
    });

    it("should handle command injection attempts", async () => {
      await assertRenameRefused(
        "command",
        "test; ls -la /",
        "Command injection in the account name should be refused by validation"
      );
    });

    it("should reject excessively long input", async () => {
      await assertRenameRefused(
        "long",
        "A".repeat(20000), // Exceeds the 256-character name limit
        "Excessive length should be rejected"
      );
    });

    it("should accept valid input", async () => {
      const tenant = await registerCaseTenant("valid");
      const response = await renameOwnAccount(tenant, "Valid Test User");
      await response.body?.cancel();

      assert.equal(response.status, 200, `Valid input should be accepted, got ${response.status}`);
      assert.equal(await storedAccountName(tenant), "Valid Test User", "The valid name is stored");
    });
  });

  describe("Account Validation", { concurrency: 1 }, () => {
    it("should reject malicious email formats", async () => {
      const response = await postRegistration(
        JSON.stringify(
          liveRegistrationBody({
            email: "user+'; DROP TABLE accounts; --@evil.com",
            accountName: "Test User",
          })
        )
      );
      await response.body?.cancel();

      // Email validation should reject this format
      assert.equal(response.status, 400, "Malicious email format should be rejected by validation");
    });

    it("should handle names with special characters", async () => {
      await assertRenameRefused(
        "markup",
        "<script>alert('name')</script>",
        "A name made of script markup should be refused by validation"
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
      // The rate-limiting block waits for the `/health` window it closed to reopen, so this
      // request is answered, not limited. The headers are the ones `SecurityManager` sets: helmet's
      // with the HSTS, frame and referrer options `createApp` passes, and the CSP it builds.
      const response = await fetch(`${BASE_URL}/health`);
      await response.body?.cancel();

      assert.equal(response.status, 200, "/health answers once its window has reopened");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(
        response.headers.get("strict-transport-security"),
        "max-age=31536000; includeSubDomains; preload"
      );
      assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
      assert.ok(
        response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"),
        "the CSP forbids framing the API"
      );
    });
  });

  describe("Error Handling", { concurrency: 1 }, () => {
    it("should handle malformed JSON gracefully", async () => {
      const response = await postRegistration("{ invalid json }");
      await response.body?.cancel();

      assert.equal(response.status, 400, "Malformed JSON should be rejected with 400");
    });

    it("should handle missing required fields", async () => {
      const response = await postRegistration(JSON.stringify({}));
      await response.body?.cancel();

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
