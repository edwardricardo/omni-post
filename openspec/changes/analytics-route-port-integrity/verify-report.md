# Verify Report: analytics-route-port-integrity (SMELL-98)

> Materialized from Engram `sdd/analytics-route-port-integrity/verify-report` (obs 687).

## ⚠️ NATIVE VALIDATOR ADMISSION _NOT_ OBTAINED — read this first

`gentle-ai sdd-verify-validate` **denied admission**. This report is persisted anyway under the orchestrator's explicit mandatory-save instruction, and it is flagged here so nobody mistakes it for a natively-attested report.

Exact denial: `Error: verify report admission denied: invalid evidence_revision in verify result envelope`

**Cause — a store mismatch in tooling, not a defect in this verification.** Every field shape is correct (`requirements`/`scenarios` must be fraction strings); `evidence_revision` is the sole blocker and no format is accepted. It evidently requires a live native-issued revision token, and native status reports `artifactStore: openspec` with `changeRoot: null` and **empty `artifactPaths`** for this change — native SDD is structurally blind to an Engram-backed change and has no state from which to issue one. Closest classification: _verification tooling unavailable for this artifact-store configuration_. (Orchestrator note: the planning artifacts were materialized to this folder afterwards, which is the durable resolution path.)

**Nothing about the verdict below depends on the validator.** All evidence was re-executed in the verify session.

---

**VERDICT: PASS WITH WARNINGS** — 0 CRITICAL / 5 WARNING / 3 SUGGESTION.
Mode: Strict TDD. Subject: the **uncommitted working tree** on `workstream/analytics-route-port-integrity`, HEAD `fdda5d25` (== `origin/main` at verify time), 12 files changed, nothing committed. Requirements 7/8 · Scenarios 25/26.

Evidence envelope (for a future re-validation once a revision token exists):

