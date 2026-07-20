# Archive Report — mfa-consolidation (N-SEC-5, Cluster B)

**Status**: complete (spec merge, report, and folder move all done; committed by the orchestrator)
**Date**: 2026-07-11
**Artifact store**: hybrid (openspec files + engram mirror)

## Task Completion Gate — PASSED

Read `openspec/changes/mfa-consolidation/tasks.md` in full. Every task across all
sub-phases is checked:

| Section                                        | Tasks        | Result    |
| ---------------------------------------------- | ------------ | --------- |
| PR1 (Port + Service Completion + DI)           | 1.1–1.8      | all `[x]` |
| PR2 (Customer Persistence + Route Correctness) | 2.1–2.6      | all `[x]` |
| PR2b-1 (TOTP single-use fix)                   | 2b1.1–2b1.11 | all `[x]` |
| PR2b-2 (Client-portal challenge UI, inert)     | 2b2.1–2b2.10 | all `[x]` |
| PR2b-3 (Backend gate + orphan retirement)      | 2b3.1–2b3.23 | all `[x]` |
| PR3 (Backfill + Legacy Retirement)             | 3.1–3.5      | all `[x]` |

No stale unchecked checkboxes found. No exceptional reconciliation was needed.

## Verify Report Review — no unaddressed CRITICAL

Read `openspec/changes/mfa-consolidation/verify-report.md` (651 lines) in full,
covering all six verified slices:

| Slice  | Verdict                                           | CRITICAL | WARNING (disposition)                                                                                                                      | SUGGESTION                                             |
| ------ | ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| PR1    | PASS WITH WARNINGS → then PASS after remediation  | 0        | 0 (both resolved same session)                                                                                                             | 0                                                      |
| PR2    | PASS WITH WARNINGS → then PASS after remediation  | 0        | 0 (both resolved)                                                                                                                          | 1 (S3, deferred to PR3, later resolved)                |
| PR2b-1 | PASS WITH WARNINGS → then clean after remediation | 0        | 0 (resolved: S1 fail-closed catch fix, W1 documented by test)                                                                              | 0                                                      |
| PR2b-2 | PASS WITH WARNINGS                                | 0        | 1 (W-PR2b-2-1, cross-slice error-code contract — resolved in PR2b-3, confirmed below)                                                      | 2 (pre-existing, out of scope)                         |
| PR2b-3 | PASS WITH WARNINGS → then further remediated      | 0        | 2 original (W-PR2b-3-1 tenant-binding gap RESOLVED same session; W-PR2b-3-2 full-stack e2e DEFERRED to merge checklist, not a code defect) | 1 (pre-existing, out of scope)                         |
| PR3    | PASS WITH WARNINGS → then remediated (S1+S2)      | 0        | 2 original (W-PR3-1 test-coverage gap RESOLVED via new unit test; W-PR3-2 live-API test batches DEFERRED to reviewer/CI checklist)         | 1 remaining (S-PR3-2, cosmetic duplicate `@layer` tag) |

**Zero CRITICAL findings across the entire change.** Every resolvable WARNING was
closed within the same session via post-verify remediation with RED→GREEN proof;
the two WARNINGs that remain open (W-PR2b-3-2, W-PR3-2) are explicitly
merge-readiness/reviewer-checklist items, not code defects, and every verify
section's `next_recommended` already pointed to `sdd-archive`. This satisfies the
"NEVER archive a change that has CRITICAL issues" rule and the "resolvable
WARNING" owner policy applied throughout this change.

## Specs Synced (openspec/specs/ — source of truth updated)

Three named capabilities existed as delta specs under
`openspec/changes/mfa-consolidation/specs/`; none had a corresponding living spec
under `openspec/specs/` yet, so each was created as a full spec (not a delta
merge). A fourth capability — the PR2b customer login MFA challenge — was
**never captured as a formal delta spec** (PR2b went from `sdd-explore` directly
to `sdd-design`/`sdd-tasks`, skipping a dedicated spec phase); its living spec was
synthesized from `design-pr2b.md`'s architecture decisions and the adversarially
re-verified merge-blocking invariants in `verify-report.md`'s PR2b-3 section, so
the durable record reflects what the system actually guarantees post-merge, not
just what the original proposal scoped.

