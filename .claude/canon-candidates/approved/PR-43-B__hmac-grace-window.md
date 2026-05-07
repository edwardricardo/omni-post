# Canon Candidate — Webhook HMAC secret rotation grace window

## Metadata

- **Task surfacing this gap**: PR-43-B (Wave 3.2 — webhook secretKey regen + grace window)
- **Specific decision**: when an admin rotates `WebhookSubscription.secretKey`, for how long should the previous secret be accepted by the HMAC verifier? Configurable per-rotation. Default 24h. Range 1h–720h (1 month) in current implementation.
- **Decision date**: 2026-05-06
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-06)

## Why this gap exists

- **Existing canon adjacent**:
  - `cockburn-hexagonal-architecture` (stateless adapters) — covers structure, not the rotation policy
  - `pino-redaction-docs` — covers logging, not the rotation policy
  - `owasp-a092025-security-logging-and-alerting-failures` — covers audit emission, not the rotation policy
- **What's missing in those entries**: none of them prescribe a default grace window duration or a max-cap for HMAC dual-key acceptance.
- **Why default heuristic is insufficient**: I picked 24h default + 720h max via intuition. "24h" felt like a Stripe-ism but I didn't verify. "720h max" was set to allow long-tail rotation but may be over-permissive — the longer the grace window, the closer it comes to "two valid secrets" rather than "rotation in progress". Need authoritative grounding.

## Research scope

- **Search keywords**: `webhook secret rotation grace window`, `HMAC dual-key acceptance`, `signing secret cutover overlap`
- **Sources targeted**: official platform docs from scaled webhook providers (Stripe, GitHub, Slack, Shopify) — these set de-facto industry conventions.
- **Sources excluded**: blog posts without affiliation; HMAC RFCs (no rotation policy at the spec level — operational concern).

## Sources consulted

### [1] Stripe — Webhook signatures docs — [docs.stripe.com](https://docs.stripe.com/webhooks/signatures)

- **Fetched**: 2026-05-06
- **Authority**: Stripe handles webhooks at planet scale; their rotation procedure is the most-cited industry pattern.
- **Key claims**:
  - "Multiple signatures with the same scheme-secret pair when you roll an endpoint's secret"
  - "Keep the previous secret active for **up to 24 hours**"
  - "Choose to immediately expire the current secret or delay its expiration for up to 24 hours to allow yourself time to update the verification code on your server"
  - HMAC-SHA256, hex encoding, `Stripe-Signature` header, signed payload = `timestamp + "." + body`
  - Explicit recommendation: "use a constant-time-string comparison to compare the expected signature to each of the received signatures"
- **My reading**: Strongest authority for "24h grace window" as the canonical default. Stripe explicitly caps at 24h — they don't allow longer.

### [2] GitHub — Validating webhook deliveries — [docs.github.com](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

- **Fetched**: 2026-05-06
- **Authority**: GitHub webhooks are the second-most-cited reference for HMAC validation patterns.
- **Key claims**:
  - HMAC-SHA256, hex encoding, `X-Hub-Signature-256` header
  - Explicit anti-pattern: "Never use a plain `==` operator. Instead consider using a method like `secure_compare` or `crypto.timingSafeEqual`"
  - "Choose a random string of text with high entropy" for the secret
  - **Silent on grace window / dual-key acceptance** — no documented rotation overlap.
- **My reading**: GitHub does NOT document a grace window. Their model assumes operator coordinates rotation with the consumer atomically. This puts the burden on the consumer side (which is what OmniPost is implementing — we're the consumer's helper in this case).

### [3] Slack — Verifying requests — [docs.slack.dev](https://docs.slack.dev/authentication/verifying-requests-from-slack)

- **Fetched**: 2026-05-06
- **Authority**: Slack signing-secret pattern is a common reference for "verify timestamps + HMAC" combination.
- **Key claims**:
  - HMAC-SHA256, hex encoding, `X-Slack-Signature` header (format `v0=<digest>`)
  - **5-minute timestamp tolerance** for replay protection
  - Explicit: "use an hmac `compare` function instead of directly comparing the signatures for equality"
  - **Signing secrets**: NO dual-key overlap documented. Regenerate-and-replace.
  - **Client secrets** (separate concern): Slack DOES document 24h overlap for OAuth client secrets ("previous secret remains valid for 24 hours unless revoked manually").
