# Proposal: Channel Tenant Guard (Slice 7)

## Intent

Slice 7 of the `project-scoped-tenant-guard` rollout (Tier 4 / HIGH, max blast). `Channel` (`schema.prisma:766-830`) carries the **encrypted provider OAuth credentials** (4 ciphertext columns) and is enrolled in NEITHER isolation layer — absent from `TENANT_SCOPED_MODELS` (57 models) and from RLS. The rollout plan rates its exposure "MITIGATED app-layer, fragile: decrypt-before-authz": `CredentialResolver.resolve(channelId)` decrypts provider tokens on the worker's RAW client with zero tenant scoping. This slice closes the Channel cross-tenant IDOR (OWASP API1:2023) **structurally** via Approach A — denormalized `accountId` + `$extends` guard + RLS — plus the four extensions the exploration proved this slice needs beyond the mechanical recipe.

## Verified surface facts (condensed from exploration; source-checked at main a0f3595c)

| Fact                                                                                                                                                          | Evidence                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| API side runs on the GUARDED `$extends` client: main repo + 7 query adapters + cascades + 4 direct-prisma route reads + providerService                       | `PrismaChannelRepository.ts` et al. (exploration §2)                          |
| Workers run on the RAW `workerPrisma` (no `$extends`, no GUC, zero `withSystemContext`): credential resolution, auth-failure recorder, mention channel lookup | `workerContainer.ts:16`; `CredentialResolver.ts`; `ChannelRepository.ts:46`   |
| OAuth callback persists a client-supplied `projectId` from OAuth state with NO ownership check; Bluesky connect HAS the gate but its create lacks `accountId` | obs 273; `providerOAuthFlow.ts:129,199,220`; `channelRoutes.ts:443,461,472`   |
| Child tables keyed by `channelId` (PublishLog, Analytics, Daily/MonthlySummary) are NOT tenant-scoped — the Channel guard does not protect their reads        | obs 285; `PrismaAnalyticsReadRepository.ts:294`, `analyticsRoutes.ts:576,725` |
| 8 webhook processors resolve Channel by `providerAccountId` under `withSystemContext` (A7 seam) — inherent to inbound webhooks                                | `webhookJobProcessor.ts:157+`                                                 |
| Worker already reads RLS-protected Mention via the raw client with no GUC and works → the local connection effectively bypasses RLS; prod role UNVERIFIED     | `20260527000000` header; `mentionIngestWorker.ts:137`                         |
| Seeds/scripts/test factories create Channel without `accountId` → break on NOT NULL                                                                           | `seed.ts:104,1153`; `seed-large-dataset.ts`; testDataFactory + 8 suites       |

## Scope

### In Scope

- **Canonical recipe**: Migration A (`accountId` nullable ADD → backfill from `Project.accountId` over the NOT-NULL `projectId` FK, soft-deleted rows included → in-tx RAISE-on-NULL → `SET NOT NULL` → `Account` FK `onDelete: Cascade` → `@@index([accountId, projectId])`); Migration B RLS pair (+down.sql) copying the `20260527000000` shape; A.timestamp < B.timestamp, both after Slice-5 tip `20260716000100`; guard flip `channel` (57 → 58, header count bumped); D2 threading (`Channel` entity + `ChannelData` + adapter `upsert.create` — never `update`); seeds/scripts/test factories thread `accountId`; `run-tests.sh` tenant-isolation batch entry; `MULTI_TENANT_GUARDS.md` enrollment.
- **Extension (a) — worker DB-role/BYPASSRLS question**: resolved EMPIRICALLY in design, BEFORE the RLS flip. Load-bearing gate for everything below.
- **Extension (b) — create-path ownership (obs 273)**: bind `withTenantContext({accountId: record.accountId})` around the OAuth callback body (the A8 trigger, anticipated at `providerOAuthFlow.ts:121`) + thread `accountId` into its create; Bluesky connect threads `accountId` from the already-gated project. Foreign parent → 404 NOT_FOUND surviving use-case catch and route status map (D3/D3a).
- **Extension (c) — worker-side reconciliation**: `CredentialResolver`/`getChannelsByIds`, `ChannelAuthFailureRecorder`, `mentionIngestWorker` channel lookup made tenant-safe. Design chooses: (i) guarded client under a declared context binding the job's `accountId` GUC (requires `accountId` in the publish job payload), or (ii) explicit `accountId` scoping on the worker queries.
- **Extension (d) — child-table read confirmation**: verify PublishLog/Analytics/summaries read paths resolve `channelId` within tenant scope; document findings; gaps escalate, never silently dropped.
- **Tests**: guard unit membership 57 → 58; two-tenant real-DB integration proving the IDOR closed on every Channel route; publish-flow regression under the chosen worker design.

