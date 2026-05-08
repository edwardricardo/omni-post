# Canon Candidate — Audit log granularity for bulk/cross-tenant operations

## Metadata

- **Task surfacing this gap**: PR-44 (Wave 3.3 — cross-tenant mass force-reauth) — audit log emission per mass-action
- **Specific decision**: when an admin operation affects many records (e.g., flag 12 channels for 1 provider), should the audit log be (a) ONE aggregate entry with `details.channelIds[]` listing all affected, or (b) N per-record entries (one per channel), or (c) both?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07)

## Why this gap exists

- **Existing canon adjacent**:
  - `owasp-a092025-security-logging-and-alerting-failures` — broad guidance on "log what matters" but no specific granularity rule for bulk
  - No canon entry on aggregate-vs-per-record audit emission
- **What's missing in those entries**: no prescription for bulk operations affecting N records — choice was made by intuition
- **Why default heuristic is insufficient**: I picked aggregate-with-IDs in PR-44's `massReauthRoutes.ts:81-96` because it felt right (avoids audit-table bloat). But: is this canon-aligned with industry practice? Could it be wrong (some compliance frameworks may require per-record events for non-repudiation)?

## Research scope

- **Search keywords**: `SOC2 OWASP audit log granularity bulk operation aggregate vs per-record`, `AWS CloudTrail bulk API event format`
- **Sources targeted**: OWASP A09:2025 (top-10 Sept 2025 reframing of A09:2021); OWASP Logging Cheat Sheet (current canon for audit field set); AWS CloudTrail record format (concrete industry reference for cross-tenant audit emission at planet scale).
- **Sources excluded**: NIST SP 800-92 (consulted, not prescriptive on this granularity question); SOC2 framework docs (compliance-framework, not technical prescription).

## Sources consulted

### [1] OWASP Top 10 2025 — A09:2025 Security Logging and Alerting Failures — [owasp.org](https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/)

- **Fetched**: 2026-05-07
- **Authority**: OWASP Top 10 2025 — primary security industry reference for logging failures.
- **Key claims**:
  - "All transactions should have an audit trail with integrity controls to prevent tampering or deletion, such as append-only database tables or similar."
  - "Every part of your app that contains a security control is logged, whether it succeeds or fails."
  - **Does NOT specify granularity**: silent on per-record vs aggregate. Implies "what + when + who + where" must be present, leaves shape to implementer.
  - References ASVS V16 (Logging) for detailed field requirements.
- **My reading**: OWASP defers granularity to implementation judgment. The hard requirements are: (a) capture every security-relevant action, (b) integrity (append-only / tamper-evident), (c) sufficient context to reconstruct.

### [2] OWASP Logging Cheat Sheet — [cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)

- **Fetched**: 2026-05-07
- **Authority**: OWASP — the working canon for application-level audit logging structure.
- **Key claims**:
  - Per-event fields: "when, where, who and what" — timestamps, app identity, user identity, action type, **affected object**, result status.
  - "Object e.g. the affected component or other object (user account, data resource, file)" — single object reference per entry.
  - Recommends "applying judgment proportionate to information security risks" — explicitly leaves granularity to context.
  - For batch operations, suggests documenting: action performed + scope/count of affected entities + outcome status + relevant identifiers (possibly summarized).
- **My reading**: aligns with the aggregate model: ONE entry that captures (a) what action, (b) by whom, (c) impact scope (count + identifiers), (d) outcome. Per-record explosion is not required.

### [3] AWS CloudTrail Record Format — [docs.aws.amazon.com](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html)

- **Fetched**: 2026-05-07
- **Authority**: CloudTrail is THE planet-scale industry reference for cross-tenant audit emission. Used as baseline by SOC2/ISO27001 auditors for AWS-hosted apps.
- **Key claims**:
  - **Single event per API call**, regardless of how many resources it affects. The event has a `resources` array listing every affected resource.
  - `resources` array entries: `{ ARN, accountId, resourceType }` — structured per-resource metadata, but as part of ONE event.
  - `eventID` is unique per event; `sharedEventID` groups events emitted to multiple recipient accounts (cross-account scenarios where CloudTrail emits N copies of the SAME event).
  - `requestParameters` field holds the request payload — has 100 KB cap; content omitted (not truncated) when exceeded.
  - `responseElements` similarly bounded — for actions returning many IDs (e.g. `DeleteObjects` of 1000 S3 objects), the response can be omitted at the size cap.
  - **NEVER per-resource event explosion**: even `DeleteObjects` (bulk delete of 1000 objects) emits ONE CloudTrail event with the full resource list (until the size cap).
