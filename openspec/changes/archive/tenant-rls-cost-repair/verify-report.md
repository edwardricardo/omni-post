# Verify Report — tenant-rls-cost-repair

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:cc81d46cb8204f72cbaa3f97f5b5a6000d0f4da7dda969ef2d82553f493e45ba
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 35/35
test_command: cd apps/api && TIER=pr-integration bash ./scripts/run-tests.sh
test_exit_code: 0
test_output_hash: sha256:cc81d46cb8204f72cbaa3f97f5b5a6000d0f4da7dda969ef2d82553f493e45ba
build_command: NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc -b apps/api
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification — PR-4 (form-uniformity gate + change close), fresh-context adversarial pass

**Scope**: read-only gatekeeper validation of the then-uncommitted PR-4 candidate (base HEAD
`2b4e7765`, 6 modified files, 0 untracked). Native status at the time: `taskProgress 75/75
allComplete: true`, `verify: ready`, `archive: blocked` (this file did not yet exist).

**Status: PASS** (0 CRITICAL, 1 WARNING, 2 SUGGESTION).

### Independently reproduced (not read from the narrative)

| Claim                                  | Reproduced                                                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch `TIER=pr-integration`            | `TOTAL: 484 tests, 484 pass, 0 fail, 0 cancel, 0 skip`, exit 0; `integration:tenant-isolation` 246/246                                         |
| `tsc -b apps/api`                      | exit 0, empty output                                                                                                                           |
| `eslint --max-warnings 0` on the suite | exit 0                                                                                                                                         |
| `prettier -c` on all 6 candidate files | clean                                                                                                                                          |
| fitness #38                            | swept-tree **0**, db-prisma **11** (at ratchet, not risen)                                                                                     |
| fitness #39                            | **0** violations, `TENANT_SCOPED_MODELS` size **61**                                                                                           |
| fitness #40                            | Part A 0 violations (seam hits 3 = floor); Part B 0 underived, 13 sites                                                                        |
| fitness #32 on the suite               | 0 `.only` / `.skip`                                                                                                                            |
| as-found capture                       | `61 \| 61 \| 0 \| 0 \| 1 \| 3 \| 70322c28db1c0684897b49e4d70de014` — byte-matches the cited string                                             |
| SMELL id space                         | HEAD max = 93; 94/95 genuinely next free                                                                                                       |
| Backlog 126/124 diff                   | whitespace-normalized diff = separator + SMELL-93 modified + 94/95 added; no row lost                                                          |
| SMELL-95 line refs                     | `PrismaRepurposeDetectionAdapter.ts:204`, `zapierRoutes.ts:371`, `makeRoutes.ts:376` all land on `project: { accountId, deletedAt: null }`     |
| 7 cited commit SHAs                    | all resolve to the described links                                                                                                             |
| Matcher probe                          | glued literal `(select current_setting(` = **0** on all 4 read-back fixtures; tolerant adjacency: WRAPPED 2/2, VARIANT 2/2, BARE 2/0, HALF 2/1 |
| `.github/` untouched by PR-4           | confirmed by git status — 9.7 is confirm-only, no fitness step created                                                                         |
| 9.7 wiring                             | `run-tests.sh:273` opens the batch, `:291` names the suite                                                                                     |

### WARNING-1 — the aggregate assertion contradicted the NULL-`WITH CHECK` rule (latent false-RED)

The catalog test asserted `hoistedReads === rows.length * 4` while `auditPolicyForm` scores a
NULL `with_check` as compliant with `hoisted: 0`. Measured on a simulated 61-policy catalog
with exactly one legitimate no-`WITH-CHECK` policy: per-clause findings `[]`, but
`hoistedReads = 242` against a required 244 — the suite went red on a catalog every per-clause
rule calls compliant. Vacuous on the deployed catalog (`with_check_null = 0` of 61, verified),
but the sweep migration's own `polwithcheck IS NULL` branch (task 8.4) exists precisely to make
that state reachable. Prescribed fix: derive the expected total per policy.

### SUGGESTION-1 — stale size figures in apply-progress deviation 8

Writer-time figures for `tasks.md + apply-progress.md` (287/12) were superseded by
orchestrator additions; the `size:exception` conclusion is unaffected.

### SUGGESTION-2 — 10.6 ledger handoff shape

apply-progress said 10.6 `[ ]`, tasks.md had it `[x]` — the house handoff pattern (writer
leaves the gate, orchestrator fills it), not drift.

---

## Addendum — resolution before commit, and the shipped state (2026-09-11)

- **WARNING-1 was FIXED, not accepted**: the shipped suite derives
  `expectedHoisted = rows.reduce((s, r) => s + (r.with_check === null ? 2 : 4), 0)` with a
  comment stating why, and the batch re-ran green. Recorded in apply-progress Batch 8's
  Amendment (item 2). SUGGESTION-1 and -2 were resolved by the same Amendment's pointers.
- **RDD re-ran on the corrected candidate** and burned approved with **zero advisories**:
  lineage `review-e5c8e5f5a9001613` (the pre-fix candidate's lineage was superseded by the
  edit, exactly as the contract requires).
- **Shipped to main 2026-09-11** as the stacked ladder #236 (`3498d880`) → #237 (`ac68e2da`,
  carrying the Squawk ADJUDICATION 5 fix `c9808cb9` for the IX1 `down.sql` — its red observed
  live in CI) → #238 (`567f8f56`) → #239 (`77992838`, main's tip at close). Every real check
  green on each rung; the only non-pass rows were the four chronic Container Security jobs
  (pre-existing, tracked, unrelated to this change).
