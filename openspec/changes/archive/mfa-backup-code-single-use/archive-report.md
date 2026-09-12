# Archive Report — mfa-backup-code-single-use

> Closure record for the SDD change (branch `workstream/mfa-close`, off main @ `fdda5d25`;
> 41/41 tasks; verify-report verdict `pass-with-warnings`, 0 CRITICAL, 12/12 requirements,
> 38 scenarios). Semantic content authored by the archive executor (Engram
> `sdd/mfa-backup-code-single-use/archive-report`); the mechanical steps its toolset could
> not perform (the NEW-capability spec copy, this folder's move) were completed by the
> orchestrator with `cp`/`mv` + diff verification — copy byte-identical, move verified.

## Shipped — one PR, six work-unit commits, fresh-gated + RDD-reviewed once

| PR   | Commits                                                                                                                                           | Merged (main tip) | Fresh gate                                                        | RDD (burned)                                                     | CODE (measured)                 | EVIDENCE (measured)                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| #246 | `73fbaf96` (planning) · `7a810273` (WU1) · `39e65d58` (WU2) · `6e01b171` (WU3) · `438b321f` (WU4) · `5a6a47b6` (WU5) · `499d32d4` (WU6, evidence) | `fdda5d25`        | PASS-WITH-WARNINGS, 0 CRITICAL — 12/12 requirements, 38 scenarios | `review-733aa5a74a2f8c9d` (9 advisories: 4 WARNING/5 SUGGESTION) | **233** — hard budget 400, PASS | **946** — declared band 450-600, hard stop 700 BREACHED, **ADJUDICATED ACCEPTED** (Edward, 2026-09-11/12) |

Work-unit map (all six landed in one PR, per-commit for traceability, never split into
chained PRs — the tasks-phase forecast called `Chained PRs recommended: No` and the ledger
held):

- **WU1** (`7a810273`) — snapshot-consistent pre-check in both Prisma MFA adapters (Customer
  - Admin); Tier 1 sequential-reuse + immutability reds un-stubbed with an honest stateful
    Prisma-client fake; new Tier 2 port-conformance suite over all three implementations
    (both adapters + `InMemoryMfaUserRepository`), sequential reuse first.
- **WU2** (`39e65d58`) — port contract rewritten to the observable guarantee (no CAS/
  snapshot/column-encoding language); signature byte-identical; the double's stale "mirrors
  the Prisma CAS" comment corrected (its semantics were right all along).
- **WU3** (`6e01b171`) — `MfaService`: the adapter claim becomes sole authority, remaining
  count read back post-claim inside the transaction, used-index filter re-documented as an
  argon2-cost optimisation (never a control), alarm+metric wired on every refusal.
- **WU4** (`438b321f`) — one Prometheus alert rule + one runbook (`docs/runbooks/alert-mfa-
backup-code-reuse.md`) naming the broadened volume profile and the sibling-claim false
  positive.
- **WU5** (`5a6a47b6`) — Tier 3 integration repair (distinct timestamps, real UoW) + the
  staggered racer via a test-local `gateClaimSnapshot`/`BarrierMfaUserRepository` seam; wired
  into `CONCURRENCY=1 run_batch "integration:mfa-backup-single-use"`.
- **WU6** (`499d32d4`) — evidence: tasks checkboxes + the measured two-tier split.

## Defect disposition — the staggered interleaving, closed at its root

The pre-existing atomic claim (`7b245e3e`, an earlier fix) closed only the SIMULTANEOUS
interleaving (`Promise.all`, both snapshots before either commit). It left the STAGGERED
one open: a second verification's snapshot taken strictly AFTER the first's commit matched
the whole-column compare-and-swap's own in-method comparand, so `count === 1` a second time
and a second session was minted inside the argon2 window (5-30 ms measured, reproduced
6/6). The loser additionally overwrote the winner's consumption timestamp, destroying the
only forensic evidence the code was used twice, and the HIGH alarm
(`MFA_BACKUP_CODE_REUSE_REJECTED`) fired only on the interleaving the attack had already
lost.

This change closes it by construction rather than by tightening a race window:

- A ~3-line snapshot-consistent pre-check lands in BOTH adapters (Customer + Admin),
  between the read and the existing CAS. Interleaving coverage, argued explicitly per the
  proposal's own discipline: staggered → refused by the pre-check (the snapshot it took
  disagrees with the row the winner already committed); simultaneous → still refused by the
  existing CAS under EvalPlanQual re-evaluation; sequential replay → refused as before.
  Different-index sibling collisions remain a named, accepted residual (below).
