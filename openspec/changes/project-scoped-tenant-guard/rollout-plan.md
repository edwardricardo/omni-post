# project-scoped-tenant-guard — Sequential Rollout Plan

> Classification of the 9 projectId-only models by **importance × complexity**, driving a
> sequential per-slice rollout (Edward's directive: classify, then execute sequentially; each
> slice is its own full-SDD change). Produced by the classification workflow; every claim
> verified at source. **7 of the 9 models carry a LIVE cross-tenant IDOR today.**

## Ranked table

The organizing axis is **`callersOutsideTenantContext`** — that count, not importance, is what
determines whether flipping a model into `TENANT_SCOPED_MODELS` breaks production at runtime
(each unbound caller throws `TenantContextMissingError` once the guard is on).

| #   | Model                          | Importance                   | Complexity | Out-of-ctx callers           | IDOR                                                                       | Tier |
| --- | ------------------------------ | ---------------------------- | ---------- | ---------------------------- | -------------------------------------------------------------------------- | ---- |
| 1   | **ExternalNotificationConfig** | HIGH (credential)            | LOW        | 0                            | LIVE (decrypted webhook secrets read/delete/test-fire)                     | 1    |
| 2   | **ScheduledReport**            | HIGH                         | LOW        | 0                            | LIVE (read/update/delete/generate → analytics exfil via recipient rewrite) | 1    |
| 3   | **Campaign**                   | HIGH                         | LOW        | 0                            | LIVE (read + write)                                                        | 1    |
| 4   | **TrackedLink**                | HIGH                         | LOW        | 1 (public `/r/:shortCode`)   | LIVE write (read/delete already adapter-join mitigated) + visitor PII      | 1    |
| 5   | **RecurringPost**              | MEDIUM                       | LOW        | 1 (RecurrenceScheduler tick) | LIVE (read/mutate/deactivate)                                              | 1    |
| 6   | **GeneratedImage**             | MEDIUM                       | LOW        | 0                            | LIVE (non-credential, non-PII)                                             | 2    |
| 7   | **ProjectMember**              | LOW                          | LOW        | 0 runtime                    | LATENT (dead reader)                                                       | 3    |
| 8   | **Channel**                    | HIGH (credential, max blast) | HIGH       | ~13 grouped                  | MITIGATED (app-layer, fragile: decrypt-before-authz)                       | 4    |
| 9   | **Post**                       | HIGH                         | HIGH       | ~16 grouped                  | LIVE (`DELETE /posts/:id`, no callerAccountId gate)                        | 4    |

## Slice order

- **Slice 0 — immediate app-level IDOR hotfix (decoupled).** Close `DELETE /posts/:id`'s LIVE
  cross-tenant delete now with a `callerAccountId` gate (mirroring the existing
  Update/Archive/HardDelete/Duplicate routes — delete is the lone gap). Post's structural guard
  migration is Tier-4 (far out); this closes the one LIVE hole that no near-term structural slice
  covers. By-convention, superseded by Slice 8.
- **Slice 1 — ExternalNotificationConfig (alone).** The reference implementation: credential-bearing,
  zero-wrap, exercises the full recipe (schema migration + backfill + `TENANT_SCOPED_MODELS` + RLS
  table array + create-path auto-injection). No caller fixes.
- **Slice 2 — ScheduledReport + Campaign.** Pure denorm, zero wrap, mechanically identical to Slice 1.
- **Slice 3 — RecurringPost + TrackedLink.** Establishes the `withSystemContext` pattern (RecurrenceScheduler
  sweep; public `/r/:shortCode` redirect). Folds in TrackedLink's write-IDOR fix (explicit
  `Project.accountId == context.accountId` in `CreateTrackedLinkUseCase`) + makes the manual adapter-join
  vestigial.
- **Slice 4 — GeneratedImage.** Lowest-hazard, trivial.
- **Slice 5 — ProjectMember.** Near-mechanical denorm + one `seed.ts` edit.
- **Slice 6 — PREREQUISITE audit deliverable** (gates 7–8): the out-of-context caller audit (below).
- **Slice 7 — Channel.** Reconcile guarded `PrismaChannelRepository` (API) vs UNGUARDED
  `createChannelRepository` (workers); explicit `accountId` on the context-less OAuth-callback create;
  resolve the BYPASSRLS/worker-role question; backfill INCLUDING soft-deleted rows.
- **Slice 8 — Post.** Add `accountId` column (none today); backfill incl. soft-deleted; fix 3 context-less
  create paths (recurrence clone, approve-variant, saga resume); wrap ~16 context-less readers.

## Cross-cutting prerequisite — out-of-context caller audit (gates Channel + Post)

Codebase has only **2** `withSystemContext`/`enterTenantContext` wrappers total today. Four hazard classes:

- **Class A — inherently cross-tenant system flows → `withSystemContext`:** dispatch coordinators
  (`findActiveChannels`), `MassForceReauthByProviderUseCase`, admin dashboards, `accountRoutes` cascade
  delete, saga command-executor + RereadCheck (recovery-scheduler / Redis `saga:events` resume),
  RecurrenceScheduler tick, public link redirect.
- **Class B — per-tenant flows resolving identity from an external key (resolve-then-enter):** 8 Channel
  webhook processors (by `providerAccountId`), the in-process analytics/inbox consumers, bulk-schedule
  worker; Post webhook processors, integration routes (`zapierRoutes`/`makeRoutes`, API-key auth).
- **Class C — context-less CREATE paths → populate `accountId` explicitly:** Channel OAuth-callback create;
  Post recurrence clone, approve-variant, saga create-draft (mapper omits `accountId`).
- **Class D — the guarded/unguarded adapter + RLS trap (sharpest):** `apps/workers` uses the UNGUARDED
  `workerPrisma` (no `$extends`) → the guard won't throw there, BUT if Channel/Post are added to RLS and the
  app DB role is not `BYPASSRLS`, worker reads (publish credential resolution, mention ingest) get
  row-filtered to ZERO with no `app.account_id` GUC → **silent publish breakage**. Resolve BYPASSRLS/role
  and reconcile both adapters BEFORE adding Channel/Post to RLS.

**Zero-hazard models (no audit dimension):** ExternalNotificationConfig, ScheduledReport, Campaign,
GeneratedImage — all `callersOutsideTenantContext = []`; this is why they front-load.

## Per-slice recipe (Approach A, by construction)

Each model slice: (1) `ADD COLUMN accountId` nullable → backfill `SET accountId = Project.accountId` over the
`projectId` FK (orphan-free; **include soft-deleted rows** where the model has `deletedAt`) → `SET NOT NULL` +
`@@index([accountId])`; (2) append lowerCamel name to `TENANT_SCOPED_MODELS`
(`infra/prisma/src/extensions/tenantGuard.ts`); (3) append PascalCase name to a **new forward RLS migration**
(never edit `20260527000000` in place); (4) any `callersOutsideTenantContext` wrapped in `withSystemContext`
BEFORE the flip; (5) tests: guard-injection unit + two-tenant real-DB integration proving the IDOR is closed.

> Operational: schema migrations live under `infra/prisma/**` and `tenantGuard.ts` under
> `infra/prisma/src/**` — **SENSITIVE paths** requiring `omnipost-allow sensitive-edit` at apply time.
> Each slice is its own change on its own branch off main (like trackedlink-idor-fix), full 8-phase SDD.