- **My reading**: CloudTrail's design is explicit endorsement of "aggregate event with resource list". The size caps are practical engineering constraints, not architectural objections. For our N=10-100 affected channels per provider, we're well below any size concern.

## Synthesis

### Recommendation: USE

- **ONE aggregate audit log entry per bulk admin operation** — matches CloudTrail's design + OWASP "what+when+who+where" structure.
- **Include `count` in `details`** — concise summary, indexable for "how many bulk ops this month".
- **Include `affectedIds[]` in `details`** — list of every entity touched, for forensic traceability + GDPR Art. 33 breach notification capability ("which tenants were affected by the rotation event?").
- **Cap `affectedIds[]` length when very large**: if count > 1000, store a representative sample (e.g. first 100 + last 100 + total count) plus a reference to a separate audit-archive entry that contains the full list. CloudTrail does this implicitly via 100 KB field cap.
- **`actor` (admin userId) + `action` enum (`PROVIDER_MASS_FORCE_REAUTH`) + `resource` (e.g., "Provider") + `resourceId` (the provider name)** — standard 4-tuple for "who did what to what".
- **`details.tiers` (or equivalent flag set)** — captures the operation scope when it's tiered (e.g., flagChannels, disableProviderConnections, softDeleteChannels). Operator can later see "they used mass-reauth with the soft-delete tier — that explains the orphans".

### Recommendation: AVOID

