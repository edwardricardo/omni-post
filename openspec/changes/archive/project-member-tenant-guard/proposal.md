# Proposal: ProjectMember Tenant Guard (Slice 5)

## Intent

Slice 5 of the `project-scoped-tenant-guard` rollout. `ProjectMember` (`schema.prisma:369-381`) is `projectId`-only and enrolled in NEITHER isolation layer (absent from `TENANT_SCOPED_MODELS` — 56 models — and from RLS).

**Settled decision (do not re-litigate):** `ProjectMember` is a **FORGOTTEN-FEATURE, not dead code** (engram `domain/project-membership-model`, obs 321; `domain/client-personnel-gaps`, obs 322). Edward confirmed the intended product structure — ABC Marketing: 1 account → N projects → members assigned per-project with roles — and `ProjectMember` is the ONLY model linking a user to specific projects. Account-level RBAC (`CustomerRole`) covers the ROLE axis; per-project MEMBERSHIP lives only here. The capability is designed but UNWIRED. Therefore: **KEEP the model and ENROLL it defensively now (Approach A, same recipe as Slices 0-4)** so it is born tenant-safe when the feature is wired. This slice does NOT delete the model and does NOT build the feature.

## Verified surface facts (source-checked; unchanged from audit)

| Fact                                                                                                                               | Evidence                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Model shape: `projectId` NOT NULL + `memberId` FK, both Cascade, `@@unique([projectId, memberId])`, no `accountId`, no soft-delete | `schema.prisma:369-381`                                                                         |
| Single production reader is DEAD: `findByProjectId` implemented but zero prod callers                                              | `PrismaCustomerUserRepository.ts:118-128`; port `CustomerUserRepository.ts:48`                  |
| Zero HTTP routes read or write `ProjectMember`; no authz path touches it                                                           | `teamRoutes.ts` manages account-level `CustomerUser` only                                       |
| No production writes — only dev seed + one-off historical script                                                                   | `infra/prisma/seed.ts:1109` (upsert); `scripts/migrate-team-member-to-customer-user.ts:197,411` |
| No domain entity/DTO exists — zero port/adapter threading beyond the dead reader                                                   | repo-wide grep                                                                                  |
| Double parent: BOTH `Project` (via `projectId`) and `CustomerUser` (via `memberId`) carry `accountId`                              | `schema.prisma:613,348`                                                                         |
| No out-of-tenant-context callers (workers/sagas/schedulers) → NO `withSystemContext()` wraps                                       | inventory empty                                                                                 |

## Scope

### In Scope

- **Schema**: `accountId` nullable ADD → backfill from `Project.accountId` over the `projectId` FK → RAISE-on-NULL assert → `SET NOT NULL` → `Account` relation (`onDelete: Cascade`) + `@@index([accountId, projectId])`.
- **Double-parent backfill invariant (SETTLED: RAISE, not silent-skip)**: the backfill derives `accountId` from `Project.accountId` AND asserts `Project.accountId == CustomerUser.accountId` for every row. Any mismatch = corrupt cross-tenant membership → the migration HALTS (RAISE). Impossible for seeded data; a real hit is corruption that must surface.
- **Guard flip**: append `projectMember` to `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts`; 56 → 57; update the header count).
- **Forward RLS migration pair** (+down.sql), copying the shape of `20260527000000` (never edited in place), timestamps after the Slice-4 latest, column-before-RLS.
- **Defensive threading**: `accountId` awareness on the dead reader `findByProjectId` (`PrismaCustomerUserRepository.ts:118`) — zero prod callers today, so this is purely defensive for future wiring.
- **Seed fix**: explicit `accountId: account.id` on the `projectMember` upsert create branch (`seed.ts:1109`).
- **Integration proof at the repository/guarded-client level** (no HTTP surface exists): two-tenant real-DB suite — A-context `findByProjectId(B's projectId)` → no cross-tenant member rows; no-context query → `TenantContextMissingError`; A-context create auto-injects `accountId == Project.accountId == CustomerUser.accountId`. Guard unit tests for `projectMember`.
- **Docs**: `MULTI_TENANT_GUARDS.md` enrollment (3-step canon checklist).

### Out of Scope (already tracked — reference, don't do)

- **Feature wiring** — enforce `maxTeamMembers`, wire assign/remove to/from projects, fix remove-semantics (`isActive` vs `deletedAt`) + dangling memberships → **backlog SMELL-59** (`docs/reports/roadmap-detected-smells-backlog.md:83`). Product epic "client personnel management", Edward's call.
- **GET /team roster IDOR verification** — on-mission, being verified in parallel; NOT part of this slice.
- Deleting the model or the dead port method (decision closed: KEEP).
- Remaining rollout models (Channel, Post); N-SEC-4.

