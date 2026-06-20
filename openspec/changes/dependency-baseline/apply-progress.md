# Apply Progress: dependency-baseline — Step 1 (`01-structure`)

> **Slice:** `dep-baseline/01-structure` (the first child PR of the feature-branch-chain).
> **Mode:** Strict TDD active, but config/dependency-dominant — RED→GREEN bar = deterministic gates.
> **Delivery:** feature-branch-chain; `size:exception` (the 90-manifest sweep + generated lockfile; mechanically uniform).
> **Working tree left uncommitted** (orchestrator handles child-PR + token mechanics).

## Status: PARTIAL (structure complete; runtime gates deferred to CI per LXC-safety)

All file-edit + install tasks (T1.1–T1.13) DONE. T1.14/T1.15 partial: version invariant + 27 fitness PASS locally; full build/test deferred to child-PR CI (LXC rule).

## TDD Cycle Evidence (config/dependency-dominant — gates are the tests)

| Task                              | RED (gate failing/absent)       | GREEN (gate passes)                                                                                     | Result                                                |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| T1.1 catalogMode:strict           | key absent                      | present in pnpm-workspace.yaml                                                                          | DONE                                                  |
| T1.2 save-prefix=""               | absent                          | present in .npmrc                                                                                       | DONE                                                  |
| T1.3 default catalog              | DIRECT names inline             | every §2.1 DIRECT name has catalog entry                                                                | DONE                                                  |
| T1.3.a override-forces-newer      | risk of downgrade               | langchain 1.2.0/1.4.4, fastify 5.8.5, cloudinary 2.7.0, handlebars 4.7.9 @ newer                        | DONE                                                  |
| T1.3.b dompurify                  | ambiguous                       | 0 direct decls → STAYS in overrides                                                                     | DONE (decision)                                       |
| T1.4 catalogs.otel                | OTel inline                     | named catalog; 4 override-forced @ newer                                                                | DONE                                                  |
| T1.5 remove DIRECT from overrides | 26 DIRECT in overrides          | absent from overrides, present in catalog                                                               | DONE                                                  |
| T1.6 keep TRANSITIVE              | —                               | all transitive pins kept verbatim                                                                       | DONE                                                  |
| T1.7/1.8/1.9 SPLIT                | —                               | google-auth-library 9.x catalog + @10 override; gaxios@7 override; msw>path-to-regexp verbatim          | DONE                                                  |
| T1.10 CVE-floor                   | —                               | axios/form-data/validator/ws catalog @floor + `# CVE floor`; override removed                           | DONE (fast-xml-parser deviation: 0 decls → overrides) |
| T1.11 manifest sweep              | inline specs                    | 94 manifests, 411 specs → catalog:/catalog:otel; 0 leftover                                             | DONE                                                  |
| T1.12 wildcard peerDeps           | next-intl:_, zustand:_, msw:2.x | all → catalog: (+ react ^19, @tanstack ^5 peers)                                                        | DONE                                                  |
| **T1.13 no-downgrade guard**      | —                               | **per-name max-version diff vs HEAD = 0 DOWNGRADES (CRITICAL PASS)**                                    | DONE                                                  |
| T1.14 syncpack + dedupe           | —                               | syncpack list-mismatches exit 0 (single-version + range clean); dedupe exit 1 (PRE-EXISTING transitive) | PARTIAL                                               |
| T1.15 build/test/fitness          | —                               | 27 fitness hard-zero; build/test = child-PR CI                                                          | PARTIAL                                               |

## Verify gate results

