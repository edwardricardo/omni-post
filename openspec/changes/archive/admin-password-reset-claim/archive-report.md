# Archive Report — admin-password-reset-claim (SMELL-97)

> Closure record for the SDD change (branch `workstream/smell97-close`, off main `12bca1c0`,
> which contains both merged PRs; verify-report on disk (obs scope: PR1 only) verdict
> `pass-with-warnings` for the PR1 scope, 0 CRITICAL, 12/12 merge-blocking requirements
> COMPLIANT, 45/48 in-scope scenarios). Semantic content (this report, the Master Plan ficha,
> the backlog rows) authored by the archive executor. The mechanical steps this executor's
> toolset (Read/Edit/Write/Glob/mem_*, no shell/Bash) cannot perform — the archive-folder
> `git mv` and the two NEW-capability delta-spec `cp` promotions — are handed to the
> orchestrator below as byte-identical `cp`/`git mv` + `diff -r`-verified steps, the same
> precedent set by `password-reset-integrity` and `analytics-route-port-integrity`.

## Shipped — two PRs (a third, this docs-only close, follows)

| PR                                       | Commits                                                                                                                                                                     | Merged (main tip) | Fresh gate                                                                                                                                                                                 | RDD (4R)                                                                               | CODE (measured)                                                                                                                                                               | EVIDENCE (measured)                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #254 (fixes + all evidence)              | includes `9ee6a0f3` (rotation-replay metric/alert/runbook + benign-revocation disambiguation, a 4R-driven addition) and `c53a3f49` (formatting) among its work-unit commits | `31e2a2ad`        | PASS-WITH-WARNINGS, 0 CRITICAL — PR1 scope: 12/12 merge-blocking requirements COMPLIANT, 45/48 in-scope scenarios (3 PARTIAL on non-blocking documentation clauses, 0 FAILING, 0 UNTESTED) | 4/4 APPROVE-WITH-NOTES, zero blockers, plus one adjudicated polish unit U3b (14 items) | **422** (338+/84−) vs the 400 hard budget — **size exception RATIFIED by Edward** (ask-on-risk decision; the +22 is observability hardening the 4R lenses required pre-merge) | **2,643** measured vs the re-adjudicated stop 2,470 (+173) — **RATIFIED**, recalibration #9 recorded (a multi-item polish writer needs a running per-item estimate, not a single settle-time measurement) |
| #255 (fitness #41 gate)                  | `8ec9f4a7` `chore(fitness): add check #41 -- consumption markers must name their credential in where`                                                                       | `12bca1c0`        | Not independently re-run by this archive phase (no shell tool) — reconciled on the merge fact + `CLAUDE.md` reading "41 checks" on the current tree (see Reconciliation note below)        | n/a (gate-only PR; see design's own red-proof protocol, task 4.4)                      | not independently measured by this phase                                                                                                                                      | n/a                                                                                                                                                                                                       |
| #(unassigned) PR3 — this docs-only close | archive-report + backlog rows + Master Plan ficha (this session); archive-folder move + spec promotion still pending shell                                                  | —                 | —                                                                                                                                                                                          | —                                                                                      | docs-only, out of the CODE/EVIDENCE budget                                                                                                                                    | —                                                                                                                                                                                                         |

## What shipped, in one line each

- **The reset claim** (`PasswordService.confirmPasswordReset`): one `findFirst` (id, `passwordHash`,
  `passwordHistory`, mirroring `isActive: true`) → non-consuming strength/reuse checks → ONE
  `updateMany` naming `id` + `passwordResetToken` + `passwordResetExpires: {gt: now}` +
  `isActive: true` + the READ `passwordHash`/`passwordHistory` snapshot in its own `where`;
  `count > 0` is the gate (no `@unique` on the token column — blocked by the `"CHANGE_REQUIRED"`
  sentinel, SMELL-110), with `id` capping the match at one row so `count > 0` and `count === 1`
  coincide in practice. A `count === 0` re-read disambiguates `INVALID_TOKEN` from the new
  `CONCURRENT_MODIFICATION` (409) conflict — a moved `passwordHistory` snapshot is never
  reported as a dead token. A throw becomes `INTERNAL_ERROR`, never `INVALID_TOKEN`.
- **The rotation claim** (`AuthServiceSession.refreshTokens`): the rotation write becomes
  `updateMany({ where: { id, refreshTokenHash: hash(presented), isActive: true }, data: {...} })`
  — `AdminSession.refreshTokenHash` is `@unique`, so `count === 1` is the whole verdict (the
  opposite gate shape from the reset claim, each justified at its own site per the spec's
  `[static]` requirement). `count !== 1` → `TOKEN_BLACKLISTED` with a HIGH audit
  `ROTATED_TOKEN_REPLAYED`, refined by a re-read that reports a mid-flight benign revocation as
  `SESSION_REVOKED_MIDFLIGHT` (MEDIUM, no threat counter) instead of disguising it as an attack.
  `blacklistToken` moved to AFTER a successful CAS (D3), so a losing or throwing attempt never
  kills a live token.
