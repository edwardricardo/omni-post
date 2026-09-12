# Tasks: MFA Backup-Code Single-Use — Snapshot-Consistent Pre-Check

> Inputs: `design.md` (D1–D7, §6.1 SQL capture verdict, File Changes, Testing Strategy, PR
> Forecast) · `specs/mfa-backup-code-claim/spec.md` (10 requirements / 29 scenarios) ·
> `specs/unified-mfa-service-and-port/spec.md` (1 MODIFIED + 1 ADDED requirement) ·
> `proposal.md`. Delivery: `auto-chain` / `stacked-to-main`, resolving to **ONE PR** (see
> §Review Workload Forecast).
>
> Every anchor below was re-read against the working tree on 2026-09-11 and is cited at its
> verified line. Where this file corrects a line number carried in an earlier artifact, the
> correction is marked `(verified)`.

---

## 0. Recorded decisions — apply follows these, apply does NOT improvise

These are decided HERE so the apply phase has nothing left to invent.

| #       | Decision                                                                | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence it is the right value                                                                                                                                                                                                                                                                |
| ------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1      | Language of the new alert rule's `summary`                              | **English**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `prometheus/alerts/api.yml:14` and `:26` are English summaries                                                                                                                                                                                                                                |
| L2      | Language of the new alert rule's `description`                          | **Neutral professional Spanish** (no voseo, no regionalism)                                                                                                                                                                                                                                                                                                                                                                                                                                                | `api.yml:15` and `:27` are Spanish descriptions; the file's own header comment at `:2` is Spanish. One sibling (`:27`) uses voseo ("Investigá") — do NOT copy that register; neutral professional per the project Language Domain Contract                                                    |
| L3      | Language of `docs/runbooks/alert-mfa-backup-code-reuse.md`              | **Neutral professional Spanish prose, sibling heading structure**                                                                                                                                                                                                                                                                                                                                                                                                                                          | `docs/runbooks/alert-api-error-rate.md` and `alert-saga-timeout.md` are Spanish prose with mixed ES/EN headings (`## Síntoma`, `## Severidad`, `## Remediation`, `## Links`). The convention is not "mixed or none" — it is consistently Spanish prose, so the English default does not apply |
| L4      | Everything else (code, comments, JSDoc, test names, PR body, this file) | **English**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Project Language Domain Contract                                                                                                                                                                                                                                                              |
| D-alert | `for:` on the new rule                                                  | **Omit it** — the `[15m]` `increase()` window IS the smoothing; a `for:` would double-delay an already-windowed `> 0`. Siblings carry `for: 5m` because their exprs are instantaneous rates. Record the choice in the PR body                                                                                                                                                                                                                                                                              |                                                                                                                                                                                                                                                                                               |
| D-slo   | `slo:` annotation on the new rule                                       | **Omit it** — no SLO document covers `api_security_threats_total`. Siblings carry it because `docs/observability/SLO.md#api` covers theirs                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                                                                                                                                                               |
| D-fake  | Where the conformance suite's Prisma-client fakes live                  | **Inside the conformance suite file.** Design's File Changes creates exactly ONE new test file; extracting a shared fake helper would add a file design did not plan and would churn both adapter suites. Keep the conformance fakes MINIMAL (`findUnique` + `updateMany` with the used-map `equals` predicate only). The resulting duplication with the two adapter suites' `makeFakePrisma` is a **named residual**, recorded in the PR body as a candidate follow-up extraction — not silently absorbed |                                                                                                                                                                                                                                                                                               |

### TDD red protocol (strict TDD is ACTIVE)

Two shapes of RED, and each task states which one it uses:

- **NATURAL RED** — the test is authored BEFORE the production change inside the same work
  unit, run, and observed failing. Used wherever the ordering permits it (WU1, WU3).
- **PLANTED RED** — the test is authored AFTER its production change already landed in an
  earlier work unit. Then the red is DEMONSTRATED: plant the defect (comment out the guard
  under test), run, observe a REAL non-zero failure, restore the tree **byte-exact** verified
  by checksum (`sha256sum` before/after, or `cmp`), re-run, re-confirm green. This is the
  repo's own canon for any new gate (`CLAUDE.md` §Extending the suite, step 3; Edward's
  signed rule "gates nuevos nacen con rojo demostrado"). Used by WU4's static evidence and
  WU5's staggered racer.

A test that was never observed red is not evidence. Record BOTH observations (red output and
green output) per task in the apply-progress artifact.

### Test runners

| Tier                                   | Command                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vitest unit (`apps/api/tests/unit/**`) | `pnpm --filter @apps/api test`                                                                  |
| Single unit file, fast loop            | `pnpm --filter @apps/api exec vitest run <path>`                                                |
| node:test integration                  | `pnpm db:up` first, then `apps/api/scripts/run-tests.sh` (the new batch: `TIER=pr-integration`) |
| Fitness #30                            | the loop verbatim from `CLAUDE.md` §Automated Compliance Checks #30                             |

---

## 1. Non-negotiable guards on every task below