| Domain                         | Action                                          | Details                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unified-mfa-service-and-port` | Created                                         | Delta spec content merged verbatim (7 requirements) + 1 NEW requirement added: "TOTP verification is single-use for both subjects" `[MERGE-BLOCKING]`, synthesized from PR2b-1's design Decision 2 + verify-report evidence (accepted-once, next-step-still-works, HIGH audit, cross-operation replay rejection)       |
| `customer-mfa-persistence`     | Created                                         | Delta spec content merged verbatim (4 requirements) + 1 scenario strengthened (explicit "genuine reset token / sentinel never migrated or nulled" scenario, reflecting the PR3 adversarial guard-safety proof)                                                                                                         |
| `mfa-flow-correctness`         | Created                                         | Delta spec content merged verbatim (3 requirements) + 1 scenario added (cross-account mismatch rejection on self-service routes, reflecting PR2 tenant-guard proof)                                                                                                                                                    |
| `customer-login-mfa-challenge` | Created (NEW capability, no delta spec existed) | 9 requirements synthesized from `design-pr2b.md` Decisions 1–10 and the PR2b-3 verify section's 10 proven merge-blocking invariants (no pre-MFA session, atomic single-use, fail-closed store, wrong-code-doesn't-burn, anti-oracle, IP/UA binding, JWT-kind isolation, tenant-binding cross-check, orphan retirement) |

All four living specs cross-reference each other and the archived design docs for
full traceability, and each carries a `## How to extend` section per the
established `openspec/specs/*/spec.md` convention (matching the `cross-tenant-criticals`
precedent).

## Filesystem archive move — DONE (performed by the orchestrator)

Per `openspec-convention.md`, `sdd-archive` moves
`openspec/changes/{change-name}/` → `openspec/changes/archive/{change-name}/`.
The archive executor had no filesystem-move tool, so the orchestrator performed
the move: `openspec/changes/mfa-consolidation/` → `openspec/changes/archive/mfa-consolidation/`
(a pure rename, no content altered). The bare-name form matches the sibling
precedents (`cross-tenant-criticals`, `dev-prod-resolution-model`,
`knip-at-alias-resolution`) — the archive convention is NOT date-prefixed.

## Commit chain — verified by the orchestrator

