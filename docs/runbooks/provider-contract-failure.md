# Runbook — Provider Contract Test Failure

> Alert: `.github/workflows/provider-sandbox.yml` (nightly) — once wired
> SLO: `docs/observability/SLO.md#providers`
> Provider catalog: 11 social providers (x, instagram, facebook, youtube, tiktok, snapchat, telegram, pinterest, linkedin, bluesky, threads) + billing gateways (Stripe, Paddle — out of scope, separate workstream).

## Síntoma

A nightly contract test for one of the 11 social providers fails. The test asserts that:

- The provider's HTTP request shape (URL, method, headers, body) matches the recorded MSW handler, OR
- The provider's response parsing (status code, body schema) matches what the adapter expects.

A failure means the upstream API contract drifted from what our adapter assumes — **breaking change in production is now a clock**.

## Severidad

- **HIGH** if the provider is one of the active publishing platforms in customer use (publish flow blocked).
- **MEDIUM** if the failure is on a low-traffic provider OR limited to a non-critical endpoint (e.g., analytics ingestion vs. post publishing).
- **LOW** if the failure is a deprecation warning that does not yet break the request/response.

The runbook caller decides severity from the failing test name + provider's customer footprint.

## Qué detecta

Contract tests use [MSW](https://mswjs.io/) (Mock Service Worker, v2.x) to intercept HTTP traffic from the provider adapter. Each provider has a `tests/integration/contract.test.ts` that:

1. Registers MSW handlers replaying recorded upstream responses (canonical from a sandbox/test API).
2. Invokes the provider adapter with realistic input.
3. Asserts the assembled request matches the handler's expectations (URL, headers, body), OR
4. Asserts the parsed response matches the adapter's domain mapping.

A test failure means either:

- **Request shape drift**: our adapter sends a request the handler does not match (we changed something, OR the provider changed required fields/headers).
- **Response shape drift**: the handler emits a payload our adapter no longer parses (provider changed response field names/types).

## Diagnóstico paso-a-paso

1. **Identify the failing provider + endpoint.** The CI failure annotation shows the test file path:

   ```
   packages/providers/<provider>/tests/integration/contract.test.ts > <suite> > <test>
   ```

   The `<test>` name describes the endpoint (e.g., `"publishes a post via /publish"`, `"refreshes token via /oauth2/token"`).

2. **Reproduce locally.**

   ```bash
   cd packages/providers/<provider>
   pnpm test contract.test.ts
   ```

3. **Read the failure diff.** MSW reports the mismatch:
   - If **request mismatch**: log the actual request vs. expected handler signature. Source of drift is usually our adapter (recent change) OR a provider API deprecation that demands new headers.
   - If **response parse failure**: the recorded fixture under `packages/providers/<provider>/tests/integration/fixtures/` is no longer valid. Re-record from the provider's sandbox API.

4. **Cross-check against the provider's changelog.** Each provider publishes API deprecations:
   - Meta (Instagram, Facebook): https://developers.facebook.com/docs/graph-api/changelog
   - X: https://docs.x.com/x-api/release-notes
   - YouTube: https://developers.google.com/youtube/v3/revision_history
   - TikTok: https://developers.tiktok.com/doc/changelog
   - LinkedIn: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/release-notes
   - Snapchat: https://businesshelp.snapchat.com/s/article/api-release-notes
   - Pinterest: https://developers.pinterest.com/docs/api/v5/release-notes/
   - Bluesky: https://github.com/bluesky-social/atproto/releases
   - Threads: https://developers.facebook.com/docs/threads/changelog
   - Telegram: https://core.telegram.org/bots/api-changelog

5. **Classify the drift.**

   | Class                            | Action                                                                                                  |
   | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
   | Provider added required field    | Adapter must include the field. New request schema → update Zod input schema + adapter mapping.         |
   | Provider deprecated field        | Adapter must stop sending. Schedule removal aligned with provider's deprecation date.                   |
   | Provider renamed field           | Update adapter mapping. Schedule a release that covers the rename window (often providers accept both). |
   | Provider response schema changed | Update Zod response schema + parser. Re-record MSW fixture.                                             |
   | Auth flow changed                | OAuth2 scope additions / token TTL changes → coordinate with `apps/api/src/auth/`.                      |

## Resolución por clase

### Request shape drift (we send something wrong)

1. Update the adapter source: `packages/providers/<provider>/src/adapter.ts` (or `apiClient.ts`).
2. Update the request schema (Zod) if applicable.
3. Update the MSW handler in `tests/integration/handlers/` to match new expected request.
4. Re-run `pnpm test contract.test.ts` until green.
5. Commit + push.

### Response shape drift (provider returns something new)

1. Update the response Zod schema in `packages/providers/<provider>/src/types.ts`.
2. Update the domain mapping (adapter `parseResponse()` or equivalent).
3. **Re-record the MSW fixture** from a provider sandbox call (do NOT hand-edit the fixture — record from live sandbox to avoid drift again):
   ```bash
   # If the provider has a sandbox:
   PROVIDER_SANDBOX_TOKEN=... pnpm --filter @providers/<provider> record-fixture <endpoint>
   ```
4. Commit the new fixture + updated handlers + adapter changes.
5. Re-run tests.

### Production impact

If the contract test failure represents a breaking change **already in effect** (not a future deprecation), customer publish flows for that provider are blocked. Immediate actions:

1. Check `apps/api/src/billing/` (NO — that's billing) — check `packages/providers/<provider>/src/` recent commits to confirm we did not introduce the drift on our side.
2. Check Sentry for the same error class in production traffic. If yes → the breakage is already affecting customers.
3. If yes → P1 hotfix: revert any local change to the provider adapter, OR cut a quick adapter update + deploy.
4. If no → the contract test is alerting on a future change. Schedule the adapter update + provider deprecation date.

## Cómo confirmar la fix

1. Local contract test green: `pnpm --filter @providers/<provider> test contract.test.ts`.
2. CI green on the PR.
3. (When provider has sandbox configured) The nightly `provider-sandbox.yml` run hits the provider's real sandbox and the request is accepted → no drift remains.

## Prevention

- Run the nightly sandbox suite weekly (cron-trigger artifact retention).
- Subscribe to each provider's API changelog / developer mailing list (manual operator burden until automated).
- Add Sentry alert for the same error class in production (linked to provider issuer field) once Sentry alerting wiring lands.

## Referencias

- Provider testing canon: `docs/architecture/provider-testing.md`
- MSW 2.x docs: https://mswjs.io/docs/
- Provider catalog (canonical 11): `infra/prisma/schema.prisma` (enum `Provider`)
- Adapter pattern: `packages/providers/_template/` (canonical structure for new providers)
- DLQ behavior: `apps/api/src/webhooks/` + `@adapters/dead-letter-queue` (failures from provider calls land here)

## Status

This runbook is the skeleton structure. Specific provider invocations + Sentry alert wiring lands as each provider migrates to MSW handlers. The runbook is committed today so that any provider failure that occurs before the full migration has documented procedure — operators do not improvise.