- **My reading**: Interesting split — Slack uses 24h grace for OAuth client secrets but not for HMAC signing secrets. The implication: the operator is expected to coordinate signing-secret rotation atomically. For OAuth client secrets, a grace window is canonical (matches our PR-43-C OIDC use case as well).

### [4] Shopify — Webhooks: Verify — [shopify.dev](https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-3-verify-the-webhook)

- **Fetched**: 2026-05-06
- **Authority**: Shopify is another scaled e-commerce webhook source.
- **Key claims**:
  - HMAC-SHA256, **base64 encoding** (different from hex), `X-Shopify-Hmac-SHA256` header
  - "When you rotate an app's client secret, it can take **up to an hour** for the HMAC digest to be generated using the new secret" — eventual consistency, not dual-acceptance
  - Explicit `crypto.timingSafeEqual` recommendation
  - No grace window for signing secrets
- **My reading**: Shopify's "up to 1 hour transition" is a propagation delay (their backend takes time to switch) — it's NOT a deliberate dual-key window. So the consumer might receive webhooks signed with the old or new secret during that hour, but it's outside operator control. Different design from Stripe's deliberate 24h grace.

## Synthesis

### Recommendation: USE

- **24h default grace window** — directly aligned with Stripe [1]. Single most-cited industry default.
- **HMAC-SHA256** — universal across all 4 sources (already in our code via `verifyWebhookSignature`).
- **Constant-time comparison** (`crypto.timingSafeEqual` or framework equivalent) — universal across all 4 sources. Already in `@packages/api-common/src/webhookSignature.ts`.
- **Audit log emission when fallback (previousSecretKey) accepts a webhook** — aligns with OWASP A09:2025 audit trail principles. Already in our `webhookHandlerCore.ts:150-159`.
- **Timestamp-in-payload OR replay-protection mechanism** — Stripe and Slack both have explicit timestamp tolerance. Out of scope for this candidate (PR-43-B does not change the verifier signature scheme; only adds fallback secret).

### Recommendation: AVOID

- **Grace windows > 168h (7 days)** — beyond a week, the "rotation in progress" framing breaks down. The system has effectively two valid secrets indefinitely. Stripe caps at 24h; we should cap meaningfully tighter than our current 720h (30 days). **REFACTOR CANDIDATE**: tighten `MAX_GRACE_HOURS` from `24*30` to `24*7` (168h, 7 days). Edward's call.
- **Auto-rotate without operator-controlled cutover** — our implementation is admin-triggered and matches the Stripe model. Don't move to background automation without further research (would need a new canon entry).
- **Silent fallback (no log)** — never accept a webhook with the old secret without emitting an audit event. Already handled.

### Tradeoffs / decision tree

- **If platform receives webhooks from many tenants concurrently during rotation**: 24h is barely enough — recommend 24h.
- **If platform has very few webhooks per tenant per day**: 24h is plenty.
- **If incident response (compromise scenario)**: operator should set grace = 0 (or near-zero) by separately invalidating + regenerating without overlap. Our `MIN_GRACE_HOURS = 1` is the floor today; for incident response, the operator would NOT use this rotation flow — they'd directly regenerate without grace via a separate "compromise" path (not built; future).
- **Open question**: should there be a separate "emergency rotate" endpoint that bypasses grace? Defer.

### Pinned values / flags

- `WEBHOOK_GRACE_WINDOW_DEFAULT_HOURS`: `24` — aligned with Stripe.
- `WEBHOOK_GRACE_WINDOW_MIN_HOURS`: `1` — operator floor for fast rotation.
- `WEBHOOK_GRACE_WINDOW_MAX_HOURS`: `168` (7 days) — **PROPOSED CHANGE** from current `720` (30 days). Beyond 7 days, "grace" semantics break.
- `WEBHOOK_HMAC_ALGORITHM`: `SHA-256` — universal.
- `WEBHOOK_HMAC_COMPARISON`: `crypto.timingSafeEqual` (Node) or equivalent constant-time function — universal.

## Proposed canon-index.json entry

