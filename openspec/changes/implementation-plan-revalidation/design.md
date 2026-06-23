# Design: Implementation-Plan Re-validation (Track 2)

## Technical Approach

Two-phase, security-gated re-validation. **Phase A** confirms-then-fixes the §2
IDOR/auth/cache/write-path cluster (the precondition that gates Fase 1-2
client-portal items). **Phase B** walks all 67 plan items individually through a
dep-freshness gate + LXC-safe RE-VERIFY against merged-main, marking `[x]` only
when an item's own PR is green. No new product capability; this is verification

- targeted security remediation via canon paths only. Maps to proposal obs 175;
  spec (parallel) will decide per-fix delta specs once Phase A confirmation lands.

## Architecture Decisions

### Decision: Adversarial-Verify converts a §2 lead to a verdict before any fix

| Option                                                                                   | Tradeoff                                                            | Decision   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------- |
| Fix every §2 lead blind                                                                  | Patches refuted leads; wastes budget; risk of touching correct code | Rejected   |
| Re-read cited path + exercise exploit hypothesis → CONFIRM/refute with recorded evidence | One read per lead; refuted leads logged not-a-defect                | **Chosen** |

**Rationale**: §2 is `UNVERIFIED-prelim` (no Verify phase ran). Evidence already
found: `postRoutes.ts` threads `callerAccountId` (L312/390/427/464) + has
`requireClientAuth`, but `DeletePostUseCase.execute({postId})` has **no**
`callerAccountId` param and calls `findById/delete(postId)` with no owner gate —
`Post` is transitively-scoped (FK→Project), so `$extends` cannot auto-inject.
IDOR-POSTS is CONFIRMED real. The route _looks_ gated; the gate evaporates at the
use-case boundary. That gap is exactly what a single-pass finder misses and the
re-read catches. Confidence is elevated for IDOR/auth (known_smell + SMELL-31/32),
so confirmation is fast there; standalone WF2 items stay leads until re-read.

### Decision: Each cluster fixed via its canon path — never a workaround