- [x] **G-a — 100% tokenless.** ZERO edits to `.github/workflows/**` (fitness #30's baseline
      literal stays **21**; D4 records the 21→20 measurement as EVIDENCE only). ZERO edits to
      `infra/prisma/schema.prisma` or `infra/prisma/migrations/**`. ZERO `.env*` reads or
      writes. No `omnipost-allow sensitive-edit` token is consumed. If a task appears to need
      one, the task is wrong — STOP and report, do not edit.
- [x] **G-b — writers never run git.** No `git` command, no commit, no push, no PR creation.
      Work-unit boundaries below are commit CANDIDATES for the orchestrator.
- [x] **G-c — canon gate at 0/0 before the work unit is called done.** `pnpm lint
--max-warnings 0` · `tsc` clean · every touched-area fitness check at its threshold ·
      the tiers named in the work unit green. Fix pre-existing errors found in touched files;
      never defer.
- [x] **G-d — JSDoc canon.** Every new file carries `@file` / `@description` / `@layer`
      (fitness #9/#10; tests are `@layer infrastructure`). Every new public method carries
      `@method`/`@param`/`@returns`. No sprint/phase/`§n.n` reference in any comment
      (fitness #8) — and no `// TODO`, `// temporary`, `// workaround`-class marker anywhere
      (pre-edit tripwire blocker).
- [x] **G-e — the double is never weakened.** `InMemoryMfaUserRepository`'s refusal at
      `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts:107-109` (verified) is the
      CONTRACT. Only its comment at `:104-106` changes. Re-stubbing anything un-stubbed is
      prohibited.

---

## WU1 — The claim refuses a replayed code (the security fix)

**Purpose:** both Prisma adapters stop minting a second claim for an index their own snapshot
already carries; the adapter tier and the conformance suite prove it.
**Files:** both adapters, both adapter unit suites, the new conformance suite.
**Parallel:** file-disjoint from WU2 and WU3 — may be authored in any order relative to them,
but WU5 depends on it.

### RED (natural — authored before the fix, observed failing)

- [x] **T1.1** Add to `apps/api/tests/unit/infrastructure/adapters/PrismaCustomerMfaUserRepository.test.ts`,
      inside the existing `describe("markBackupCodeUsed")` (verified at `:304`), a sequential-reuse
      test over the EXISTING honest fake `makeFakePrisma` (`:79-130`, whose `updateMany` at
      `:105-127` evaluates the real `usedAtEqualsMatches` predicate at `:55-68`): seed the row with
      `mfaBackupUsedAt: { "0": T1 }`, call `markBackupCodeUsed("customer-1", 0, T2)` with `T2 !== T1`,
      assert `ALREADY_USED` **and** that `rows.get("customer-1")?.mfaBackupUsedAt` still equals
      `{ "0": T1 }` byte-for-byte. Distinct timestamps are mandatory — an assertion over two equal
      values cannot distinguish "preserved" from "overwritten with the same value".
      _Covers: claim R1 §sequential replay, R2 §existing key never overwritten, R4._
- [x] **T1.2** Author the exact twin in
      `apps/api/tests/unit/infrastructure/adapters/PrismaAdminMfaUserRepository.test.ts` (its
      `describe("markBackupCodeUsed")` is at `:297`, its `makeFakePrisma` twin at the head of the
      file). Same fixture, same assertions, `admin-1` / `adminUser`. No assertion may distinguish the
      two adapters. _Covers: R4 both scenarios._
- [x] **T1.3** Create `apps/api/tests/unit/infrastructure/adapters/mfaUserRepositoryConformance.test.ts`:
      one parametrized suite over THREE implementation factories — the customer adapter over its own
      minimal stateful Prisma-client fake, the admin adapter over its twin fake (see decision
      `D-fake`), and `InMemoryMfaUserRepository`. **Its FIRST assertion is sequential reuse** (spec
      R5 is explicit about the ordering). Then: an unclaimed index is claimed and prior entries stay
      intact; a claimed index is refused and the stored map is unchanged; `NOT_FOUND` for an absent
      subject. No per-implementation exception, no skip, no `.only`. Collected automatically by
      vitest from `tests/unit/**` — **no runner wiring needed or permitted here.**
      _Covers: R5 §same assertions over all three, R9 §doubles fake the client._
- [x] **T1.4 — OBSERVE RED.** Run `pnpm --filter @apps/api test`. T1.1/T1.2 MUST fail with a
      returned `ok` where `ALREADY_USED` is required and an overwritten stored timestamp; T1.3 MUST
      fail for the two adapter parametrizations and PASS for the in-memory double (the double was
      right all along — that asymmetry IS the finding). Record the failure output.

### GREEN

- [x] **T1.5** Insert the D1 pre-check in `apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts`
      **between `:97` and `:98`** (verified: `:96` snapshot, `:97` `normalizeUsedAt`, `:98` the
      unconditional overwrite, `:104-115` the CAS): refuse with `err("ALREADY_USED")` when
      `Object.prototype.hasOwnProperty.call(usedMap, String(codeIndex))`. Use design D1's comment
      verbatim in intent — it must state that the refusal is a claim verdict and that the CAS below
      covers every other interleaving. **The CAS at `:104-115` and the count-0 disambiguation at
      `:116-123` are untouched.**
- [x] **T1.6** Insert the twin in `apps/api/src/infrastructure/adapters/PrismaAdminMfaUserRepository.ts`
      **between `:92` and `:93`** (verified: `:91` snapshot, `:92` `normalizeUsedAt`, `:93` overwrite,
      `:99-110` CAS). Same twin-comment convention the CAS already uses at `:94-98`. Byte-parallel with
      T1.5 apart from the delegate name.
- [x] **T1.7 — OBSERVE GREEN.** Re-run the unit tier. T1.1–T1.3 green, and NO previously-green test
      regressed. _Covers: R1 §sequential replay (unit), R2 §unit, R4, R5._

### Un-stub (evidence integrity — spec R9)

- [x] **T1.8** Un-stub the CONCURRENCY-titled test in the customer suite (verified `:324-342`, its
      hardcoded `updateMany: async () => ({ count: 0 })` at `:333`). Replace the ad-hoc `raceFake`
      with the honest `makeFakePrisma` plus a post-snapshot hook (a `findUnique` wrapper that, after
      returning the snapshot, mutates the stored row — the "concurrent writer"), so the fake's REAL
      predicate computes the zero. **Two acceptance criteria, both mandatory (design-gate Finding 1):** 1. The seeded map MUST NOT carry the claimed index at snapshot time — only the post-snapshot
      hook introduces it. Note the current fixture seeds `{ "0": … }` and claims index `0`
      (`:329`), so a naive un-stub would be refused by the D1 pre-check BEFORE the CAS runs and
      would go green for the WRONG reason. Seed a map that lacks the claimed index. 2. The test MUST assert the fake's `updateMany` actually executed (a call counter, asserted
      `=== 1`). Without it, "the predicate was evaluated" is an unverified claim.
- [x] **T1.9** Un-stub the admin twin (verified `:317-335`, hardcoded `{ count: 0 }` at `:326`) under
      the identical two criteria.
- [x] **T1.10** Verify — **no edit expected** — that the "row vanished between the snapshot read and
      the CAS write" tests (customer `:344-363`, admin `:337-356`) still exercise their intended
      NOT_FOUND-disambiguation branch after T1.5/T1.6: they seed `mfaBackupUsedAt: {}` and claim index
      `0`, so the pre-check does not fire and control still reaches the CAS. Their hardcoded
      `{ count: 0 }` is OUT of spec R9's scope (R9 names "the two adapter tests titled for
      concurrency"). If the verification shows otherwise, STOP and report — do not silently rewrite a
      test outside the spec's scope.
- [x] **T1.11 — mutation proof for the conformance suite (spec R5 §permissive implementation).**
      Planted red: remove ONE implementation's refusal (e.g. comment out the T1.5 pre-check), run the
      conformance suite, observe THAT implementation fail; restore byte-exact (checksum verified);
      re-run green. Record both observations. _Covers: R5 §an implementation that stops refusing
      turns the suite red, R9 §un-stubbed concurrency tests evaluate the real predicate._

**Work-unit exit:** unit tier green, lint/tsc 0/0, fitness #3/#5/#8/#9/#10 unchanged.

---

## WU2 — Contract truth: the port documents the guarantee, the double stops lying

**Purpose:** the written contract stops describing a mechanism a conformant-but-exploitable
adapter could satisfy. Doc-only; no behaviour changes.
**Files:** `packages/ports/src/MfaUserRepositoryPort.ts`, `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts`.
**Parallel:** fully independent of WU1 and WU3 — safe in any order.

- [x] **T2.1** Replace the `markBackupCodeUsed` JSDoc at `packages/ports/src/MfaUserRepositoryPort.ts:96-112`
      (verified; the method signature is `:113-117`) with design §Interfaces' replacement text. It
      MUST state: at most ONE caller ever receives Ok for a given `(userId, codeIndex)` under
      sequential replay and every concurrent interleaving; an existing claim is immutable;
      `ALREADY_USED` means the code is already consumed and the caller MUST reject and MUST NOT
      retry; `NOT_FOUND` when the user is gone. It MUST describe **no** compare-and-swap, **no**
      snapshot, and **no** column encoding — the current text names all three (`:99-103` says
      "Compare-and-swap on the used-map snapshot", `:109` says "a concurrent writer won the
      compare-and-swap"). _Covers: unified R3 all three scenarios._
- [x] **T2.2** The same JSDoc states the sibling-claim residual: a refusal MAY be a concurrent claim
      of a DIFFERENT index for the same user, in which case the code is NOT consumed and a fresh
      user-initiated verification succeeds — while THIS attempt is still rejected.
      _Covers: claim R10 §the residual is stated where an operator will meet it (contract leg)._
- [x] **T2.3** Assert the signature is byte-identical: parameter list and return type at `:113-117`
      unchanged, and `tsc` clean across the workspace with **zero** call-site edits. ~25 existing
      `new MfaService(` / `markBackupCodeUsed(` consumers must compile untouched. _Covers: R3
      §the signature is unchanged._
- [x] **T2.4** Correct `apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts:104-106` (verified):
      the comment currently claims to "Mirror the Prisma adapter's compare-and-swap single-use" and
      frames the refusal as losing a race. Rewrite it to name the CLAIM contract the double
      implements (an index already present was consumed; the caller must reject). **The refusal at
      `:107-109` and the write at `:110` are byte-untouched** — verify by diffing only the comment
      block. _Covers: R5 §the double no longer asserts a false mirror._

**Work-unit exit:** `tsc` 0 errors, lint 0/0, unit tier still green, no behavioural diff.

---

## WU3 — The service treats the claim as the sole authority and alarms on every refusal

**Purpose:** D2 (post-claim read-back), D3 (filter demoted to a cost optimisation; emission
not cause-gated), D5 (metric). All three live in one ~40-line region of
`verifyMfaToken`, so they are ONE work unit — splitting them would produce two commits
editing the same hunk.
**Files:** `apps/api/src/admin/auth/MfaService.ts`, `apps/api/src/infrastructure/container/setupServices.ts`,
`apps/api/tests/unit/unifiedMfaService.test.ts`.

### RED (natural)

- [x] **T3.1** In `apps/api/tests/unit/unifiedMfaService.test.ts`, thread an optional metrics spy
      through `makeHarness()` (verified `:63-69`, currently `new MfaService(adminRepo, customerRepo,
audit)`): because `metrics` is the LAST constructor param it is reached as
      `new MfaService(adminRepo, customerRepo, audit, undefined, metricsSpy)`. Shape the spy like the
      existing precedents — `{ metrics: { securityThreats: { inc: vi.fn() } } }`
      (`apps/api/tests/unit/infrastructure/adapters/RedisBruteForceAdapter.test.ts:132`,
      `apps/api/tests/unit/fileUploadValidator.test.ts:46`).
- [x] **T3.2** Author the service unit scenarios (RED): - a refused claim returns the invalid-token verdict, never `verified`, never a database error
      — reuse the existing `RaceLosingMfaUserRepository` double at `:50-54`; - **a refusal that never reached a write still alarms**: the HIGH `MFA_BACKUP_CODE_REUSE_REJECTED`
      event AND `securityThreats.inc({ threat_type: "mfa_backup_code_reuse", endpoint: "mfa_verify" })`
      are emitted exactly as for a refusal produced by a lost write; - **the emitted event carries no secret material**: no TOTP secret, no backup code, no code hash
      — assert over the recorded audit payload, not over a mock call list; - **the audited remaining count reflects post-claim state**: a subject whose used-map CHANGES
      between the deciding read at `MfaService.ts:199` and the claim at `:240` — the audited
      `remainingCodes` must match what the claim persisted, not what the pre-verification snapshot
      implied; - **the guarantee survives the filter being removed**: a harness mutation that neuters the
      used-index filter leaves the verdicts unchanged (already-claimed code rejected).
      _Covers: unified U1 §refused claim never reports verified + §audited remaining count, U2 both
      scenarios, claim R6 §a refusal that never reached a write still alarms + §no secret material,
      R7 §counter increments._
- [x] **T3.3 — OBSERVE RED.** Run the unit tier; record which assertions fail and why (the metric
      does not exist yet; `remaining` is computed at `:232` from the pre-verification snapshot).

### GREEN

- [x] **T3.4** Add the optional LAST constructor param `metrics?: ApiMetrics` to `MfaService`
      (constructor verified at `:88-95`, after `unitOfWork` at `:92`). **This introduces NO DI token
      and NO container registration** — design-gate Finding 2: spec R3's "no DI change" is
      port-scoped, and the composition root passes the ALREADY-registered `TOKENS.ApiMetrics`
      (`types.ts:188`, registered in `setup.ts:82`). Do NOT invent a token. Update the class JSDoc at
      `:77-83` to name the new optional collaborator.
- [x] **T3.5** In `apps/api/src/infrastructure/container/setupServices.ts`, pass
      `container.resolve<ApiMetrics>(TOKENS.ApiMetrics)` as the fifth argument of the `MfaService`
      construction (verified `:193-203`, args at `:196-201`). The `ApiMetrics` type is already
      imported at `:71` — no new import expected.
- [x] **T3.6 — D5 metric.** At the refusal site (verified `:261-269`, inside the
      `markResult.error === "ALREADY_USED"` branch), emit
      `this.metrics?.metrics.securityThreats.inc({ threat_type: "mfa_backup_code_reuse", endpoint: "mfa_verify" })`
      alongside the existing HIGH audit. Label names match the counter's declaration
      (`apps/api/src/metrics/apiMetrics.ts:329-334`, `labelNames: ["threat_type", "endpoint"]`).
      **The emission must NOT branch on which interleaving or which mechanism produced the refusal** —
      it branches only on the claim's verdict. _Covers: R6 §emission is not gated on the refusal's
      cause (static), R7 §counter increments._
- [x] **T3.7 — D2 read-back.** Inside the same `runInTransaction` callback (verified `:239-253`),
      AFTER the `isErr(markResult)` guard at `:245` and BEFORE the audit at `:246`, re-read via
      `repo.findById(subject.id)` and compute
      `remaining = mfaBackupCodes.length − Object.keys(mfaBackupUsedAt).length`. Delete the stale
      pre-transaction computation at `:232`. **`exactOptionalPropertyTypes` is on**: when the in-tx
      re-read errs (row gone mid-transaction — unreachable in practice), the audit OMITS
      `remainingCodes` via conditional spread rather than reporting a stale number. The `audit`
      helper's `details?: Record<string, unknown>` param (verified `:525-532`) accepts the spread
      directly.
- [x] **T3.8 — D3 filter re-comment.** The used-index filter at `:226-228` SURVIVES as a `continue`.
      Rewrite its surrounding comment (the current block at `:233-237` frames the mark as the control
      and the filter as implicit) so it states: this skip is an **argon2-cost optimisation** (up to 8
      serial verifies at m=64MiB, t=3, p=4) and the ADAPTER CLAIM is the authority for single-use.
      It must NOT describe itself as preventing reuse. Also update the `verifyMfaToken` JSDoc at
      `:184-192` ("marks that code single-use") to the claim wording. _Covers: U2 §the filter is
      documented as cost, not control._
- [x] **T3.9 — OBSERVE GREEN.** Unit tier green; the ~25 untouched `new MfaService(` call sites still
      compile (`tsc` clean).

**Work-unit exit:** unit tier green, lint/tsc 0/0, fitness #13/#14/#16 unaffected.

---

## WU4 — The refusal is operationally visible (alert + runbook)

**Purpose:** ADR-0015 precedent — a signal nobody alerts on is a signal that goes silent.
Config + docs only; its own work unit so an alert can be reverted without reverting the
metric.
**Files:** `prometheus/alerts/api.yml`, `docs/runbooks/alert-mfa-backup-code-reuse.md` (new).
**Depends on:** WU3 (the `threat_type` label value must already be final).

- [x] **T4.1** Append ONE rule to the existing `api` group in `prometheus/alerts/api.yml` (verified:
      group `api` at `:4`, `interval: 30s` at `:5`, rules from `:6`):
      `alert: MfaBackupCodeReuseRejected`,
      `expr: increase(api_security_threats_total{threat_type="mfa_backup_code_reuse"}[15m]) > 0`,
      `labels: severity: warning` + `component: api`,
      annotations `summary` (**English** per L1), `description` (**neutral professional Spanish** per
      L2), `runbook: docs/runbooks/alert-mfa-backup-code-reuse.md`. Omit `for:` (D-alert) and omit
      `slo:` (D-slo). Severity is `warning`, not `critical`, even though the audit event is HIGH —
      the sibling-claim false positive is a documented non-incident, and the threshold is tuned HERE,
      never suppressed in code.
- [x] **T4.2** Create `docs/runbooks/alert-mfa-backup-code-reuse.md` following the sibling structure
      (`# Runbook — \`MfaBackupCodeReuseRejected\``, `> Alert:`pointer back to the rule,`## Síntoma`,
`## Severidad`, `## Diagnóstico`, `## Remediation`, `## Cuándo escalar`, `## Links`), prose in
      **neutral professional Spanish** per L3. It MUST state two things an operator would otherwise
      re-derive from source:
  1. **The broadened volume profile** (design D3): the HIGH stream widens from "lost a concurrent
     write" to "every refusal the adapter returns" — the staggered attack, racing reuse, and
     stale-snapshot replays. Fresh-snapshot sequential replays stay filtered at the service and
     end as `MFA_VERIFICATION_FAILED` (MEDIUM), so steady-state volume stays near zero and any
     sustained firing is signal. 2. **The accepted sibling-claim false positive** (claim R10): two concurrent claims of DIFFERENT
     indices for the same user may collide; the loser is refused and alarms without earning it,
     the code is NOT consumed, and **a user retry is the correct response** — an availability
     blip, never a lost credential. It exists identically before this change.
- [x] **T4.3** Verify the two point at each other: the rule's `runbook:` annotation resolves to the
      new file, and the runbook's `> Alert:` pointer resolves to `prometheus/alerts/api.yml`. Confirm
      exactly ONE new rule watches this series (no second rule anywhere under `prometheus/alerts/`).
      _Covers: R7 §one alert rule and one runbook exist and point at each other, R10 §residual stated
      (runbook leg)._
- [x] **T4.4 — PLANTED RED for the static pair.** This work unit has no test runner, so its red is
      the pointer check itself: temporarily point the `runbook:` annotation at a nonexistent path,
      run T4.3's verification, observe it report the broken pointer, restore byte-exact (checksum
      verified). A verification that cannot fail is not a verification.

**Work-unit exit:** YAML parses (`promtool check rules prometheus/alerts/api.yml` if available;
otherwise a YAML parse is sufficient and the gap is reported, not hidden), markdown lint clean.

---

## WU5 — Tier 3: the staggered proof, repaired, deterministic, and WIRED

**Purpose:** only a real Postgres row decides atomicity, and a proof that never runs is not a
proof. **The new `run_batch` lands in THIS work unit, in the same commit as the suite it
names** — an unwired suite reads as coverage while never executing.
**Files:** `apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts`,
`apps/api/scripts/run-tests.sh`.
**Depends on:** WU1 (pre-check) + WU3 (metric/alarm). Requires `pnpm db:up`.

- [x] **T5.1 — repair: distinct timestamps.** The existing adapter-level racer at `:95-99` (verified)
      hands BOTH racers the SAME `usedAt` (`new Date("2026-04-04T10:00:00.000Z")`), so its
      `deepStrictEqual` at `:107` cannot distinguish "preserved" from "overwritten with the same
      value" and would pass under the defect. Give each attempt a DISTINCT pinned timestamp and
      assert the STORED value is the WINNER's and that the loser's value appears nowhere in the row.
      _Covers: R2 §the stored timestamp survives + §the racers present distinguishable timestamps._
- [x] **T5.2 — repair: real Unit of Work.** The service-level racer builds
      `new MfaService(adminRepo, customerRepoLocal, auditRepo)` at `:118` (verified) with NO UoW, so
      it never exercises the transaction D2's read-back lives in. Construct it with a real
      `PrismaUnitOfWork` and a metrics spy (fifth arg). Keep the existing simultaneous-racer
      assertions at `:132-146`. _Covers: R1 §simultaneous racers still yield exactly one success._
- [x] **T5.3 — D6 staggered racer (the whole subject).** Add the deterministic staggered test. No
      production seam: build racer B's `MfaService` over a test-local `BarrierMfaUserRepository`
      implementing `MfaUserRepositoryPort`, delegating every method to the real Prisma adapter except
      `markBackupCodeUsed`, which first awaits a gate promise and then substitutes a pinned,
      clearly-distinct `usedAt` sentinel. Racer A runs undecorated. Sequence: start both → B's
      deciding read (`MfaService.ts:199`) resolves pre-commit and passes the service filter → B blocks
      at the claim → A's `verifyMfaToken` resolves (claim committed) → capture the winner's stored
      timestamp → release the gate → B's adapter snapshot now carries the index → the D1 pre-check
      refuses → B gets the invalid-token verdict. **Deterministic — never timing luck.**
      Assertions are against the STORED ROW and the minted-session count, **never** against which
      methods a double recorded (this red fails by SUCCEEDING TWICE — a green-looking red).
      _Covers: R1 §staggered racers yield exactly one success, U1 §one code two staggered logins one
      session._
- [x] **T5.4 — refused claim changes nothing.** Fold into T5.3's assertions (same pair, same row):
      after both complete, reading the row back yields a used-map byte-identical to the winner's and
      no other column of the row changed. _Covers: R1 §a refused claim changes nothing in the row._
- [x] **T5.5 — alarm + metric on the attack.** Assert that the staggered loser produced a HIGH
      `MFA_BACKUP_CODE_REUSE_REJECTED` audit row for that subject AND that the security-threat
      counter incremented. _Covers: R6 §the staggered attack raises the alarm and the metric._
- [x] **T5.6 — sibling residual.** Add the residual test: two concurrent verifications of DIFFERENT
      backup codes for the same user; when one is refused, the refused caller's RETRY succeeds, and
      the index it claims was absent from the stored map between the two attempts. This test DOCUMENTS
      the residual — it must not be turned into a fix. _Covers: R10 §a spuriously refused sibling
      claim consumes nothing._
- [x] **T5.7 — D7 wiring, SAME work unit.** Add to `apps/api/scripts/run-tests.sh`, in the DB-only
      section (after the `integration:customer-auth` batch at `:297-304`, before the
      `integration:saga-recovery` batch at `:306-317` — all verified):
      `CONCURRENCY=1 run_batch "integration:mfa-backup-single-use" tests/integration/mfaBackupCodeSingleUse.integration.test.ts`
      with a comment stating WHY it is its own batch at `CONCURRENCY=1`: its cases race the SAME
      credential on purpose, so a sibling suite sharing the runner would make which statement won
      ambiguous — the same rationale `integration:customer-auth` states in-file at `:299-302`.
      **EXACTLY ONE file is wired.** The four sibling orphan MFA suites stay SMELL-75 and MUST NOT be
      wired here. _Covers: R8 §the file is named by exactly one batch._
- [x] **T5.8 — PLANTED RED for the staggered racer.** The pre-check already landed in WU1, so the red
      is demonstrated, not assumed: comment out the D1 pre-check in BOTH adapters, run the new batch,
      observe the staggered test fail **with TWO successes and two sessions**, restore both files
      byte-exact (checksum verified), re-run, re-confirm green. Record both outputs.
      _Covers: R9 §the staggered scenario is RED before the change._
- [x] **T5.9 — OBSERVE the wired suite executes.** Run `pnpm db:up`, then the batch via
      `apps/api/scripts/run-tests.sh` (`TIER=pr-integration`). Confirm a NON-ZERO collected count (a
      zero-collection run parses as success — the exact failure mode fitness #31 exists for) and a
      green result. On LXC, run heap-capped under a `timeout` wrapper per repo convention.
      _Covers: R8 §the wired suite executes and passes in CI._

**Work-unit exit:** the new batch green with non-zero collected tests; no sibling batch reddened;
`tsc` + lint 0/0.

---

## WU6 — Evidence and the PR body

**Purpose:** the measurements the spec requires recorded, and the statements the PR body must
carry. No source edits.
**Depends on:** WU5.

- [x] **T6.1 — fitness #30 measurement.** Run check #30 verbatim from `CLAUDE.md`. Record BOTH
      numbers: the pre-change count (expected **21**, the documented baseline) and the post-change
      count (expected **20**), and NAME the file that left the list
      (`apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts`). If the pre-change
      count is not 21, STOP and report the divergence — do not adjust anything to fit.
      _Covers: R8 §the unreached count falls by exactly one._
- [x] **T6.2 — D4 residual, recorded not absorbed.** Confirm `.github/workflows/fitness.yml` is
      **untouched** and its #30 ratchet baseline literal still reads **21**. State in the PR body
      that the measured count is 20, that the literal is deliberately NOT tightened (a workflow edit
      needs a token; this change is token-free), and that tightening belongs to the next slice that
      edits that file. The gate's rule holds: the count may fall and must never rise.
- [x] **T6.3 — PR body content** (the orchestrator creates the PR; this task produces the TEXT): - the two-tier **CODE / EVIDENCE split, measured** (not estimated) with both numbers and the
      note that EVIDENCE is pre-approved as ONE declared budget; - the **§6.1 SQL capture verdict**: all three claim shapes are plain single-statement
      `UPDATE … WHERE qual` (no `IN (SELECT …)`), so EvalPlanQual re-evaluates the qual under Read
      Committed and the CAS is sound — one capture retro-validating `claimTotpStep` and
      `claimPasswordReset` too, and the note that **Read Committed is load-bearing for both halves**
      (EPQ re-evaluation AND the pre-check's committed-state premise), so an isolation-level change
      reopens the verdict; - the **broadened HIGH volume profile** (design D3) — stated in the PR body, not only in the
      runbook (design-gate Finding 5); - the **sibling-claim false positive** — same: PR body, not only the runbook and the contract; - the **D4 residual** from T6.2; - the **`D-fake` duplication residual**: the conformance suite carries its own minimal client
      fakes; a shared-helper extraction is a named follow-up candidate, not silently absorbed; - the **out-of-scope fence**: P-2 (admin password-reset race) stays SMELL-97; the four sibling
      orphan MFA suites stay SMELL-75; the class fitness function is DEFERRED and paired with
      SMELL-97's slice (Edward's decision (b)); `codeIndex` positional remodelling and G4–G8 /
      G13–G15 stay out; - **rollback**: a single revert of one PR — no migration, no schema change, no data movement,
      port signature unchanged; reverting the `run-tests.sh` line restores the prior collector state.
- [x] **T6.4 — final canon gate at 0/0** before declaring the change ready: `pnpm lint
--max-warnings 0`, `tsc`, the unit tier, the new integration batch, and fitness #8/#9/#10/#30.
      Report any pre-existing failure found — never defer it as "already there".

---

## Requirement → task traceability

### `mfa-backup-code-claim` (10 requirements, 29 scenarios)

| Requirement                                              | Scenarios | Tasks                                                                               |
| -------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| R1 Claimed at most once, every interleaving **[MB]**     | 4         | T5.3 (staggered), T5.2 (simultaneous), T1.1/T1.2 (sequential), T5.4 (row unchanged) |
| R2 Winner's timestamp immutable **[MB]**                 | 3         | T1.1/T1.2 (unit), T5.1 (stored survives + distinguishable)                          |
| R3 `ALREADY_USED` names state, not a race **[MB]**       | 3         | T2.1, T2.3                                                                          |
| R4 Both adapters identical claim semantics **[MB]**      | 2         | T1.2, T1.6, T1.3                                                                    |
| R5 One conformance suite, three implementations **[MB]** | 3         | T1.3, T1.11, T2.4                                                                   |
| R6 Alarm reachable BY the attack **[MB]**                | 4         | T3.2, T3.6, T5.5                                                                    |
| R7 Refusal operationally visible                         | 2         | T3.2/T3.6 (counter), T4.1–T4.3                                                      |
| R8 Integration proof executes in CI **[MB]**             | 3         | T5.7, T5.9, T6.1                                                                    |
| R9 Evidence not satisfiable by a masking double **[MB]** | 3         | T1.3, T1.8, T1.9, T1.11, T5.8                                                       |
| R10 Sibling residual documented, not engineered around   | 2         | T5.6, T2.2, T4.2, T6.3                                                              |

### `unified-mfa-service-and-port` (delta)

| Requirement                                                | Scenarios | Tasks                           |
| ---------------------------------------------------------- | --------- | ------------------------------- |
| U1 Backup-code login parity **[MB]** (MODIFIED)            | 7         | T3.2, T3.7, T5.2, T5.3          |
| U2 Used-index filter is cost, not control **[MB]** (ADDED) | 2         | T3.2 (mutation), T3.8 (comment) |

### Design decision → task

| Decision                                                                                 | Tasks                        |
| ---------------------------------------------------------------------------------------- | ---------------------------- |
| D1 pre-check duplicated in both adapters (twins, not extracted)                          | T1.5, T1.6                   |
| D2 `remaining` re-read post-claim, in-transaction, conditional spread on error           | T3.7, T3.2                   |
| D3 emission site unchanged; `:226-228` filter survives as a documented cost optimisation | T3.6, T3.8                   |
| D4 fitness #30 baseline literal stays 21; 21→20 is evidence                              | T6.1, T6.2                   |
| D5 optional LAST `metrics?` param (no token), one alert, one runbook                     | T3.4, T3.5, T3.6, T4.1, T4.2 |
| D6 test-local barrier decorator as the stagger seam                                      | T5.3                         |
| D7 one new dedicated `run_batch`, exactly one file                                       | T5.7                         |

---

## Review Workload Forecast (two-tier rule, signed 2026-09-10)

    Decision needed before apply: No
    Chained PRs recommended: No
    400-line budget risk: Low

**Single PR.** `delivery_strategy: auto-chain`, `chain_strategy: stacked-to-main` — with one
slice, the chain resolves to one PR to main, six work-unit commits.

### CODE (hard budget 400 — canon-mandated JSDoc COUNTS as CODE, refinement of 2026-09-12)

| File                                                                                  | Est. changed (add + del)                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `PrismaCustomerMfaUserRepository.ts` (D1 pre-check + comment)                         | ~8                                              |
| `PrismaAdminMfaUserRepository.ts` (twin)                                              | ~8                                              |
| `packages/ports/src/MfaUserRepositoryPort.ts` (JSDoc rewrite, both sides of the diff) | ~40                                             |
| `MfaService.ts` (param + metric + read-back + two comment rewrites + JSDoc)           | ~45                                             |
| `setupServices.ts` (one argument)                                                     | ~3                                              |
| `InMemoryMfaUserRepository.ts` (comment only)                                         | ~7                                              |
| `prometheus/alerts/api.yml` (one rule)                                                | ~14                                             |
| `docs/runbooks/alert-mfa-backup-code-reuse.md` (new)                                  | ~50                                             |
| `apps/api/scripts/run-tests.sh` (batch + rationale comment)                           | ~6                                              |
| **CODE total**                                                                        | **~181–215; design's conservative ceiling 260** |

Well under 400 under either reading. **Risk: Low.**

### EVIDENCE (pre-approved by Edward at ~450–600 as ONE declared budget)

| Tier                                                                        | Est. changed |
| --------------------------------------------------------------------------- | ------------ |
| Tier 1 — two adapter suites: reds + un-stub + fake hook                     | ~165         |
| Tier 2 — conformance suite (new, self-contained fakes per `D-fake`)         | ~180         |
| Tier 3 — integration repair + staggered racer + residual + alarm assertions | ~230         |
| Service unit scenarios in `unifiedMfaService.test.ts`                       | ~95          |
| **EVIDENCE total**                                                          | **~560–670** |

**Stated honestly rather than trimmed to fit:** this itemisation runs at the top of, and
plausibly ~10% above, the declared 450–600 band — mostly because design's Tier-1 estimate
(~120) did not carry the un-stub's delete side, and because the service-level unit scenarios
were not itemised separately. EVIDENCE is a pre-approved budget, not a hard cap, so this does
NOT gate apply and does not reopen a decision. Two obligations follow instead:

1. apply reports the **measured** split in the PR body (T6.3), never the estimate;
2. if measured EVIDENCE exceeds **700**, apply STOPS and reports rather than deleting
   assertions to fit — trimming evidence to hit a budget is exactly the failure this
   capability exists to retire.

---

## Risks and residuals carried into apply

| Risk                                                                                                                                               | Mitigation / owner                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The un-stub goes green for the WRONG reason (D1 pre-check refuses before the CAS runs, because the current fixture seeds the very index it claims) | T1.8/T1.9's two mandatory acceptance criteria — seed WITHOUT the claimed index, and assert `updateMany` executed. This is design-gate Finding 1 and is the single most likely silent failure in the change |
| apply invents a DI token for `ApiMetrics`                                                                                                          | T3.4 states it explicitly: optional LAST param, no token, no registration; the composition root passes the already-registered `TOKENS.ApiMetrics` (design-gate Finding 2)                                  |
| The staggered racer's red is assumed rather than observed (the fix lands first)                                                                    | T5.8's planted red with byte-exact checksum restore — the repo's own canon for a new gate                                                                                                                  |
| A test authored after its fix is vacuous                                                                                                           | Every such task pairs with a planted-red demonstration (T1.11, T4.4, T5.8)                                                                                                                                 |
| EVIDENCE overshoot (see forecast)                                                                                                                  | Reported, not trimmed; hard stop at 700                                                                                                                                                                    |
| Conformance-suite fake duplicated across three files                                                                                               | Accepted per `D-fake`, named in the PR body as a follow-up extraction candidate                                                                                                                            |
| Wiring the orphan reddens siblings                                                                                                                 | Exactly ONE file wired (T5.7); the four sibling orphans stay SMELL-75                                                                                                                                      |
| Read Committed is load-bearing for BOTH halves of the mechanism                                                                                    | Stated in the PR body (T6.3) so a future isolation-level change reopens the verdict rather than silently invalidating it                                                                                   |
| Sibling-claim false positive fires a HIGH the caller did not earn                                                                                  | Documented in three places (contract T2.2, runbook T4.2, PR body T6.3); deliberately NOT engineered around                                                                                                 |