```
schema: gentle-ai.verify-result/v1
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/8
scenarios: 25/26
test_command: "pnpm --filter @apps/api test"
test_exit_code: 0
test_output_hash: d393292edba184b7eeee4b90c216bf481482163d7383e0a6f74855fac681190b
build_command: "pnpm exec tsc -b --force apps/api packages/core"
build_exit_code: 0
build_output_hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

---

## 1. The adjudication-pending numbers — INDEPENDENTLY CONFIRMED

Measured via `git diff --numstat` + `git diff --no-index --numstat /dev/null` for the two untracked files. **Both writer figures reproduce exactly.**

| Tier     | Declared               | Measured here | Verdict                            |
| -------- | ---------------------- | ------------- | ---------------------------------- |
| CODE     | cap 400                | **289**       | within cap                         |
| EVIDENCE | band 520-670, stop 770 | **1019**      | **BREACHED by 249 (132% of stop)** |
| TOTAL    | —                      | **1308**      | —                                  |

Per-file (all 12 reproduced exactly as claimed): analyticsRoutes.ts +32/-73 (CODE 105) · PrismaAnalyticsReadRepository.ts +40 · PrismaProjectQueryRepository.ts +37 · PrismaThreadReadRepository.ts +19/-1 · AnalyticsReadRepository.ts +27 · ProjectQueryRepository.ts +39 · ThreadReadRepository.ts +21 · characterization.test.ts +787 new · PrismaAnalyticsReadRepository.test.ts +112 new · PrismaProjectQueryRepository.test.ts +82 · PrismaThreadReadRepository.test.ts +24 · ThreadReadRepository.test.ts +13/-1.

Reporting rather than trimming was the correct call: 144 of the 787 characterization lines are comment-only, and byte identity genuinely requires column-ordered fixed-date literals, so a trim would have traded disclosure for coverage. (Ratified by Edward 2026-09-12.)

## 2. Requirement compliance (8 requirements / 26 scenarios)

| Req                                          | Scen | Status                                           | Evidence re-derived in the verify session                                                                                                                                                         |
| -------------------------------------------- | ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 Ports-only construction [MB]              | 4/4  | **MET**                                          | `rg -ic prisma analyticsRoutes.ts` → **0**. Ctor param 1 dropped; two ports inserted; client-token resolve deleted from the plugin; all 10 reads land on ports                                    |
| R2 Characterization net [MB]                 | 4/4  | **MET**                                          | Imports the CUSTOMER file; 10 tests via real plugin + real setupContainer; net proven able to fail by the VERIFIER's own mutation (real exit 1); 8 fixture slots; SHAPE rule holds                |
| R3 Response equivalence [MB]                 | 4/4  | **MET** (evidence grade downgraded — ruling 4.1) | Re-established structurally, independently of the sha256 testimony; scenario 4's "404" was factually wrong (ruling 4.2)                                                                           |
| R4 Narrow channel projection [MB — security] | 4/4  | **MET**                                          | Explicit select; `getChannelsByProject` 0 times in the route; exhaustive call-args pin; no credential key on any export channel + whole-body negative match                                       |
| R5 Query-shape preservation                  | 4/4  | **MET**                                          | Call-args pins on all four methods; analytics single nested join with conditional `since` and key-absence assertion; thread 4-field/no-orderBy pinned; post 5-field; exact reuses byte-equivalent |
| R6 Soft-delete posture                       | 3/3  | **MET, proven non-vacuous**                      | #38 swept 0, ratchet 11 unchanged, zero db-prisma files; mutation M-C moved #38 0→exactly 1                                                                                                       |
| R7 Debt filed, not absorbed                  | 1/2  | **PARTIAL — blocked, premise verified**          | No SMELL-101 defect repaired (S2 met); SMELL-98 row absent on branch AND origin/main at verify time — writer correctly refused to synthesize (unblocked by PR #247's merge)                       |
| R8 Zero-defect gate                          | 1/1  | **MET**                                          | §3                                                                                                                                                                                                |

All seven [MB]-relevant requirements (R1-R6, R8) are MET. The single unmet scenario was R7-S1, unblocked by #247.

## 3. Gate re-runs (all executed in the verify session)

| Gate                                          | Result                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `eslint apps packages infra --max-warnings 0` | **EXIT 0** (the `[boundaries]` stderr lines are plugin config-load advisories — SMELL-66 — not rule warnings) |
| `tsc -b --force apps/api packages/core`       | **EXIT 0**, non-incremental                                                                                   |
| `pnpm --filter @apps/api test`                | **EXIT 0 — 568 files / 8834 tests**, 0 failed/skipped/cancelled, 0 snapshots; reproduced twice                |
| Focused (5 changed/new suites)                | **EXIT 0 — 47 tests**                                                                                         |
| Fitness #8/#9/#10/#22 · #1/#21 · #32          | all **0**                                                                                                     |
| Fitness #38 swept / ratchet                   | **0 / 11 (baseline, unchanged)**                                                                              |
| Fitness #30                                   | N/A by construction — vitest include covers both new files                                                    |
| W3(b) corrected golden gate                   | `fd -u -e snap . apps/api/tests` = 0; `rg -uu -c toMatchSnapshot` = 0                                         |
| Tokenless                                     | honoured — nothing under workflows, schema, migrations, agent-config, dotenv                                  |

## 4. Rulings

### 4.1 Byte-identity mechanism (Req 3)

**The PROPERTY is satisfied; the EVIDENCE GRADE is downgraded from reproducible artifact to recorded testimony.** The sha256 pair is stronger than the design's vacuous git-diff check, but three things are lost: independent reproducibility (the hashed file no longer exists), CI enforcement (the design's gate became a report), provenance ordering (nothing committed). WARNING not CRITICAL because the verifier did NOT have to accept the testimony: Req 3 was re-established structurally for all ten moved reads — the nine analytics columns keep their exact select order, channels/posts/threads identical pre/post, and the single deliberate delta (dropped post-relation include) provably cannot reach a response (the dashboard emits no analytics object; zero post-relation member access at `:583-660`). Corroboration: the live adapter hashes to `a10f0c24…`, matching the writer's claimed restore sha exactly. Disposition: the golden was already deleted, so force-adding is moot — W3(a) is recorded in the PR as **not-applicable-with-reason** together with this ruling.

### 4.2 The two spec-vs-reality corrections — BOTH RIGHT

(a) **403 not 404**: `getProjectAccess` filters `{id, accountId, deletedAt: null}` — strictly narrower than `findById`'s `{id, deletedAt: null}` — so access-pass implies the re-read finds; the 404 branch (`analyticsRoutes.ts:698`) is dead code through this route. (b) **`GET /export` with query `projectId`**: registered at `"/export"` (`:1066`); `projectId` is a query field. **Both are defects in the SPEC artifact, not the apply** — corrected in the materialized spec in this folder. (a) also strengthens SMELL-101: the redundant re-read's failure branch is unreachable.

### 4.3 `InMemoryThreadReadRepository` in-place fix — IN SCOPE

`apps/api/tsconfig.json` includes only `src`, so tests are genuinely untypechecked and no gate would have caught the non-conforming double. In scope: it is the direct mechanical consequence of this change's own port widening; 13 lines, test-only; leaving it would author a false `implements` declaration (the "parece proteger y no protege" class). The untypechecked-tests gap itself is filed (see S-2 → its own backlog line).

## 5. Findings

**WARNING**: W-1 EVIDENCE 1019 vs 770 — confirmed, needed ratification (GIVEN). · W-2 spec factual errors — corrected at materialization. · W-3 byte-identity testimonial — mitigated by independent structural verification; not-applicable-with-reason recorded. · W-4 R7 partial — unblocked by #247's merge. · W-5 nothing committed — orchestrator's commit step.

**SUGGESTION**: S-1 the MERGED net does not cover the new adapter seam (mutation M-B left characterization green; only the adapter unit went red) — the seam is held by the adapter call-args pins alone; the PR body must state it accurately. · S-2 the untypechecked-`implements` gap deserves its own backlog id, not a line inside SMELL-100. · S-3 SMELL-102 under-scoped — add `"1"→true`, `"FALSE"→true` and the explicit repo-wide sweep obligation.

**CLEAN**: SHAPE-only rule rigorously honoured · zero call-args in the characterization suite · honesty labelling on the projection proof · scheduler AND cache overrides registered pre-plugin, 0 cancelled · canon headers present · the W3(b) gate defect independently reproduced in a scratch tree (same "dead scope = infallible gate" class as fitness #2/#3/#4/#36).

## 6. Verification integrity

Three mutations planted and restored byte-exact against a scratchpad backup + sha256 manifest: M-A rename `dataPoints` → exit 1 (1 failed/9 passed); M-B drop the `since` spread → exit 1 from the ADAPTER UNIT only, characterization green; M-C drop inline `deletedAt` → fitness #38 0→exactly 1. Final state: `sha256sum -c` 12/12 OK, `git status` byte-identical to start. No repository file was left modified; no report file was written to the repo by the verifier.

## 7. Next actions at verify time (all discharged)

1. ~~Edward ratifies the EVIDENCE overrun~~ — ratified 2026-09-12.
2. ~~W3(a) decision~~ — not-applicable-with-reason (golden already deleted; ruling 4.1).
3. ~~Correct the spec artifact~~ — done at materialization.
4. ~~Four work-unit commits~~ — orchestrator.
5. ~~Backlog rows after #247~~ — applied post-merge.
6. The `evidence_revision` / Engram-store validator gap: resolved for this change by materializing to the openspec store; the general tooling gap is noted for the workflow docs.
