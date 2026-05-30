/**
 * @file sandbox.template.test.ts
 * @description Template para sandbox integration tests por-provider (> 3.2.c
 *   PENDING). Copiar este archivo a `packages/providers/<provider>/tests/
 *   integration/sandbox.test.ts`, reemplazar los placeholders <PROVIDER> y
 *   las assertions con la lógica real del adapter.
 *
 *   Patrón "skip when no creds": el test se ejecuta SOLO cuando las env vars
 *   están presentes. Local dev sin creds → skip. CI sin creds → skip. CI con
 *   GitHub Secrets configurados → corre + atrapa upstream API drift.
 *
 *   Setup checklist por provider (Phase B):
 *   1. Provisionar sandbox app en el developer portal del provider
 *      (Meta/X/LinkedIn/TikTok/etc).
 *   2. Agregar `<PROVIDER>_TEST_*` env vars a GitHub Actions Secrets.
 *   3. Copiar este template a `packages/providers/<provider>/tests/
 *      integration/sandbox.test.ts` y reemplazar placeholders.
 *   4. Habilitar el `provider-sandbox.yml` workflow (> 3.2.d).
 *
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";

// Replace `EXAMPLE` con el nombre del provider en UPPER_SNAKE_CASE.
const SKIP = !process.env.EXAMPLE_TEST_ACCESS_TOKEN || !process.env.EXAMPLE_TEST_ACCOUNT_ID;

describe.skipIf(SKIP)("ExampleAdapter — sandbox integration", () => {
  it("publishes against the sandbox API and parses the canonical response shape", async () => {
    // 1. Construct adapter with REAL apiClientFactory (default — uses real HTTP).
    // 2. Use sandbox credentials from env vars.
    // 3. Call adapter.publish(...).
    // 4. Assert response shape matches what the adapter's port expects.
    //
    // Si esto rompe en nightly: el API upstream cambió y el adapter
    // necesita ser actualizado.

    // Example:
    // const adapter = new ExampleAdapter();
    // const creds = {
    //   accessToken: process.env.EXAMPLE_TEST_ACCESS_TOKEN!,
    //   accountId: process.env.EXAMPLE_TEST_ACCOUNT_ID!,
    // };
    // const result = await adapter.publish(input, creds);
    // expect(result.ok).toBe(true);
    // expect(result.value.providerPostId).toMatch(/^\d+$/);

    expect(true).toBe(true); // placeholder until real assertions
  });

  it("validates credentials against the real sandbox auth endpoint", async () => {
    // Verifica que `adapter.validateCredentials(creds)` retorna ok=true para
    // creds válidas. Atrapa cambios en el auth endpoint/scope requirements.

    expect(true).toBe(true); // placeholder
  });

  // Agregar más assertions según el contract crítico del provider:
  // - fetchAnalytics → response shape
  // - deletePost → idempotency
  // - rate limit headers → expected fields presentes
  // - error responses → adapter wrap correctly
});