```json
{
  "key": "webhook-hmac-secret-rotation-grace-window",
  "topic": "Webhook HMAC secret rotation — grace window pattern",
  "area": "Security · Webhooks · Secret rotation",
  "summary": "When rotating a webhook signing secret, accept signatures from BOTH the new and previous secret during a configurable grace window. Default 24 hours (aligned with Stripe). Cap at 7 days. Beyond that window, the dual-key model degrades into 'two parallel secrets'. Verifier MUST use constant-time comparison and MUST emit an audit log entry whenever the previous secret accepts a payload (visibility into rotation progress + abuse detection).",
  "keyTakeaway": "Stripe is the only major scaled provider explicitly documenting an operator-controlled grace window for webhook HMAC rotation (24h cap). GitHub, Slack, Shopify do not — they assume atomic cutover. For platforms helping operators rotate (like OmniPost helping its tenants), 24h default + 7-day max + audit-on-fallback is the canonical synthesis.",
  "patternAdopted": "WebhookSubscription has nullable previousSecretKey + previousSecretKeyExpiresAt columns. RotateWebhookSecretKeyUseCase generates new 32-byte hex secret, moves current → previousSecretKey, stamps expiresAt = now + graceWindowHours. verifyWithGraceWindow() pure helper tries primary secret first, falls back to previous if expiresAt > now. Emit warning log via pino with webhookSubscriptionId when fallback succeeds. Default 24h, range 1h–168h (7 days).",
  "usedIn": "PR-43-B (Wave 3.2 — webhook secretKey regen + grace window)",
  "date": "2026-05-06",
  "sources": [
    {
      "url": "https://docs.stripe.com/webhooks/signatures",
      "fetchedAt": "2026-05-06",
      "title": "Stripe — Webhook signatures (24h grace cap)"
    },
    {
      "url": "https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries",
      "fetchedAt": "2026-05-06",
      "title": "GitHub — Validating webhook deliveries (no documented grace)"
    },
    {
      "url": "https://docs.slack.dev/authentication/verifying-requests-from-slack",
      "fetchedAt": "2026-05-06",
      "title": "Slack — Verifying requests (5-min replay tolerance, no signing-secret grace)"
    },
    {
      "url": "https://shopify.dev/docs/apps/build/webhooks/subscribe/https",
      "fetchedAt": "2026-05-06",
      "title": "Shopify — Webhook verification (~1h propagation, no deliberate grace)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-06",
  "version": 1,
  "appliesTo": [
    "apps/api/src/application/webhooks/",
    "apps/api/src/webhooks/webhookHandlerCore.ts",
    "packages/api-common/src/webhookSignature.ts"
  ]
}
```

## Impact on existing code

- **Files that should change** (research surfaced different optimal pattern):
  - `apps/api/src/application/webhooks/RotateWebhookSecretKeyUseCase.ts:19` — `MAX_GRACE_HOURS = 24 * 30` (720h / 30 days). **Recommended tighten to `24 * 7` (168h / 7 days)** per Stripe-aligned reasoning. Beyond 7 days, "grace" semantics degrade into "two parallel secrets indefinitely" — not the model we want.
  - Tests in `apps/api/tests/unit/application/webhooks/RotateWebhookSecretKeyUseCase.test.ts:44` — assertion `graceWindowHours: 24 * 31` will need updating to `168 + 1 = 169` (or similar boundary value). Refactor effort: 5 min.
  - Frontend `apps/admin/app/(dashboard)/security/webhooks/page.tsx:72` — input `max={720}` should drop to `max={168}`. Description text "(hours, 1–720)" should update to "(hours, 1–168)". Refactor effort: 5 min.
- **Files that already align with this canon**:
  - `apps/api/src/webhooks/webhookHandlerCore.ts:65-80` — `verifyWithGraceWindow` pure helper with primary-then-fallback pattern. ✓
  - `apps/api/src/webhooks/webhookHandlerCore.ts:150-159` — emits `webhookLogger.warn` with `webhookSubscriptionId` when fallback accepts. ✓
  - `packages/api-common/src/webhookSignature.ts` — uses HMAC-SHA256 + `timingSafeEqual` per existing pattern. ✓ (verified in this candidate; canon-aligned).
  - `WEBHOOK_GRACE_WINDOW_DEFAULT_HOURS = 24` — matches Stripe ✓.
  - `MIN_GRACE_HOURS = 1` — reasonable floor; not contested by any source.

## Edward's review

- [x] Sources are sufficient (4 from official platform docs — Stripe, GitHub, Slack, Shopify)
- [x] Recommendations match project values
- [x] Pinned values reasonable for our scale + threat model
- [x] Approve append to `canon_research_index.md`
- [x] Trigger refactor commit on `RotateWebhookSecretKeyUseCase.ts` (MAX 720h → 168h) + test + frontend page
- Notes: This is exactly what we are looking for every time.