| Cluster                                                                                      | Canon fix path                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §2A IDOR (transitively-scoped: posts/analytics/trackedLink/notifications/recurring/comments) | Add `callerAccountId` to use-case input + joined filter `where: { id, project: { accountId: requireTenantContext().accountId } }` (MULTI_TENANT_GUARDS §Transitively-scoped). RLS layer-2 already gates tx writes. |
| §2A IDOR (directly-scoped: accounts)                                                         | Owner check vs token `accountId`; the `$extends` guard already auto-injects — fix is removing the URL-param bypass + `maxProjects` quota tamper                                                                    |
| §2A root cause (ARCH-PROJECT-SCOPED-GUARD-GAP)                                               | Apply the joined-filter pattern uniformly; document each adapter (S2.1d method)                                                                                                                                    |
| §2B cache                                                                                    | `accountId` into cache key namespace via `CachePort` (`credentials:`/`branch:` prefix convention); never a per-class `Map` (fitness #14)                                                                           |
| §2C auth                                                                                     | Strip `role` from public `POST /auth/register` (mass-assignment); register `@fastify/rate-limit` so auth `rateLimit` config is live + non-spoofable key                                                            |
| §2F write-path                                                                               | Wire `OAuthTokenRefresher` into publish flow + double-refresh guard; dedup double-post (idempotency on provider-OK→log gap); set `needsReauth` on cred failure; fix saga `accountId`-persisted-as-`userId`         |

**Rationale**: `withSystemContext()` is for system/admin flows ONLY — never to
silence a customer-path `TenantContextMissingError` (MULTI_TENANT_GUARDS §When NOT
to use). Each fix DoD = confirmed defect closed + regression test + **§2G CI gate
wired WITH the fix** (not after) so it cannot silently regress.

### Decision: §2G CI gate is wired in the SAME slice as each §2A fix

**Choice**: Wire the dead RLS/integration tests (CI-GAP-RLS, CI-GAP-INTEGRATION)
into CI inside the IDOR fix PR. **Alternatives**: fix first, wire net later
(rejected — §2A can silently regress in the gap). **Rationale**: §2G is the
regression net for §2A; decoupling them reopens the hole on the next change.

### Decision: Phase B dep-freshness gate is assert-dominant, edit-free for shared deps

| Dep kind                                    | Gate action                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| SHARED (≥2 manifests / family / in catalog) | ASSERT == catalog pin. Stale → log catalog-bump candidate + validate vs CURRENT pin. **Never edited mid-walk** |
| PRIVATE (1 manifest, this item)             | May freshen — `taze` private-only, contained                                                                   |

Then `pnpm install --frozen-lockfile` + `syncpack list-mismatches`. **Rationale**:
post-baseline-on-main, drift should already be ~0, so the gate is mostly a no-op
assertion (ADR-0018) and the real cost is RE-VERIFY. Mid-walk catalog edits would
trigger the drift-hydra; bumps drain as ONE root PR after the walk.

### Decision: Section-ordered batching, LXC-safe per-item RE-VERIFY

**Choice**: Walk B → Fase 0 → Fase 1 → Fase 2 → Fase 3, respecting `🔗 dep:` +
§8.5 (no Fase 3 while any Fase 1 open). RE-VERIFY = **single-file/targeted test
runs**, heap-capped, dev PAUSED, sequential — never the full suite at once.
**Alternatives**: topological (over-engineered for a doc-walk; deps are
intra-section); full-suite per item (OOM on 9GB LXC). **Rationale**: matches the
plan macro-order; ~23 frozen items = re-confirm (code merged), ~44 open =
build-then-confirm — heterogeneous walk, batch sizing respects ~9GB.

## Data Flow

    Phase A (per §2 lead):
      cited path ─→ re-read ─→ exploit hypothesis ─→ CONFIRM ──→ canon fix ─→ regression test ─→ §2G CI gate ─→ [defect closed]
                                                  └─→ refute ──→ record not-a-defect (evidence)

    Phase B (per plan item):
      SCOPE ─→ dep-freshness gate ─→ frozen-lockfile install + syncpack ─→ RE-VERIFY (targeted, heap-capped) ─→ fix ─→ PR green ─→ [x]
                      │                                                              ▲
                      └── stale shared dep ─→ catalog-bump-candidate log ────────────┘ (drained as ONE root PR after walk)

    Sequencing gate: IDOR/auth (Phase A) ─→ unblocks Fase 1-2 client-portal items
                     OAUTH-REFRESH-UNWIRED (Phase A) ─→ unblocks F1-API-4 (Canva)

## File Changes

Phase A touches confirmed-defect sites only (each its own PR, ≤400 lines):

| File                                                                                                                           | Action | Description                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------- |
| `packages/core/posts/src/DeletePostUseCase.ts` (+ List/Get post use cases)                                                     | Modify | Add `callerAccountId` to input; enforce owner gate via repo joined filter        |
| `apps/api/src/infrastructure/repositories/Prisma*Repository.ts` (posts/analytics/trackedLink/notifications/recurring/comments) | Modify | Add `project: { accountId }` joined filter where missing (S2.1d pattern)         |
| `apps/api/src/<auth>/registerRoutes.ts`                                                                                        | Modify | Strip `role` from public register payload                                        |
| `apps/api/src/index.ts` (or plugins)                                                                                           | Modify | Register `@fastify/rate-limit`; wire `OAuthTokenRefresher` into publish flow     |
| publish worker + saga persistence                                                                                              | Modify | Double-post idempotency; `needsReauth` on failure; saga `accountId`↔`userId` fix |
| cache key sites (`autoCache`, AI cache)                                                                                        | Modify | Add `accountId` to key namespace via `CachePort`                                 |
| `.github/workflows/*` + existing integration/RLS tests                                                                         | Modify | Wire §2G dead tests into CI alongside the fixes                                  |
| `docs/product/IMPLEMENTATION_PLAN_ES.md`                                                                                       | Modify | Re-mark `[x]` per item only after its PR is green; update dashboard              |

Phase B is verification-dominant: edits are the `[x]` re-marks + any RE-VERIFY
fixes surfaced per item; NO mid-walk catalog edits.

## Interfaces / Contracts

```typescript
// §2A pattern — owner gate added at the use-case boundary (transitively-scoped)
export interface DeletePostInput {
  postId: string;
  callerAccountId: string;
}
// repository joined filter (MULTI_TENANT_GUARDS §Transitively-scoped tables):
//   where: { id: postId, project: { accountId: requireTenantContext().accountId } }
```

No new ports/tokens at the walk level. Per-fix port additions (if a repo lacks a
needed method) follow canon: add to the port + adapter, never bypass it.

## Testing Strategy

| Layer             | What to Test                                                                     | Approach                                                       |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Unit              | each §2A use case rejects a foreign `callerAccountId`                            | Vitest, mock repo, AAA                                         |
| Integration       | cross-tenant request returns 403/404; register cannot set role; rate-limit fires | node:test, real DB+Redis (`pnpm db:up`), LXC-safe              |
| Regression (§2G)  | RLS 51-table isolation + 16 dead integration files run in CI                     | Wire existing tests into workflow in the fix slice             |
| Phase B RE-VERIFY | per-item DoD + 0-defect + confirmed §2 caveats                                   | Targeted single-file runs, heap-capped, sequential, dev PAUSED |

## Migration / Rollout

No data migration. Feature-branch-chain on tracker `workstream/impl-revalidation`:
Phase A = one PR per confirmed cluster (IDOR, cache, auth, write-path); Phase B =
per-section PRs (split to per-item when an open item is a real build or exceeds
budget). PR #1 targets tracker; child PRs target the prior PR branch; only tracker
merges to main. Catalog-bump root PR lands last. Per-PR revert restores prior
state. No item re-marks `[x]` until green, so the dashboard never leads the
verified state.

## Open Questions

- [ ] Known blockers stay `[!]` until their precondition lands: **F1-CLI-4** until
      `bulk_schedule_targeting_gap` (per-provider-vs-per-channel) redesign; **F1-API-4**
      until §2F OAUTH-REFRESH-UNWIRED fixed in Phase A.
- [ ] Frontend items (F0-CLI-_, F1-CLI-_) RE-VERIFY under the **vite 7.3.5 hold**
      (vite 8 rolldown JSX-in-SSR gap, vitejs/vite#21505) — not vite 8.
- [ ] RE-VERIFY runs against MERGED-main; if a Phase A fix changes an area a later
      Phase B item covers, re-confirm that item against the post-fix tree.