### Out of Scope

- **Post** enrollment (Slice 8, own change).
- **Enrolling the child tables themselves** (PublishLog/Analytics/summaries) — confirm-only here; enrollment is future work if gaps are found.
- **WEBHOOK-INGEST wiring** — the A7 seam stays as-is; processors keep resolving by provider identity under system context.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `multi-tenant-isolation`: enrolled-model row (Requirement 1); a Channel-scoped requirement block (route IDORs closed; credential-bearing: no decrypted secret crosses the tenant boundary, including the worker resolution path); create-path ownership requirement extended to Channel's two create paths; backfill integrity; no-caller-regression covering webhook processors, bulk-by-provider system ops, and cascades.
- `tenant-context-boundaries`: the "A8 OAuth callback is a verified no-op boundary" requirement is SUPERSEDED — the callback now reaches an enrolled model and MUST bind tenant context; worker seams (publish credential resolution, auth-failure recorder, mention channel lookup) must declare their context per the chosen design.

## Approach

Approach A (the slices 1-5 recipe) + the four extensions. **NOT mechanically identical to prior slices**: prior slices had 0 out-of-context callers; Channel has ~13 grouped, and the workers run on the raw client — so guard+RLS alone either breaks publish (NOBYPASSRLS role filters worker reads to zero rows) or stays inert for workers (BYPASSRLS leaves the credential IDOR open). The alternative "flip only, defer workers" was evaluated and REJECTED as unsafe. Design's load-bearing decision is the worker resolution shape ((i) vs (ii) above), pinned empirically against the real DB role BEFORE the flip. Note the trap: `withSystemContext` alone does NOT fix workers — it feeds the `$extends` guard via AsyncLocalStorage, but the raw client has no `$extends` and RLS needs the GUC bound in-tx.

## Affected Areas

| Area                                                                                                       | Impact   | Description                                                      |
| ---------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| `infra/prisma/schema.prisma` + 2 migrations (+down.sql)                                                    | Mod/New  | accountId column + backfill + FK + index; RLS policy — SENSITIVE |
| `infra/prisma/src/extensions/tenantGuard.ts`                                                               | Modified | append `channel`; header count 57 → 58 — SENSITIVE               |
| `apps/api/src/auth/providerOAuthFlow.ts`                                                                   | Modified | A8 `withTenantContext` binding + accountId threading             |
| `apps/api/src/infrastructure/routes/channelRoutes.ts`                                                      | Modified | Bluesky connect accountId threading (upsert create)              |
| Channel domain entity + `PrismaChannelRepository.ts`                                                       | Modified | D2: `accountId` on entity/`ChannelData` + `upsert.create`        |
| `apps/workers/src/services/CredentialResolver.ts` + `packages/adapters/db-prisma/src/ChannelRepository.ts` | Modified | tenant-safe credential resolution (design shape)                 |
| `apps/workers/src/services/ChannelAuthFailureRecorder.ts`, `apps/workers/src/mentionIngestWorker.ts`       | Modified | tenant-safe worker channel access                                |
| `infra/prisma/seed.ts`, `apps/api/scripts/seed-large-dataset.ts`, test factories/suites                    | Modified | thread `accountId` on every Channel create                       |
| `apps/api/scripts/run-tests.sh`                                                                            | Modified | add integration file to tenant-isolation batch                   |
| `apps/api/tests/{unit,integration}/**`, worker tests                                                       | New      | guard unit 57→58 + two-tenant suite + publish regression         |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                                     | Modified | enrollment docs, counts                                          |