| Gate                                                      | Result               | Note                                                                                         |
| --------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm install`                                            | PASS                 | succeeded; lockfile re-resolved                                                              |
| `pnpm install --frozen-lockfile`                          | PASS (exit 0)        | no drift                                                                                     |
| **T1.13 no-downgrade**                                    | **PASS (0 drops)**   | reconcile-UP only (zod, postcss, prisma, opossum, zustand, @types/node)                      |
| `syncpack list-mismatches` (single-version + exact-range) | PASS (exit 0)        | 603 valid, 427 ws-ignored, 0 mismatches                                                      |
| `pnpm dedupe --check`                                     | FAIL (exit 1)        | PRE-EXISTING transitive fragmentation; deferred to Step 3 T3.5 + Step 4 (END-STATE per spec) |
| 27 CI fitness greps                                       | PASS (all hard-zero) | catalog migration = 0 TS impact                                                              |
| full build / test suites                                  | DEFERRED             | child-PR CI job (LXC-safety: not run on 9GB box)                                             |

## Key decisions / deviations from design (flagged)

1. **dompurify (T1.3.b):** 0 direct declarations (only `isomorphic-dompurify` in apps/api) → KEPT in `pnpm.overrides` (3.4.11), NOT cataloged. Confirms design §8 Risk row 2 flag.
2. **fast-xml-parser (T1.10):** design §2.1 marked DUAL/DIRECT, but grep shows 0 direct declarations → reclassified TRANSITIVE, KEPT in overrides at 5.7.0 (CVE floor). NOT cataloged.
3. **zod direction (pulled forward from Step 3 T3.7):** slice prompt mandates reconcile-UP to 4.4.3 (apps' value) via MAX rule. Catalog `zod: 4.4.3`, override removed in Step 1 (design deferred this to Step 3). An UP move (4.3.6→4.4.3) — allowed by T1.13 (no drop). Lockfile confirms zod folds to 4.4.3.
4. **4 design-gap drifters cataloged (NEW):** design's catalog list omitted `@types/node` (22.13.3/24.5.2), `jsdom` (25.0.1/26.0.0), `tsx` (4.21.0/4.22.4), `@tanstack/react-query` (5.95.0/^5.0.0) — all genuinely-drifting shared deps that the syncpack single-version group flagged. Cataloged at MAX so the slice's own gate (syncpack exit 0) is green and the spec's universal single-version invariant holds. Flag for review: confirm these belong in catalog (they do per spec "every registry dep resolves once").
5. **postcss → 8.5.15 (not 8.5.14):** tree resolves 8.5.15 transitively; per Edward's "never pin lower," catalog = 8.5.15 (design said 8.5.14). UP move, no downgrade.
6. **OTel non-override names kept at manifest-current:** only the 4 override-forced OTel names (auto-instrumentations-node, core, exporter-prometheus, sdk-node) adopt newer; the rest stay at declared-current (structure-only discipline; full OTel set bump = Step 4 04b-otel; transitive OTel dedupe = Step 3 T3.5 override).
7. **syncpack version pin:** ran via `pnpm dlx syncpack@12` (design config §5.1 uses v12 syntax). `syncpack@12/13 lint` also runs a key-format check (flags files) separate from the version/range invariant — Step 5 T5.1 must tune (add formatGroups or use list-mismatches semantics in the CI step) so `syncpack lint` passes CI.

## Files changed (97 tracked + 1 new)

- `pnpm-workspace.yaml` — catalogMode:strict + default `catalog:` (34 entries incl. 4 design-gap) + `catalogs.otel` (14 entries).
- `.npmrc` — `save-prefix=""`.
- `package.json` (root) — overrides surgery (26 DIRECT removed; 34 transitive + 3 scoped kept); root devDeps → catalog:.
- 93 workspace `package.json` — DIRECT specs → catalog:/catalog:otel (411 specs total incl. root).
- `pnpm-lock.yaml` — re-resolved (catalog relocations + reconcile-UP folds; 0 downgrades).
- `.syncpackrc.json` (NEW) — design §5.1 shape (single-version highestSemver + exact-range "" + workspace ignore). Finalized in Step 5.

## Remaining in this change (other slices)

Step 2 (`02-wildcards`): wildcards already folded here → degenerates to verification.
Step 3 (`03-reconcile`): drifters mostly folded UP here; T3.5 OTel `@opentelemetry/api-logs` override + T3.7 zod (already done) remain to confirm. **dedupe clean is achieved across Step 3 + Step 4.**
Step 4 (`04a..04h`): per-family latest-stable bumps.
Step 5 (`05-final-lint`): CI guard + Renovate + §7 + spec "24→27" fix + finalize `.syncpackrc.json`/syncpack dep.