- **The per-mint `jti`** (D9, `authServiceCore.ts`): `jwtid: randomUUID()` on every refresh JWT.
  Without it, two mints of one payload inside the same second are byte-identical, so the
  rotation CAS is a no-op in that window and both racers see `count === 1` — the CRITICAL design
  gate finding F1 that forced this mechanism addition. Redis-independent by construction.
- **Fitness #41** (`single-use-claim-gate`): a structural (balanced-argument-slicing) scan —
  any `update`/`updateMany`/`upsert` whose `data` carries a single-use consumption marker must
  name that credential's prior state in the SAME call's `where`. Measured population: 8 marker
  sites = 7 claim sites + 1 named issuance exception (`PrismaAdminSessionRepository.
updateRefreshTokenHash`), of which 2 claim sites were unsound before this change and 0 after.
  Fail-closed floors (site-count, exception-count, scope-directory existence). Red demonstrated
  with 6 planted violations, each restored byte-exact and re-confirmed at 0.
  `CLAUDE.md`/`fitness.yml` now report **41 checks**.

## Requirement disposition (PR1 scope; `single-use-claim-gate`'s 5 requirements / 16 scenarios

were sequenced to PR2 per the signed ordering and are not independently re-verified by this
archive phase — see Reconciliation note)

All 12 `[MERGE-BLOCKING]` requirements across `admin-password-reset-claim` (8 req / 31
scenarios) and `admin-refresh-rotation-claim` (6 req / 17 scenarios) are COMPLIANT per the
verify-report on disk (45/48 in-scope scenarios COMPLIANT, 3 PARTIAL on non-blocking
documentation clauses that depend only on the PR1 body existing — task 3.16 — and W1's
spec-sentence amendment, both addressed below). 0 FAILING, 0 UNTESTED, 0 CRITICAL.

## W1 (verify) — spec sentence amendment, confirmed already applied on disk

Verify's W1 finding: refresh requirement F2 originally stated the refusal "SHALL be produced
by the rotation claim itself, not by a preceding cache lookup" as an unqualified sentence that
the adjudicated implementation does not literally meet on the SEQUENTIAL replay path (an
earlier guard — `SESSION_EXPIRED` Redis-less, or the blacklist with Redis — may answer first;
the claim itself is proven to be the authority only in the racing interleaving, which is the
case no cache can cover). Verify required this amended before spec promotion. **Confirmed by
this archive phase: the delta spec on disk already carries the amendment** —
`specs/admin-refresh-rotation-claim/spec.md:116-117` reads "(Amended per verify W1,
2026-09-13: the original unqualified sentence stated a SHALL the adjudicated implementation
does not meet on the sequential path.)" — so the byte-identical promotion (pending shell, see
below) needs no further edit.

Also confirmed already on disk: the `single-use-claim-gate` spec's F7 amendment ("8 marker
sites = 7 claim sites + 1 named issuance exception", `spec.md:104-109`) and the residual-limits
wording ("argument slicing" replacing "line-window matching", `spec.md:198-201`) — both match
task 0.3's verification note that these amendments were already present in the spec files
before apply.

## Honest numbers, not smoothed

- PR1 CODE: **422** (338 additions / 84 deletions) against the 400 hard budget. Edward ratified
  the size exception under `ask-on-risk`: the +22 lines are observability hardening (the
  rotation-replay metric/alert/runbook + the `SESSION_REVOKED_MIDFLIGHT` disambiguation) that
  the 4R review required before merge, landing in commit `9ee6a0f3`.
- PR1 EVIDENCE: **2,643** measured against the re-adjudicated stop of 2,470 — exceeds by 173
  (~7%), RATIFIED, reported not trimmed. The band itself was re-adjudicated mid-flight: the
  original forecast (1,165–1,510, stop 1,737) was reset to ~2,000–2,150 / stop ~2,470 after U1
  alone measured 1,631 EVIDENCE lines, with the recalibration rule "a harness line that cites a
  precedent MEASURES that precedent first" recorded for future forecasts.
- PR2 (fitness #41): CODE not independently re-measured by this archive phase (no shell).
  Tasks.md forecast it at 377–406 changed lines after the L1+L2 levers (backlog rows moved to
  PR3, ~6 comment lines re-wrapped losslessly).
- Tests at PR1 verify time: 567 passed / 0 failed / 0 cancelled / 0 skipped across two runs
  (integration:admin-single-use-claims 16/16; full DB tier 522/522; unit tier for the two new
  files 45/45). Fitness #30 measured **20** vs the ratchet baseline **21** (did not rise; both
  new racers ARE reached by `run-tests.sh`).

## Residuals carried forward (filed with owners, backlog rows SMELL-110 through SMELL-118)

