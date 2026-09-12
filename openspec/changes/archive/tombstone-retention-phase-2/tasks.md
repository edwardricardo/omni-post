# Tasks: tombstone-retention-phase-2 (SMELL-88) — ALL 39 IMPLEMENTED

> Materialized from Engram `sdd/tombstone-retention-phase-2/tasks` (obs 693, rev 4).
> POST-MATERIALIZATION NOTE: the "OPEN BLOCKER" below (A″, the env quoting) was
> subsequently RESOLVED — a second Edward-authorized token window single-quoted the ring in
> all four `/.env` files, after which the full integration tier ran 506/506 (0 fail/cancel/
> skip) and both PRs shipped (#250 `dbf46d69`, #252 `f3ffe9b6`).

Authority: spec obs 690 **as amended by design rev 3's SPEC AMENDMENT section**. Design obs 691 rev 3 = mechanisms (D1-D8). Strict TDD. Writers never run git. English artifacts.

> **APPLY NOTE.** Branch `workstream/tombstone-retention-phase-2` off `origin/main @ dd137f2a`. Every line reference below was re-verified against the real tree and still matched. Full evidence: obs `sdd/tombstone-retention-phase-2/apply-progress`.

> **DELIVERY (Edward).** TWO chained PRs at the WU4/WU5 seam: **PR-A = WU1-4** (+WU7 moved in by the verify gate's flag-4 ruling), **PR-B = WU5-9**. Edward accepted PR-A's CODE by choosing the split.

> **OPEN BLOCKER (RESOLVED — see header).** Four `.env*` files needed their ring value re-quoted with SINGLE quotes (one line each).

---

## Review Workload Forecast — MEASURED

| Field                   | Forecast                           | Measured                                                                            |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| CODE PR-A (WU1-4)       | ~325-340 vs hard 400               | **625** (+24 with WU7 = 649; accepted via the split)                                |
| CODE PR-B (WU5-9)       | ~119 vs its own hard 400           | **281** (257 post-WU7-move) — UNDER                                                 |
| EVIDENCE whole change   | band 1180-1600, hard stop **1840** | **1860 — EXCEEDS the hard stop by 20; reported, never trimmed; RATIFIED by Edward** |
| 400-line budget risk    | Medium                             | REALISED, resolved by the split                                                     |
| Chained PRs recommended | No                                 | **Yes (revised at apply)**                                                          |

```text
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: chained (PR-A = WU1-4+WU7, PR-B = WU5-6, WU8-9)
400-line budget risk: Medium
```

### DECISION 1 — the generator is EVIDENCE, not CODE

`apps/api/scripts/generate-unicode-fold-table.ts` (delivered **326** lines) is EVIDENCE: it never ships (no runtime path imports it), and its trust comes from the regenerate-and-diff gate plus sha256 input pins, not from reviewer line-reading. The honest counter-argument stands — a generator bug mints a wrong table, and the diff gate proves only generator==table — which is why the real correctness evidence is the known-answer vectors running against the REAL generated tables.

### DECISION 2 — the EVIDENCE band

~1180-1600, hard stop 1840. **Measured 1860.** The overshoot is entirely in PR-B's two new suites (degrader 435, integration 272) and SECRETS.md §3a (65) — all itemised in the plan; the band's high end simply sat under what the itemisation produced.

### Work units

| Unit | PR                         | Goal                                                    | Focused command                                                                              | Runtime harness                                    |
| ---- | -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1    | A                          | Pinned UCD 17.0.0 tables + generator + offline gate     | `pnpm --filter @apps/api exec vitest run tests/unit/security/nameDigestUnicodeTable.test.ts` | N/A                                                |
| 2    | A                          | Canonicalisation + vectors + ICU canary floor           | `... nameDigestCanonicalize.test.ts`                                                         | N/A                                                |
| 3    | A                          | MAC, frozen ring parameters, verifier                   | `... nameDigest.test.ts`                                                                     | N/A                                                |
| 4    | A                          | Key-ring env contract (**TOKEN unit**)                  | `... tests/unit/config/nameDigestRing.test.ts`                                               | boot refusal on a gapped ring                      |
| 5    | B                          | Degrader service + unit suite                           | `... tests/unit/retention/DeletionRecordDegrader.test.ts`                                    | N/A — real DB proof is unit 8                      |
| 6    | B                          | DI token, daily tick, tick-scope floor, gauge honesty   | `... tests/unit/bootstrap/schedulerTickTenantScope.test.ts`                                  | tick registered once, torn down by `shutdownAll()` |
| 7    | A (moved by verify ruling) | secretCatalog MAC category + admin union arm            | `... tests/unit/domain/security/secretCatalog.test.ts`                                       | N/A                                                |
| 8    | B                          | Integration: drain, flag-exclusion, rotation round-trip | **`cd apps/api && TIER=pr-integration bash scripts/run-tests.sh`** (corrected — see 8.5)     | seeded back-dated rows → gauge 0                   |
| 9    | B                          | Docs + 5 backlog rows                                   | markdown only                                                                                | N/A                                                |

---

## Phase 1: Pinned Unicode tables (WU1) — COMPLETE (PR-A)

- [x] 1.1 **RED (natural).** `nameDigestUnicodeTable.test.ts`: sha256 pin per vendored input + regenerate-and-diff against the committed module.
- [x] 1.2 Vendor UCD **17.0.0** CaseFolding / PropList / extracted/DerivedGeneralCategory; sha256 recorded in the generator.
- [x] 1.3 `apps/api/scripts/generate-unicode-fold-table.ts` — statuses **C+F only (T excluded)**, `Cn` ranges, `White_Space=Yes`; canon header + generated banner.
- [x] 1.4 `unicodeData.generated.ts` (2402 lines) + `linguist-generated=true` in `.gitattributes` (also `linguist-vendored=true` for `apps/api/ucd/**`).
- [x] 1.5 **RED (planted) ×2** — generated module and vendored input, each restored byte-exact (`cmp`).

## Phase 2: Canonicalisation (WU2) — COMPLETE (PR-A)

- [x] 2.1 **RED (natural).** `nameDigestCanonicalize.test.ts` against the REAL generated tables.
- [x] 2.2 SAME-digest vectors incl. `U+FB01`→`fi`, final sigma (the `toLowerCase` discriminator), `U+0345` ccc=240 reorder, whitespace.
- [x] 2.3 DISTINCT vectors (fullwidth, superscript) + the `U+05FF` flag vector.
- [x] 2.4 **Canary, two parts** — normalization OUTPUTS, and a numeric `[major, minor]` floor ≥ 17.0 with an existence assert.
- [x] 2.5 `canonicalizeName.ts` — frozen order, ok/flag union, all-whitespace → empty bytes.
- [x] 2.6 **RED (planted)** — floor raised to 99.0, restored byte-exact.

## Phase 3: MAC and verifier (WU3) — COMPLETE (PR-A)

- [x] 3.1 **RED (natural).** `nameDigest.test.ts` — framing, known answers, ambiguity pair, verify true/false/wrong-pin.
- [x] 3.2 `ringParameters.ts` — frozen generation 1.
- [x] 3.3 `nameDigest.ts` — SP 800-185 framing, HMAC-SHA-256 full 32 bytes, `verifyNameDigest(ring, name, row)` resolving ONLY from the row's pin, `timingSafeEqual` (precedent `packages/api-common/src/webhookSignature.ts:97`).

## Phase 4: Key-ring env contract (WU4) — COMPLETE (PR-A)

- [x] 4.1 **RED (natural).** `nameDigestRing.test.ts` — every refusal NAMES the offending version; happy parse to `ReadonlyMap<number, Buffer>`.
- [x] 4.2 `env.ts` — ring REQUIRED with no default, pointer `z.coerce.number().int().min(1).default(1)`. Shape parsing lives in the new `apps/api/src/security/nameDigest/keyRing.ts` (deviation 1).
- [x] 4.3 Cross-field interlock added to the EXISTING `createFinalSchema` superRefine.
- [x] 4.4 `scripts/ci-setup-test-env.sh` — derived, not literal. **CONFIRMED TOKENLESS.** Emits the SINGLE-quoted form.
- [x] 4.5 **TOKEN TASK — executed.** FOUR files, not two (`pre_edit.py` holds `"/.env"`). The follow-up quoting defect (A″) was resolved by a second token window (see header).

## Phase 5: Degrader service (WU5) — COMPLETE (PR-B)

- [x] 5.1 **RED (natural).** Fake Prisma honouring the real predicate; ONE guarded `updateMany` per row; `take:100`, `orderBy:[{retainUntil:"asc"},{id:"asc"}]`.
- [x] 5.2 **RED (natural).** Flag/fail exclusion set; normal rows behind flagged ones degrade **including when flagged ≥ take**; strict-shrink termination; 50-batch cap.
- [x] 5.3 **RED (natural).** The `{degraded, flagged, failed}` triple, and a non-clean run distinguishable from a clean one.
- [x] 5.4 **RED (planted).** `row.name` planted into a log payload → red → removed, restored byte-exact.
- [x] 5.5 `DeletionRecordDegrader.ts` — `(prisma, ring, activeVersion, logger)`, no self-registration, zero `$transaction`, zero raw SQL.

## Phase 6: Wiring (WU6) — COMPLETE (PR-B)

- [x] 6.1 `TOKENS.DeletionRecordDegrader` + registration in `setupCrisisUseCases.ts` beside `OutboxCleaner`.
- [x] 6.2 **RED (planted) + floor bump.** `MINIMUM_TICKS` 9→10 first (red), then an unwrapped tick planted (red at the wrap assertion), restored byte-exact.
- [x] 6.3 Tick registered in `index.ts` beside `data-retention-cleanup`, 3-arg, daily, under `withSystemContext("system:deletion-record-degrader")`. The triple is AWAITED and logged — never `.then(() => undefined)`.
- [x] 6.4 Gauge HELP corrected. **Three MORE stale claims found and fixed** (the module docblock, `index.ts:350-355`, `secrets-and-env.md:48`).

## Phase 7: Secret catalogue (WU7) — COMPLETE (moved to PR-A by verify ruling)

- [x] 7.1 **RED (natural).** Count 29→30 ONLY; KEK `deepEqual` untouched.
- [x] 7.2 `"MAC"` appended to `SECRET_CATEGORY_VALUES`; `MAC` rule at 365 days; ring entry under a NEW `// §3a — Keyed-MAC rings` grouping. Pointer NOT catalogued.
- [x] 7.3 `| "MAC"` arm added to the hand-duplicated admin union.

## Phase 8: Integration (WU8) — COMPLETE (PR-B)

- [x] 8.1 `deletionRecordDegradation.test.ts`, seeded with BOTH dates back-dated, cleanup by `accountId` in `finally`. (Natural red not achievable — deviation 8.)
- [x] 8.2 Acceptance read from the GAUGE: non-zero before, 0 after; every row non-null digest + pin, null name.
- [x] 8.3 Not-yet-due untouched; second pass rewrites nothing; a flagged row keeps the gauge at 1 while the rows behind it degrade.
- [x] 8.4 Rotation round-trip: new row pins 2, the v1 row keeps its own pin and still verifies.
- [x] 8.5 Added to the EXISTING `integration:retention` batch. **Result: 10 tests, 10 pass, 0 fail, 0 cancel, 0 skip, exit 0 [OK].** The plan's suggested command took NO positional batch argument — the script is TIER-driven; the real invocation is `TIER=pr-integration bash scripts/run-tests.sh`.

## Phase 9: Docs and residuals (WU9) — COMPLETE (PR-B)

- [x] 9.1 `docs/security/SECRETS.md` — NEW top-level `## 3a. Keyed-MAC rings (append-only)` after §3, never nested under it. Ring row, `openssl rand -hex 32`, append-only runbook with its test seam stated honestly (steps 2/3/5 executed by 8.4; steps 1 and 4 operator-only), plus the single-quoting rule.
- [x] 9.2 `docs/architecture/secrets-and-env.md` env entries + the quoting rule; one paragraph at `MULTI_TENANT_GUARDS.md` noting the job now exists and stays the documented `withSystemContext` cross-account seam.
- [x] 9.3 **FIVE rows at SMELL-104..108** — ids verified against refs, not assumed (`origin/main` and the working tree maxed at 98; the analytics branch already held 99-103). SMELL-109 added by the verify gate's finding.
- [x] 9.4 Final gate: unit tier **571/571 suites, 8896/8896 tests, exit 0**; `tsc` 0; `eslint --max-warnings 0` 0; `prettier --check` clean; fitness #9/#10/#8/#16/#40A/#32/#23 all 0, #30 = 20 before AND after (baseline 21, did not rise), #39 DeletionRecord still denylisted; schema, migrations and workflows have zero entries in `git status`.

---

## Requirement → task traceability (11 requirements, 34 scenarios)

| #   | Requirement                                            | Sc  | Tasks                       |
| --- | ------------------------------------------------------ | --- | --------------------------- |
| 1   | Overdue plaintext is degraded [MB]                     | 4   | 5.1, 5.2, 8.1-8.3           |
| 2   | One atomic per-row write [MB]                          | 3   | 5.1, 5.2, 5.3               |
| 3   | Canonicalisation frozen and versioned [MB] _(amended)_ | 4   | 1.2-1.4, 2.2, 2.3, 2.5, 3.2 |
| 4   | MAC construction frozen [MB]                           | 3   | 3.1-3.3, 9.4                |
| 5   | Unassigned flagged, never digested [MB]                | 3   | 2.3, 5.2, 5.4               |
| 6   | Rotation append-only and round-trips [MB]              | 3   | 4.1, 4.3, 8.3, 8.4          |
| 7   | Key custody is a boot-time contract [MB]               | 5   | 4.1-4.5, 7.1-7.2, 9.1       |
| 8   | Disciplined scheduled tick                             | 4   | 6.2, 6.3, 6.4, 5.4          |
| 9   | Verifier exists, test-pinned only                      | 3   | 3.1, 3.3, 8.4               |
| 10  | Residual debt filed, not absorbed                      | 3   | 9.3                         |
| 11  | Tokenless, zero defect [MB]                            | 3   | 4.5, 8.5, 9.4               |

## RED protocol — all demonstrated

Natural: 1.1, 2.1, 3.1, 4.1, 5.1, 5.2, 5.3, 7.1 (8.1 not achievable — deviation 8).
Planted, restored byte-exact by `cmp`: 1.5(i), 1.5(ii), 2.6, 5.4, 6.2 floor bump, 6.2 unwrapped tick.

## Risks — final disposition

| #   | Risk                                       | Disposition                                                                                                                                                                                         |
| --- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A   | REQUIRED env var with no default breaks CI | CLOSED by 4.4. A′ found at apply: the same enumeration existed in two unit fixtures (fixed tokenlessly) and the local `.env.test` (token, done). A″ (single-quoting) RESOLVED by the second window. |
| B   | Generator reclassification                 | Delivered at 326 lines, EVIDENCE, PR-A.                                                                                                                                                             |
| C   | Writer could trim tests to fit             | Nothing trimmed. EVIDENCE 1860 reported over the 1840 stop; RATIFIED.                                                                                                                               |
| D   | Token window covers 2 edits                | Was 4, twice. Both windows executed.                                                                                                                                                                |
| E   | CODE headroom vs canon JSDoc               | REALISED (PR-A 625). RESOLVED by the split; PR-B under its own 400.                                                                                                                                 |
| F   | Below-pin runtime                          | Floor proven red at 99.0 and restored.                                                                                                                                                              |
| G   | Joint ring+DB compromise                   | Accepted residual; filed as SMELL-106.                                                                                                                                                              |