Confirmed via `git log --oneline`: `005b7252` (PR1) → the audit-actor-polymorphism
A1 commits (a SEPARATE change, archives independently after A2, NOT part of this
archive) → `c89b7d95` (PR2) → `da8ef686` (PR2b-1) → `eb84ee28` (PR2b-2) →
`806eaf60` + `e9a75e8a` (PR2b-3) → `a84271b9` (CI-fix chore) → `d2bd7b40` +
`7f95bf2e` (PR3). PR3 is committed; the working tree was clean before this archive
phase (the "uncommitted PR3 scope" the executor saw was a stale git-status
snapshot taken before PR3's commits landed — a false alarm, resolved). This
archive commit itself lands the living specs, the folder move, and this report.

## Carry-forward items (explicitly NOT closed by this archive)

### Merge-readiness gates (must clear before the branch merges to main)

1. **W-PR2b-3-2 / full-stack smoke** — run the manual enroll→login→challenge→complete
   flow (and/or the Playwright `auth.spec.ts:231-254` MFA spec) against a booted
   API(:3000)+Next stack. Every individual link (Redis atomicity, route-level
   error contract, JWT-kind isolation, DI wiring) is proven at its own layer;
   only the full composition was never run end-to-end.
2. **Operator prod backfill** — run `backfill-admin-mfa-backup-codes.ts` against
   production: COUNT the guard-matching population first (`verifyIntegrity`),
   then `runBackfill`, then re-verify, then `--cleanup` only if the count is `> 0`.
   Safe no-op if the count is zero.
3. **W-PR3-2 / 5 live-API root test batches** — `auth.test.ts`, `audit.test.ts`,
   `rbac.test.ts`, `trialPeriod.test.ts`, `accountLifecycle.test.ts` (the modified
   files visible in git status) are live-API node:test batches not re-run in the
   LXC single-file verify harness; reviewer/CI should run them before merge.

### Backlog (each a future slice, NOT part of mfa-consolidation)

1. **SMELL-53** — `apps/api/tsconfig.json`'s `include` excludes `tests/`, so
   `tsc --noEmit` never type-checks test files (only `tsx` transpiles them). A
   real behavioral-assertion mismatch shipped silently to CI once already during
   this change (the `tests/mfa.test.ts` DI-repoint incident) because of this gap.
2. **5 pre-existing `js/insufficient-password-hash` CodeQL alerts on main** —
   token hashes, not passwords; owner-reported, not examined during this change;
   needs individual review.
3. **Customer refresh token lacks iss/aud pinning** (`customerJwt.ts:79-81,89-91`)
   — RFC 8725 §3.8/§3.9 gap, pre-existing; retrofit forces a global logout
   (every outstanding refresh token invalidated) so it needs its own rollout plan.
4. **Admin MFA login migration to the challenge shape** — today's admin login
   still re-transmits the password on the MFA step, and the admin frontend
   plumbs a `mfaSessionToken` the backend never emits (confirmed phantom field:
   `authServiceCore.ts` returns only `{mfaRequired, userId}`). The new
   `CompleteCustomerMfaLoginUseCase` is the template for this future migration.
5. **Stale docs claiming "SHA-256" for MFA backup codes** —
   `docs/product/MASTER_PLAN_ES.md:150` and `docs/standards/code-standards.md:22`
   both describe the (now-deleted) legacy service as SHA-256-hashing backup
   codes; verified against the real pre-deletion source that it always called
   the canonical Argon2id helper. Docs-only fix, separate slice.
6. **`LoginCustomerUseCase` pre-existing canon deviation** — mutating use case
   without UoW; the new PR2b-3 step-2 use case follows canon correctly, but
   retrofitting the pre-existing login use case is separate hygiene (noted in
   `design-pr2b.md`'s own backlog).
7. **k6 auth-helper stale reference** (`performance/k6/utils/auth-helpers.js`) —
   already fixed/removed per PR2b-3 task 2b3.20; confirm on next perf-suite run.

## Traceability — Engram observation IDs

| Artifact                       | Engram topic_key                       | Observation ID(s)          |
| ------------------------------ | -------------------------------------- | -------------------------- |
| Proposal                       | `sdd/mfa-consolidation/proposal`       | #211                       |
| Spec (PR1/PR2/PR3 delta specs) | `sdd/mfa-consolidation/spec`           | #212                       |
| Design (PR1/PR2/PR3)           | `sdd/mfa-consolidation/design`         | #213                       |
| Design (PR2b)                  | `sdd/mfa-consolidation/design-pr2b`    | #234                       |
| Tasks (PR1/PR2/PR3)            | `sdd/mfa-consolidation/tasks`          | #214                       |
| Tasks (PR2b)                   | `sdd/mfa-consolidation/tasks-pr2b`     | #235                       |
| Apply progress                 | `sdd/mfa-consolidation/apply-progress` | #215                       |
| Verify report                  | `sdd/mfa-consolidation/verify-report`  | #216                       |
| Archive report (this document) | `sdd/mfa-consolidation/archive-report` | (new, saved by this phase) |

## Filesystem changes made by this archive phase

- Created `openspec/specs/unified-mfa-service-and-port/spec.md` (new living spec)
- Created `openspec/specs/customer-mfa-persistence/spec.md` (new living spec)
- Created `openspec/specs/mfa-flow-correctness/spec.md` (new living spec)
- Created `openspec/specs/customer-login-mfa-challenge/spec.md` (new living spec, synthesized — no delta spec existed for PR2b)
- Created `openspec/changes/mfa-consolidation/archive-report.md` (this file)
- Orchestrator moved `openspec/changes/mfa-consolidation/` → `openspec/changes/archive/mfa-consolidation/` (bare-name convention)

## Next Recommended

`none` for planning — the change is functionally complete and its guarantees are
now recorded in living specs. Two mechanical/operational follow-ups remain
outside SDD's scope: (1) the orchestrator performs the folder move above, and
(2) a human/reviewer clears the merge-readiness gates before merging
`workstream/cluster-b-mfa` to `main`.

## Extraction delivery map

The mega-branch was never merged wholesale. Its content landed on `main` as
five reviewed extraction slices, each adversarially gated (the internal slice
labels above map as follows):

| Internal slice     | Delivery PR                                        |
| ------------------ | -------------------------------------------------- |
| PR1                | #129 (`workstream/mfa-consolidation-pr1`)          |
| audit-actor (A1)   | #130 (`workstream/audit-actor-foundation`)         |
| PR2                | #131 (`workstream/customer-mfa-persistence`)       |
| PR2b-1/2/3         | #132 (`workstream/customer-login-mfa-gate`)        |
| PR3 + this archive | the `workstream/mfa-legacy-retirement` delivery PR |

The `audit-actor-polymorphism` change is NOT archived with this one: only its
write-path foundation (A1) has landed; the read path (A2 — `35d44f4` +
`84c0c7d` + `3c43d8e` on the mega-branch) remains a pending extraction and the
change stays live under `openspec/changes/` until it lands.