| Row                     | One-line                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SMELL-110               | `"CHANGE_REQUIRED"` sentinel + dead `mustChangePassword` force-change feature — blocks a `@unique` index on `AdminUser.passwordResetToken`                               |
| SMELL-111               | Fitness #23 blind to raw queries written as tagged templates — 6 production sites                                                                                        |
| SMELL-112               | Issued-but-never-consumed credentials: DSAR `verificationToken`, `findByInviteToken`                                                                                     |
| SMELL-113               | Customer refresh flow has no server-side rotation at all (pairs with the deferred family revocation)                                                                     |
| SMELL-114               | `PasswordService` unconstructible for tests inside `AdminAuthService` (holds `PrismaClient` directly)                                                                    |
| SMELL-115               | Enumeration-timing fig leaf + `"reset_token_placeholder"` control-flow sentinel (issuance path)                                                                          |
| SMELL-116 (DF-6)        | `mockPrisma.matchesWhere` falls an unknown operator through to `===` — silent false-zero risk, 33 importing suites                                                       |
| SMELL-117 (DF-2)        | The reuse check compares only `passwordHistory`, not the live `passwordHash` — a reset can set the password to its current value                                         |
| SMELL-118 (gate pass-2) | The SECOND admin refresh flow (`AdminAuthService.refreshToken`) never rotates its stored hash — admin twin of SMELL-113, named in fitness #41's own OUT-OF-CLASS comment |

**Named, signed follow-up NOT filed as a numbered row (already named in the spec and the
gate's own text):** session-family revocation on a detected rotation replay is deferred — the
replay is detected and refused, the session is not revoked as a family. Pairs with SMELL-113.

## Spec merges — pending shell, contents already correct

- `openspec/specs/admin-password-reset-claim/spec.md` — NEW capability, byte-identical copy of
  the delta (7 ADDED requirements, all `[MERGE-BLOCKING]` but one, 27 scenarios).
- `openspec/specs/admin-refresh-rotation-claim/spec.md` — NEW capability, byte-identical copy
  of the delta AS AMENDED for W1 (6 ADDED requirements, 17 scenarios). Amendment already on
  disk, confirmed above — the promoted copy needs no further edit.
- `openspec/specs/single-use-claim-gate/spec.md` — NEW capability, byte-identical copy of the
  delta AS AMENDED for F7/residual-limits (5 ADDED requirements, 16 scenarios). Amendments
  already on disk, confirmed above.

None of the three domains exist yet under `openspec/specs/`, so each delta spec IS the full
spec per the archive skill's convention — mechanical `cp` + `diff -r`, not a merge.

## Task Completion Gate — reconciliation record (MANDATORY disclosure)

`tasks.md` had five items unchecked at the start of this phase: 3.16, 4.10, 4.11 (all
PR-body/verification tasks the writer never performs directly — "the writer never opens PRs" /
"the orchestrator owns every commit, push and PR"), and the five close-ritual items 5.1–5.4
under U5 (this PR3's own work).

Reconciled by this archive phase, with reasons recorded:

- **3.16, 4.11** (PR1/PR2 body content) — checked, reconciled on the orchestrator's explicit
  launch-prompt final-state fact that PR #254 and PR #255 are merged into main `12bca1c0`; this
  executor has no GitHub-read tool to inspect either PR body directly, so this is a
  merge-fact-based reconciliation, not an independent read of the PR body text.
- **4.10** (re-run the full fitness suite on the merged shape) — checked, reconciled on THREE
  pieces of evidence, stated plainly because this is NOT a fresh measurement: (a) the
  orchestrator's final-state fact that PR #255 (commit `8ec9f4a7`) merged the #41 gate to main;
  (b) this phase independently read `CLAUDE.md:305` on the CURRENT tree and confirmed it reads
  "41 checks, numbered #1-#41", not 40 — a real, if partial, static corroboration; (c) this
  repo's branch-protection/CI convention requires the fitness workflow green before a PR merges.
  **This phase did NOT execute the fitness suite itself** — no shell/Bash tool was available.
- **5.1, 5.2, 5.3** — checked; completed in this session (backlog SMELL-97 row + 9 new rows;
  Master Plan §6 dashboard + [CRED] ficha).
- **5.4** — left UNCHECKED. The archive-folder move and the three spec promotions did not
  happen; blocked by the Mechanical Copy Contract's shell-only requirement with no toolset
  access to shell in this invocation.

## Orchestrator TODO — mechanical steps (byte-identical copy / move only)

1. **Copy (3× NEW capability, byte-identical):**
   - `openspec/changes/admin-password-reset-claim/specs/admin-password-reset-claim/spec.md`
     → `openspec/specs/admin-password-reset-claim/spec.md`
   - `openspec/changes/admin-password-reset-claim/specs/admin-refresh-rotation-claim/spec.md`
     → `openspec/specs/admin-refresh-rotation-claim/spec.md`
   - `openspec/changes/admin-password-reset-claim/specs/single-use-claim-gate/spec.md`
     → `openspec/specs/single-use-claim-gate/spec.md`
     Verify each: `diff` empty / checksum match.
2. **Move (after step 1 and after this report + the two docs edits land):**
   `openspec/changes/admin-password-reset-claim/` →
   `openspec/changes/archive/admin-password-reset-claim/` (no date prefix — matches this repo's
   established convention, confirmed against every existing entry under
   `openspec/changes/archive/`).
   Verify: `openspec/changes/admin-password-reset-claim/` no longer exists; the archived folder
   contains every original file plus this report and the tasks.md checkbox reconciliation,
   unmodified in content.