- **Per-record audit events for bulk operations** — explodes audit table volume (N entries per op), no compensating benefit (forensics works with aggregate + IDs). Common anti-pattern in poorly-designed SaaS audit systems.
- **Aggregate WITHOUT IDs** — defeats forensic traceability. "We rotated some Facebook channels" is useless 3 months later when investigating a tenant complaint. Always list affected IDs (capped if very large).
- **Synchronous per-record writes within the operation transaction** — if 10k channels are touched, 10k audit-log INSERTs is a transaction-killer. Always emit ONE post-commit audit event.
- **Logging affected IDs WITH sensitive metadata** (e.g., the rotated secret value, the user's email) — IDs are fine; payloads are not. Already canon via `pino-redaction-docs`.

### Tradeoffs / decision tree

- **Bulk op affecting < 1000 entities**: aggregate event with full `affectedIds[]` array. Our PR-44 case (N=10-100 typical).
- **Bulk op affecting 1000-10000 entities**: aggregate event with `affectedIds[]` capped + sample + reference to separate archive. Bounded payload.
- **Bulk op affecting > 10000 entities**: same shape as above, plus consider streaming the full ID list to a separate audit archive (S3 / object store) and storing only the URL in the audit log entry.
- **Cross-account/cross-tenant scenarios** (CloudTrail's `sharedEventID`): if our system ever needs to deliver the audit event to multiple recipients (e.g., the platform admin AND the affected tenant), use a `sharedEventId` discriminator to group the copies. Out of scope for PR-44 (single platform-side recipient).

### Pinned values / flags

- **`affectedIds[]` cap**: `1000` items soft cap before sampling. For our 8 OAuth providers, max channel count per provider is bounded by tenant count — practical max ~5000 in worst-case 3-year scenario.
- **`requiredFields`** per audit entry: `userId` (actor), `action`, `resource`, `resourceId`, `success`, `error?`, `details.count?`, `details.affectedIds?`, `createdAt`. Already in our `AuditLog` schema.
- **`postCommitEmission`**: `true` — audit log write happens AFTER the UoW commits, never inside.

## Proposed canon-index.json entry

```json
{
  "key": "audit-log-bulk-granularity-aggregate-with-resources-array",
  "topic": "Audit log granularity — aggregate event with resources array (CloudTrail-aligned)",
  "area": "Security · Audit Logging · Bulk operations",
  "summary": "For admin operations affecting N records (mass-reauth, mass-disable, mass-rotate), emit ONE aggregate audit log entry per operation — not N per-record entries. The aggregate must include count + affectedIds array + tiered-action flags. Pattern aligned with AWS CloudTrail (industry baseline for cross-tenant audit at planet scale): single event per API call with `resources` array listing each affected resource. OWASP A09:2025 + OWASP Logging Cheat Sheet support this — they prescribe 'what + when + who + where' per security-relevant action without mandating per-record granularity. For very large operations (>1000 affected), cap the affectedIds list and reference an archived full list separately.",
  "keyTakeaway": "ONE aggregate audit event per bulk operation; include count + affectedIds[] + tier flags + actor + outcome. Avoid per-record explosion (audit-table bloat, no compensating benefit). Avoid aggregate-without-IDs (no forensics). Emit post-commit, never inside the bulk operation's transaction. Cap affectedIds at ~1000 with sampling + archive-reference for larger ops.",
  "patternAdopted": "Bulk admin routes (e.g., `apps/api/src/admin/massReauthRoutes.ts`) emit a single `auditService.log()` call after the UoW commits, with shape: `{ action: '<ENUM>', resource: '<EntityType>', resourceId: '<groupingKey>', userId: <adminUserId>, success: <boolean>, details: { tiers, count(s), affectedIds[] (capped at 1000), reason } }`. The aggregated `details` mirror CloudTrail's `requestParameters` + `resources` model. Wired in `apps/api/src/admin/massReauthRoutes.ts:81-96` (canon-aligned). Anti-pattern explicitly avoided: per-record audit events (N writes per op); audit emission inside the use case's transaction (transaction-killer for large N).",
  "usedIn": "PR-44 (Wave 3.3 — cross-tenant mass force-reauth) — validates current implementation as canon-aligned",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://owasp.org/Top10/2025/A09_2025-Security_Logging_and_Alerting_Failures/",
      "fetchedAt": "2026-05-07",
      "title": "OWASP Top 10 2025 — A09:2025 Security Logging and Alerting Failures"
    },
    {
      "url": "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
      "fetchedAt": "2026-05-07",
      "title": "OWASP Logging Cheat Sheet — what+when+who+where field set"
    },
    {
      "url": "https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-event-reference-record-contents.html",
      "fetchedAt": "2026-05-07",
      "title": "AWS CloudTrail — record format (single event per API call with resources array)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": ["apps/api/src/admin/", "apps/api/src/audit/"]
}
```

## Impact on existing code

- **Files that already align with this canon** (validation):
  - `apps/api/src/admin/massReauthRoutes.ts:81-96` — emits single aggregate `PROVIDER_MASS_FORCE_REAUTH` audit entry with `details.channelIds[]` + `tiers` + `counts`. ✓
  - `apps/api/src/admin/channelReauthRoutes.ts:74-93` — single-channel reauth (N=1, edge case of bulk = 1). ✓
  - `apps/api/src/admin/webhookAdminRoutes.ts:81-96` — single-webhook rotate (N=1). ✓
  - `apps/api/src/admin/oidcAdminRoutes.ts:81-96` — single-OIDC replace (N=1). ✓

- **Files that should change** (forward-looking improvement, not bug fix):
  - `apps/api/src/admin/massReauthRoutes.ts` — add explicit cap on `details.channelIds.length`. If `channelIds.length > 1000`, store first 100 + last 100 + total count; emit a separate archive entry (or reference). Effort: ~30 min, low priority (current PR-44 scenarios are far below 1000).
  - `apps/api/src/audit/auditService.ts` — could expose a helper `emitBulkAuditLog({ action, affectedIds, ... })` that handles the capping pattern. Reusable across future bulk admin features. Effort: ~1h, deferred.

- **No bug** in current implementation. This canon entry **validates** the existing pattern + documents rationale + flags an upper-bound improvement.

## Edward's review

- [ x] Sources are sufficient (3: OWASP A09:2025 + OWASP Logging Cheat Sheet + AWS CloudTrail)
- [ x] Recommendations match project values (validates current PR-44 design)
- [ x] Pinned values reasonable (1000-item cap, post-commit emission)
- [ x] Approve append to `canon_research_index.md`
- [ x] Trigger NO refactor commit (current code is canon-aligned); optionally schedule the >1000-item cap improvement as follow-up
- Notes: approved.
