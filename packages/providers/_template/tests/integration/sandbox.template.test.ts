/**
 * @file sandbox.template.test.ts
 * @description Template for per-provider sandbox integration tests (still
 *   pending). Copy this file to `packages/providers/<provider>/tests/
 *   integration/sandbox.test.ts`, and replace the <PROVIDER> markers and
 *   the assertions with the adapter's real logic.
 *
 *   "Skip when no creds" pattern: the test runs ONLY when the env vars
 *   are present. Local dev without creds → skip. CI without creds → skip. CI
 *   with GitHub Secrets configured → runs + catches upstream API drift.
 *
 *   Setup checklist per provider:
 *   1. Provision a sandbox app in the provider's developer portal
 *      (Meta/X/LinkedIn/TikTok/etc).
 *   2. Add `<PROVIDER>_TEST_*` env vars to GitHub Actions Secrets.
 *   3. Copy this template to `packages/providers/<provider>/tests/
 *      integration/sandbox.test.ts` and replace the markers.
 *   4. Enable the `provider-sandbox.yml` workflow.
 *
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";

// Replace `EXAMPLE` with the provider's name in UPPER_SNAKE_CASE.
const SKIP = !process.env.EXAMPLE_TEST_ACCESS_TOKEN || !process.env.EXAMPLE_TEST_ACCOUNT_ID;

describe.skipIf(SKIP)("ExampleAdapter — sandbox integration", () => {
  it("publishes against the sandbox API and parses the canonical response shape", async () => {
    // 1. Construct adapter with REAL apiClientFactory (default — uses real HTTP).
    // 2. Use sandbox credentials from env vars.
    // 3. Call adapter.publish(...).
    // 4. Assert response shape matches what the adapter's port expects.
    //
    // If this breaks in the nightly run: the upstream API changed and the
    // adapter needs updating.

    // Example:
    // const adapter = new ExampleAdapter();
    // const creds = {
    //   accessToken: process.env.EXAMPLE_TEST_ACCESS_TOKEN!,
    //   accountId: process.env.EXAMPLE_TEST_ACCOUNT_ID!,
    // };
    // const result = await adapter.publish(input, creds);
    // expect(result.ok).toBe(true);
    // expect(result.value.providerPostId).toMatch(/^\d+$/);

    expect(true).toBe(true); // stand-in assertion: replace it with the real ones above
  });

  it("validates credentials against the real sandbox auth endpoint", async () => {
    // Checks that `adapter.validateCredentials(creds)` returns ok=true for
    // valid creds. Catches changes in the auth endpoint/scope requirements.

    expect(true).toBe(true); // stand-in assertion: replace it with the provider's real check
  });

  // Add more assertions for the provider's critical contract:
  // - fetchAnalytics → response shape
  // - deletePost → idempotency
  // - rate limit headers → expected fields present
  // - error responses → adapter wrap correctly
});