## Risks (overall: HIGH — credential-bearing, max blast; condensed verbatim from exploration)

| Risk                                                                                                                                                                                                  | Likelihood               | Mitigation                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **TOP — worker role two-sided failure**: NOBYPASSRLS → worker channel reads filter to ZERO rows with no GUC → silent publish breakage; BYPASSRLS → RLS inert for workers → credential IDOR stays open | Certain (one side holds) | Extension (a): empirical pin in design BEFORE flip; extension (c) closes the IDOR regardless of role      |
| CredentialResolver decrypt-before-authz on the raw client — guard/RLS do not reach it                                                                                                                 | Present today            | Extension (c) worker reconciliation + publish regression suite                                            |
| OAuth callback persists state `projectId` with no ownership check (obs 273)                                                                                                                           | Present today            | Extension (b): A8 binding + threading; guard scopes the save; foreign → 404                               |
| Child tables not protected by the Channel guard — foreign `channelId` in analytics reads not blocked (obs 285)                                                                                        | Medium                   | Extension (d) confirm-only audit; gaps escalate to backlog                                                |
| Guard flip throws `TenantContextMissingError` on any unwrapped caller (webhook processors, bulk-by-provider ops, cascades)                                                                            | Medium                   | Exploration caller inventory is complete; system-context seams confirmed pre-flip; integration regression |
| Seeds/scripts/test factories break on NOT NULL                                                                                                                                                        | Certain if unfixed       | Threading in scope, same PR as the flip                                                                   |
| `withSystemContext`-alone design trap (AsyncLocalStorage ≠ raw client / GUC)                                                                                                                          | High if unpinned         | Explicitly named in design inputs; GUC `set_config` or guarded UoW required                               |
| Migration ordering/timestamp collision                                                                                                                                                                | Low                      | A < B, both after `20260716000100`                                                                        |

## Rollback

Revert branch pre-merge (no merge until green). Post-merge: down.sql drops the RLS policy; remove `channel` from `TENANT_SCOPED_MODELS`; `accountId` column is additive, removable by a later down migration. If delivered as chained PRs, PR2 (worker reconciliation) reverts independently of PR1 (structural). No data loss.

## Dependencies

- Branch `workstream/channel-tenant-guard` off main `a0f3595c` (guard = 57).
- Slice 6 out-of-context caller audit — consumed (obs 273, 285); rollout plan gates Channel behind it.
- `omnipost-allow sensitive-edit` token at APPLY (`infra/prisma/**`, `tenantGuard.ts`); `pnpm db:up` for migrations + integration tests.
- Delivery: forecast is **>400 lines** → anticipate **chained PRs** (PR1 = structural: schema + migrations + guard + API create-path threading + API tests; PR2 = worker reconciliation: guarded client / GUC binding + resolver scoping + worker tests). FINAL decision at the tasks phase via the Review Workload Guard.

## Success Criteria

- [ ] Three legs present (static): schema `accountId` NOT NULL + relation + `@@index([accountId, projectId])`; `channel` in guard set; RLS policy.
- [ ] Two-tenant integration suite proves the IDOR closed on **every Channel route**; guard unit membership 57 → 58 green.
- [ ] Publish flow remains green: credential resolution keeps working under the chosen worker design (the MERGE-BLOCKING regression).
- [ ] Both create paths reject a foreign `projectId` with 404 NOT_FOUND; own create auto-consistent (`accountId == Project.accountId`).
- [ ] Zero NULL `accountId` post-backfill (soft-deleted included); seeds/factories green after NOT NULL.
- [ ] Child-table read confirmation documented; any gap escalated, not dropped.
- [ ] 0-defect gate: lint 0/0, tsc 0, fitness green, CI green.

## Open questions (carried to design — the load-bearing decisions)

1. **Worker DB role**: BYPASSRLS or not, per environment — MUST be pinned empirically before the RLS flip (Migration B ships only after this answer).
2. **Worker resolution shape**: (i) guarded client + job-payload `accountId` + GUC binding vs (ii) explicit `accountId` scoping in `getChannelsByIds` — includes deploy compatibility for in-flight publish jobs that predate the payload change.
