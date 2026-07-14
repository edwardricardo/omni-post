# Proposal: External Notification Tenant Guard (Slice 1 of project-scoped-tenant-guard)

## Intent

`ExternalNotificationConfig` is `projectId`-only and enrolled in NEITHER tenant-isolation layer (absent from `TENANT_SCOPED_MODELS`, absent from RLS migration `20260527000000`) — verified at source. It is credential-bearing: `webhookUrl` is an AES-GCM envelope carrying Slack/Teams bearer tokens, decrypted on EVERY read (`toData()`). Three authenticated routes have live cross-tenant IDOR (CWE-639): `GET /external-notifications?projectId=` (reads B's decrypted secrets), `DELETE /:id` (cross-tenant delete), `POST /:id/test` (reads AND fires B's webhook — active exfiltration). Additionally — missed by the classification — `POST /external-notifications` accepts a foreign `projectId` with no ownership check (cross-tenant write). This slice is the REFERENCE IMPLEMENTATION for Slices 2–8.

## Scope

### In Scope

- Schema migration: `accountId` nullable → backfill from `Project.accountId` via `projectId` FK (NOT NULL → orphan-free) → `SET NOT NULL` + `Account` relation (`onDelete: Cascade`, matching sibling models) + `@@index([accountId])`.
- Append `externalNotificationConfig` to `TENANT_SCOPED_MODELS` (guard flip).
- NEW forward RLS migration enrolling `ExternalNotificationConfig` (never edit `20260527000000`).
- Create-path fix: validate `projectId` ownership in `ConfigureExternalNotificationUseCase` (guard cannot check parent-child consistency; `project` model IS guarded, so a scoped lookup suffices).
- Update `MULTI_TENANT_GUARDS.md` (canon 3-step checklist) + stale "50 models"/"51 tables" doc counts.
- Tests: guard-injection unit tests; two-tenant real-DB integration (A cannot list/delete/test-fire B's config; create with B's projectId rejected).
- Document the recipe deltas later slices must adapt (soft-delete backfill, `withSystemContext` wraps, worker BYPASSRLS, parent-ownership validation on create paths).

### Out of Scope

- The other 8 models (own slices), N-SEC-4, wiring `broadcast()` (verified unwired: `ExternalNotifierPort` resolved only by `TestExternalNotificationUseCase`), `apps/workers` (zero references, verified).

## Capabilities

### New Capabilities

- `multi-tenant-isolation`: enrollment of tenant-scoped models in the two-layer guard (Prisma `$extends` + RLS); this change specifies the `ExternalNotificationConfig` requirements. Slices 2–8 will extend it.

### Modified Capabilities

- None.

## Approach

By-construction isolation over per-route checks (OWASP: centralized data-layer control). Verified enablers: all 4 routes run behind `requireClientAuth` → `enterTenantContext`; guard injects `accountId` into `where` AND `upsert.create`; DI `TOKENS.PrismaClient` IS the guarded client; zero out-of-context callers (workers/seeds/scripts/sagas: none) → no `withSystemContext` wraps needed.

## Affected Areas

| Area                                                                               | Impact       | Description                                        |
| ---------------------------------------------------------------------------------- | ------------ | -------------------------------------------------- |
| `infra/prisma/schema.prisma` + 2 migrations                                        | Modified/New | accountId column, backfill, RLS policy (SENSITIVE) |
| `infra/prisma/src/extensions/tenantGuard.ts`                                       | Modified     | model list append (SENSITIVE)                      |
| `packages/core/external-notifications/src/ConfigureExternalNotificationUseCase.ts` | Modified     | project-ownership validation                       |
| `apps/api/tests/{unit,integration}`                                                | New          | guard unit + two-tenant integration tests          |
| `docs/security/MULTI_TENANT_GUARDS.md`                                             | Modified     | model enrollment docs                              |

## Risks

| Risk                                                                      | Likelihood | Mitigation                                                                       |
| ------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| NOT NULL flip before new code boots → create fails                        | Low        | migration + guard flip + code in SAME PR/deploy (single deployable, dev stage)   |
| Backfill misses rows                                                      | Low        | `projectId` NOT NULL + FK → orphan-free; assert zero NULLs before `SET NOT NULL` |
| Create-path fix omitted → inconsistent rows (accountId≠Project.accountId) | Med        | in scope; integration test covers it                                             |
| `findUnique` + injected accountId rejected                                | Low        | extendedWhereUnique proven by 50 enrolled models                                 |

## Rollback Plan

Revert the guard-list/code commit (enforcement off, column stays — additive/harmless); drop RLS policy via down.sql pattern; column removable by a later down migration if needed.

## Dependencies

- `omnipost-allow sensitive-edit` token at APPLY time (`infra/prisma/**`).
- `pnpm db:up` before migration + integration tests.
- Fitness interactions: no new raw queries (#23 unchanged); new files carry `@file`/`@layer` (#9, #10); no phase refs in comments (#8).

## Success Criteria

- [ ] Two-tenant integration proves A cannot list/delete/test-fire B's config, and create with B's `projectId` is rejected.
- [ ] Guard unit tests cover inject/validate/missing-context for `externalNotificationConfig`.
- [ ] Lint/tsc/fitness all 0-defect; recipe deltas documented for Slices 2–8.