Note: the Feature Matrix already carries the row "Miembros por proyecto con roles granulares" (`docs/product/FEATURE_TRACE_MATRIX_ES.md:112`, 🟡 PARCIAL) — the product-side paper trail exists.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `multi-tenant-isolation`: append `ProjectMember` row to Requirement 1 (enrolled models); add one model-scoped Requirement-2 block (forgotten-feature enrolled defensively; no HTTP surface — proof at the guarded-client layer; double-parent `accountId` consistency invariant); Requirement 3 gets an explicit **N/A — no production create path** note (seed is the only writer, out of tenant context by design; ownership assertion becomes mandatory when SMELL-59 wires writes).

## Approach

Approach-A recipe (Slices 0-4) minus everything that doesn't apply: no use-case changes, no route changes, no wraps, near-zero threading. Two deltas specific to this slice: (1) the double-parent RAISE assertion in the backfill — first model with TWO accountId-bearing parents; (2) the MERGE-BLOCKING integration proof runs at the repository/guarded-client level because the route surface is empty — the living spec's all-routes HTTP rule is vacuously satisfied, and the Requirement-2 block pins that fact so any future route triggers a spec update.

## Affected Areas

| Area                                                                       | Impact   | Description                                                        |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| `infra/prisma/schema.prisma` + 2 migrations (+down.sql)                    | Mod/New  | accountId column + backfill + double-parent RAISE; RLS — SENSITIVE |
| `infra/prisma/src/extensions/tenantGuard.ts`                               | Modified | append `projectMember`; header count 56 → 57 — SENSITIVE           |
| `infra/prisma/seed.ts`                                                     | Modified | explicit `accountId` on the upsert create branch                   |
| `apps/api/src/infrastructure/repositories/PrismaCustomerUserRepository.ts` | Modified | defensive threading on dead `findByProjectId`                      |
| `apps/api/tests/{unit,integration}/**`                                     | New      | guard unit + guarded-client two-tenant suite                       |
| `docs/security/MULTI_TENANT_GUARDS.md`                                     | Modified | enrollment docs                                                    |

## Risks (overall: LOW — smallest slice)

| Risk                                                        | Likelihood         | Mitigation                                                                                     |
| ----------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| Seed breaks on NOT NULL flip                                | Certain if unfixed | Seed fix in scope, same PR                                                                     |
| Historical row with cross-account membership halts backfill | Low                | RAISE surfaces real corruption (correct behavior); pre-check query documented in the migration |
| Dead reader wired later without review                      | Low                | Guard makes it safe by construction; spec block + SMELL-59 are the paper trail                 |
| Migration timestamp collision with the stacked chain        | Low                | Timestamps strictly after Slice-4's latest                                                     |

Fitness interactions: #23 (backfill SQL lives in migration files — exempt path), #21 (no new singleton imports), #8/#9/#10 (clean headers on new test files).

## Rollback

Revert branch (no merge until green). Post-merge: down.sql drops the RLS policy; remove `projectMember` from `TENANT_SCOPED_MODELS`; `accountId` column is additive and removable by a later down migration. No data loss.

## Dependencies

- Stacked branch `workstream/cluster-c-projectmember-guard` off `69dd4cf2` (pnpm 11 + Slices 0-4; guard = 56).
- `omnipost-allow sensitive-edit` token at APPLY (`infra/prisma/**`); `pnpm db:up` for migration + integration tests.
- Delivery: **single atomic PR** (migration + flip + seed + tests are one deploy unit). Expected UNDER the 400-line budget (smallest slice); `size:exception` only if the suite pushes it over.

## Success Criteria

- [ ] Three legs present (static): schema `accountId` NOT NULL + relation + `@@index([accountId, projectId])`; `projectMember` in guard set; RLS policy.
- [ ] Guarded-client two-tenant suite green: foreign-project member list → empty; no-context → `TenantContextMissingError`; own create → `accountId == Project.accountId == CustomerUser.accountId`.
- [ ] Zero NULL `accountId` post-backfill; row counts preserved; zero double-parent mismatches (or RAISE with documented remediation).
- [ ] Seed runs green end-to-end after the flip.
- [ ] 0-defect gate (tsc, eslint --max-warnings 0, fitness #21/#23, LXC-safe regression).

## Resolved questions (previously open — now settled)

1. **Dead-code disposition** → SETTLED: forgotten-feature, KEEP + enroll (obs 321/322); feature wiring = SMELL-59.
2. **Backfill mismatch policy** → SETTLED: RAISE-and-halt (mismatch = corrupt cross-tenant membership).
3. **Proof layer** → SETTLED: repository/guarded-client two-tenant suite is the MERGE-BLOCKING proof (route surface = 0; Requirement-2 block pins "no HTTP surface").
