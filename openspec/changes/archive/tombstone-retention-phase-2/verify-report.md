# Verify report: tombstone-retention-phase-2 (SMELL-88)

> Materialized from Engram `sdd/tombstone-retention-phase-2/verify-report` (obs 696).
> POST-VERIFY DISPOSITIONS, both executed before delivery: **W2/flag-4** — the recommended
> WU7 move into PR-A was ACCEPTED and staged exactly as ruled (catalog + admin arm + count
> test; PR-A CODE 625→649, PR-B 281→257 — the inter-PR stale-inventory window never
> existed); **W1** — the `?? GENERATION_1` fallback was filed as **SMELL-109** in the
> backlog before the PRs opened.

```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c1514b46dc917d76116eca4231d7916be7d41ec6f1199ffff69f3f7b0f7a2718
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 34/34
test_command: "cd apps/api && TIER=pr-integration bash scripts/run-tests.sh"
test_exit_code: 0
test_output_hash: sha256:780016c08b23585c525be5f55d093d142886591faf3572714706cdfcc6a9326c
build_command: "pnpm exec tsc -b apps/api --force"
build_exit_code: 0
build_output_hash: sha256:9eb9cc5ffcd10ccced37a3815386f60bd3c36540b40531c4d497d72e028a7ac5
```

**Verdict: PASS WITH WARNINGS — 0 CRITICAL, 2 WARNING, 3 SUGGESTION.**

Native admission: `gentle-ai sdd-verify-validate --requirements 11 --scenarios 34` returned `{"valid": true, "verdict": "pass_with_warnings"}`, exit 0.

Subject: the UNCOMMITTED working tree on `workstream/tombstone-retention-phase-2`, git HEAD `dd137f2a` (== `origin/main` at verify time; all 37 changed files were working-tree state). `evidence_revision` is the sha256 of the 37-file worktree checksum manifest. Spec obs 690 READ AS AMENDED by design rev 3's SPEC AMENDMENT section. Nothing was written to the repo; the tree was checksum-manifested before any mutation and verified byte-identical afterwards (37/37 OK).

## 1. Gates re-executed by the verify phase

| Gate                                           | Result                                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Unit tier                                      | **571/571 suites · 8896/8896 tests · EXIT=0**, 0 skipped                                                                   |
| Integration tier (`TIER=pr-integration`)       | **506/506, 0 fail/cancel/skip, EXIT=0** — all 11 batches OK, `integration:retention` 10/10                                 |
| Type check (`tsc -b --force`, non-incremental) | EXIT=0                                                                                                                     |
| Lint (`--max-warnings 0`, 32 changed files)    | EXIT=0 (only the pre-existing SMELL-66 plugin config notices on stderr)                                                    |
| Change suites post-restore                     | 27 files / 801 tests, EXIT=0                                                                                               |
| Fitness #8/#9/#10/#16/#23/#32/#39/#40A/#40B    | all 0 at threshold                                                                                                         |
| Fitness #30                                    | **20** (baseline 21 — did not rise; the new integration suite IS named by a run_batch, literal-grepped)                    |
| Tokenless                                      | zero `git status` entries under schema/migrations/workflows/agent-config; the audit RETENTION_DIGEST pin cannot have moved |

## 2. Requirement compliance — 11/11 requirements, 34/34 scenarios PASS

All eight [MB] requirements met with runtime evidence re-executed by the verifier (gauge-read acceptance driven through `getMetricsAsJSON()` so the collect callback actually runs; the amendment correctly implemented — fi ligature in the SAME-digest family, DISTINCT family holds only fullwidth/superscript; 20 ring refusals each naming their version; zero route consumers of `verifyNameDigest` measured; rotation round-trip genuinely degrading under generation 2).

## 3. TDD evidence — re-executed, not trusted

Two of apply's five restore hashes confirmed byte-exact against the live tree; the other three corroborated behaviourally (the table gate and tick-scope scan can only pass on restored bytes). The verifier planted THREE reds of its own, each restored byte-exact (`cmp`):