- The §6.1 design-mandate SQL capture (`$on('query')`, both the adapter-tx proxy AND the
  Prisma query-event layer, over all three claim shapes) settled the open question from
  design: every emitted `updateMany` is a plain single-statement `UPDATE … WHERE (<qual>)`,
  never an `IN (SELECT …)` form. EvalPlanQual re-evaluates the qual under Read Committed, so
  the CAS is sound — and the same capture retroactively validates `claimTotpStep` and
  `claimPasswordReset` (the successor change's own claim, corroborated post-close). All
  three claim sites in the codebase are now settled by one piece of evidence.
- The winner's timestamp is immutable (an existing used-map key is never rewritten); tests
  present DISTINCT timestamps so the assertion is decidable rather than vacuous.
- The alarm + `api_security_threats_total` metric now fire on EVERY refused claim, whatever
  interleaving produced the refusal — not only the one where the write already lost. Stated
  volume-profile change: the HIGH stream broadens from "lost a concurrent write" to "every
  refused claim reaches the service", so already-used replays and the sibling false positive
  (below) also fire it.
- A port-conformance suite binds all three implementations (both Prisma adapters + the
  in-memory double) to the SAME assertions, sequential reuse first — the double's semantics
  were already correct; production was wrong. The suite fails if any implementation stops
  refusing, so the next divergence is a structural test failure, not a years-later discovery.

## Honest numbers, not smoothed

- CODE: **233** vs the 400 hard budget — PASS, no ruling needed.
- EVIDENCE: **946** vs the declared 450-600 band and the 700 hard stop — **BREACHED**.
  Apply stopped and reported per its own obligation rather than trimming assertions; nothing
  was deleted to fit. Breakdown: Tier 1 customer adapter 73 / Tier 1 admin adapter 71 / Tier
  2 conformance (new) 163 / Tier 3 integration 448 / service unit scenarios 191. Edward's
  ruling (2026-09-11/12): **ACCEPTED** — the ledger settled at 1778 total changed lines
  against an acquire budget of 1000, adjudicated as a maintainer decision rather than a
  reset.
- Measured ratio EVIDENCE:CODE ≈ **4.06×** (946/233) — higher than the tasks-phase forecast
  implied (~2.3-2.6× against the pre-approved 450-600 band over a 200-260 CODE ceiling).
  **Forecast recalibration**: for changes centered on a race-condition claim (concurrency
  proofs, port-conformance fan-out, a client-level test seam), the two-tier budget rule
  should assume a **~3.5-4.5× EVIDENCE:CODE ratio**, not the ~2.5-3× empirical baseline the
  standing rule (`feedback-two-tier-line-budget.md`) uses for ordinary feature work. The
  overshoot itemized honestly in apply-progress: an unplanned client-level
  `gateClaimSnapshot` seam (~45 lines, needed because the service-level barrier the design
  specified cannot gate the sibling-collision case without gating both racers into
  succeeding), the full 7-method `BarrierMfaUserRepository` decorator (~75), two removed-
  duplication test helpers (~45), and a service unit tier that came in at 191 vs a ~95
  forecast once two new repository doubles plus the metrics-spy harness rework were counted.
- Re-run at verify: unit `Test Files 566 / Tests 8814`, exit 0; integration
  `TOTAL: 501 tests, 501 pass, 0 fail`, with `integration:mfa-backup-single-use` itself `4/4
pass`; `tsc --noEmit --incremental false` exit 0; `eslint --max-warnings 0` exit 0.
  Fitness #30 measured on both sides of the diff: 21 (HEAD) → 20 (worktree) — the one file
  that left the unreached list is `mfaBackupCodeSingleUse.integration.test.ts`; the
  `.github/workflows/fitness.yml` ratchet literal stays `BASELINE=21` by deliberate design
  decision (D4), tightening it belongs to whichever slice next touches that file.

## Residuals carried forward (filed with owners, not absorbed)

- **SMELL-97 (LIVE)** — the admin-side `PasswordService.confirmPasswordReset` TOCTOU: the
  identical defect class this change fixed customer/admin-MFA-side, now the only reset path
  left without a CAS claim. Edward's pairing decision (2026-09-12): the discretionary CLASS
  fitness function (a consumption-marker write in `data` must name the claim in `where`)
  lands WITH that slice, not this one — fixing SMELL-97 shrinks its own baseline instead of
  this change carrying a ratchet for a defect it did not touch.
- **SMELL-75 residual, narrowed but not closed** — of the 21 orphan integration suites that
  gate inventories, this change wires exactly ONE (`mfaBackupCodeSingleUse.integration.test.ts`,
  measured 21→20). **Four sibling MFA suites remain unwired**: `customerLoginMfa`,
  `customerLoginMfaE2e`, `mfaCustomer`, `mfaTotpSingleUse` — none touched here by design
  (wiring more than one file was explicitly out of scope, per the proposal's non-goals).
- **Alert routing pending, pre-existing** — `prometheus/prometheus.yml` has its whole
  `alerting:`/`alertmanagers:` block commented out repo-wide, so the new rule is evaluated
  (visible via `/api/v1/alerts`) but never delivered anywhere. Not a regression of this
  change and spec R7 is literally satisfied, but the new runbook does not state this the way
  its sibling `alert-saga-timeout.md:48` does for its own rule — verify-report W2, still
  open.
- **D-fake duplication, named not absorbed** — the new conformance suite carries its own
  minimal Prisma-client fakes rather than sharing a helper with the two adapter suites (a
  shared helper across three suites for one change's evidence would have been drift per its
  own design decision). Recorded as a PR-body residual, not fixed here.
- **Sibling-claim false positive, documented and accepted** — two concurrent claims of
  DIFFERENT backup-code indices for the same user may still collide: one is refused with a
  HIGH alarm it did not earn, the code stays unconsumed, and a retry succeeds. This is an
  availability blip identical to the pre-existing behavior, deliberately NOT engineered
  around (widening scope to remove it would have traded a HIGH security fix's single-concern
  virtue for an availability nicety) — stated in the port contract, the runbook, and this
  report.

## Spec merges (the living-spec state after this archive)

- `openspec/specs/mfa-backup-code-claim/spec.md` — **NEW** capability, byte-identical copy
  of the delta (10 ADDED requirements, 29 scenarios, 8 MERGE-BLOCKING) — mechanical, see the
  orchestrator TODO below.
- `openspec/specs/unified-mfa-service-and-port/spec.md` — **MODIFIED** merge: the
  "Backup-code login parity" requirement strengthens from "the code is marked single-use"
  (satisfied by the defective mark) to the observable single-use GUARANTEE under the
  staggered interleaving, with the adapter claim as SOLE authority and any reported
  remaining-code count read back from post-claim state; port signature stays byte-identical.
  ADDED requirement: the service-level used-index filter is documented as an argon2-cost
  optimisation, never a security control. Both "(Previously: …)" delta annotations were
  removed on merge — the living spec states the current contract only, per this repo's
  living-spec convention.

## Named design deviation — verifier-judged sound

`gateClaimSnapshot` is a test-local seam that apply introduced and design (D6) did not
specify. Design's barrier decorator was planned at the port level for the staggered case
alone; the sibling-index-collision residual (task T5.6) needed a gate BETWEEN the adapter's
snapshot read and its own CAS specifically — a port-level barrier cannot provide that
window, because it would gate the whole claim (snapshot included), letting both racers
simply succeed instead of exercising the collision. `gateClaimSnapshot` is declared once,
inside the integration suite, used once, gates only the `select: { mfaBackupUsedAt: true }`
read that IS the claim snapshot (leaving the count-0 disambiguation read and `findById`
unaffected), and is deterministic via `await gated.snapshotTaken`. Fresh verify (W3)
adjudicated this deviation and judged it SOUND: it delays a read and weakens nothing,
production carries zero seam, and the port-level construction design specified genuinely
cannot produce the sibling-collision scenario the way this one does.

## Post-close corroboration this change itself provided

The §6.1 SQL capture in this change's design phase retroactively settled the atomicity
question the predecessor `password-reset-integrity` change's racer test could corroborate
but not decide on its own: Prisma emits the plain `UPDATE … WHERE (<qual>)` form for
`claimPasswordReset` as well, guaranteeing EvalPlanQual re-evaluation. All three claim sites
in the codebase — backup-code, TOTP, password-reset — are now settled by one piece of
capture evidence rather than three separate arguments.

---

## Orchestrator TODO — mechanical steps (byte-identical copy / move only)

1. **Copy (NEW capability, byte-identical):**
   `openspec/changes/mfa-backup-code-single-use/specs/mfa-backup-code-claim/spec.md`
   → `openspec/specs/mfa-backup-code-claim/spec.md`
   Verify: diff empty / checksum match.
2. **Move (after step 1 and after this report + the living-spec merge edit land):**
   `openspec/changes/mfa-backup-code-single-use/` → `openspec/changes/archive/mfa-backup-code-single-use/`
   Verify: `openspec/changes/mfa-backup-code-single-use/` no longer exists; the archived
   folder contains all original files plus this report, unmodified in content.