- **RED #1 — exclusion-set `notIn` removed**: three real failures including the exact starvation (`expected 5000 to be 200` — the identical unflaggable batch re-read 50×). The anti-starvation property is genuinely gated.
- **RED #2 — `toLowerCase` substituted for the pinned fold**: THREE vectors fail (sharp s `776569c39f`≠`7765697373`, fi ligature `efac81`≠`6669`, final sigma) — the discriminator is stronger than advertised (S1).
- **RED #3 — canary floor raised to [99,0]**: reproduces apply's 2.6 evidence verbatim.

Assertion-quality audit: no tautologies, no ghost loops, discriminating controls on the flag vectors, existence-first canary, numeric floor comparison with the string-compare defect named, every-log-argument plaintext spy, numeric-sample gauge reader. **0 CRITICAL, 0 WARNING on assertion quality.**

## 4. Budget — independently measured, all six numbers confirmed

| Tier     | PR-A                        | PR-B                    | Whole                              |
| -------- | --------------------------- | ----------------------- | ---------------------------------- |
| CODE     | **625** (649 post-WU7-move) | **281** (257 post-move) | —                                  |
| EVIDENCE | **1057**                    | **803**                 | **1860** (vs stop 1840 — ratified) |

Exclusions confirmed against `.gitattributes`: generated module 2402 lines (linguist-generated), vendored UCD 7994 lines (linguist-vendored).

## 5. Ruling on staging flag 4 — EXECUTED

Flags 1-3 confirmed against the tree (single-quoted env state in all four files + the CI synthesiser; the B-owned test values 10/30; index.ts single-set +29/-3). **Flag 4 ruling: naming the window in PR bodies is NOT sufficient** — no test couples the env's required secrets to `SECRETS_CATALOG` (all readers derive from `.length`), so during the window `secretCatalog.test.ts` would assert 29 and PASS over a 30-secret deployment: a green gate over a stale inventory (the dead-scope class), and a split of [MB] Requirement 7. WU7's three files have zero dependency on WU5/WU6 → moved to PR-A (+21/+3 CODE, +4 EVIDENCE). The WU9 docs stay named-only (splitting a doc mid-section is worse than the gap; PR-A's body carries the operator-load-bearing facts).

## 6. Findings

**W1** — `ringParametersFor`'s `?? GENERATION_1` fallback is an UNREPORTED deviation from design D5, load-bearing (the rotation round-trip resolves through it), pinned by no test, with no tripwire on its forward obligation. → Filed as **SMELL-109**.
**W2** — the seam splits [MB] Req 7 → resolved by the WU7 move (§5).
**S1** — PR-A's body understated the `toLowerCase` discriminator (three status-F vectors fail, not one) — safe direction, wording corrected.
**S2** — EVIDENCE 1860 over the 1840 stop by 20 — ratified by Edward, recorded so the overshoot is not lost between phases.
**S3** — the integration drain assertion reads the unscoped global gauge — correct by design (deployment-level property, CONCURRENCY=1, finally-cleanup); a SIGKILL between create and finally could leave a residue that reds the NEXT run with a drainage-shaped message; one docblock sentence suffices.

## 7. Design coherence

D1-D8 implemented as designed (D7 improved: the triple is awaited and logged, applying the gate's S-new-1 remedy); the canary composition rider closed via the monotone numeric floor + existence assert. Apply's 12 declared deviations spot-checked and holding; one undeclared found (W1 → SMELL-109).

## 8. Tree integrity

37-file manifest before any mutation; `sha256sum -c` 37 OK / 0 FAILED after; `git status` identical; zero files written to the repo by the verify phase.

## 9. Verdict

**PASS WITH WARNINGS.** Every independently measurable number in apply-progress matched. The two warnings were a ledger gap (W1 → SMELL-109) and a delivery-seam ruling (W2 → executed); neither blocked archive, and neither was a defect in the code that shipped.
