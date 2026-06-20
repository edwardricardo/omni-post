# Apply Progress: dependency-baseline — Steps 1 (`01-structure`) + 1b (`01b-override-catalog-refs`)

> **Slices:** `dep-baseline/01-structure` (first child PR) + `dep-baseline/01b-override-catalog-refs` (second; lands after 01-structure, before 02-wildcards).
> **Mode:** Strict TDD active, but config/dependency-dominant — RED→GREEN bar = deterministic gates.
> **Delivery:** feature-branch-chain; `size:exception` for 01-structure (90-manifest sweep + generated lockfile); 01b is tiny (10 override lines, lockfile no-change).
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

---

# Step 1b — Dual-role overrides reference the catalog (`01b-override-catalog-refs`)

## Status: DONE (config-only; all gates green; lockfile byte-identical)

The 10 dual-role security packages were converted in root `pnpm.overrides` from
literal versions to catalog references — the catalog is now the SINGLE source of
truth and the override just extends that one value to the transitive subtree.
pnpm resolves `catalog:` inside `pnpm.overrides` (pnpm.io/catalogs +
pnpm.io/settings). Resolution-neutral by construction (the catalog pin already
equals the literal it replaced) → the lockfile did not move.

## Exact override lines changed (before → after)

| Override                                    | Before (literal) | After (catalog ref) |
| ------------------------------------------- | ---------------- | ------------------- |
| `axios`                                     | `1.17.0`         | `catalog:`          |
| `form-data`                                 | `4.0.6`          | `catalog:`          |
| `validator`                                 | `13.15.22`       | `catalog:`          |
| `uuid`                                      | `13.0.1`         | `catalog:`          |
| `ws`                                        | `8.21.0`         | `catalog:`          |
| `postcss`                                   | `8.5.15`         | `catalog:`          |
| `@opentelemetry/auto-instrumentations-node` | `0.75.0`         | `catalog:otel`      |
| `@opentelemetry/core`                       | `2.8.0`          | `catalog:otel`      |
| `@opentelemetry/exporter-prometheus`        | `0.217.0`        | `catalog:otel`      |
| `@opentelemetry/sdk-node`                   | `0.217.0`        | `catalog:otel`      |

All other overrides (transitive-only literals + scoped/nested selectors
`gaxios@7`, `google-auth-library@10`, `msw>path-to-regexp`, `dompurify`,
`fast-xml-parser`, …) left UNCHANGED — no catalog entry to reference.

## TDD Cycle Evidence (config-dominant — gates are the tests)

| Task                          | RED (gate before)                                | GREEN (gate after)                                                      | Result |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ------ |
| T1b.1 6 default → `catalog:`  | overrides hold duplicate literals (drift hazard) | 6 overrides read `catalog:`; catalog pins unchanged                     | DONE   |
| T1b.2 4 OTel → `catalog:otel` | OTel overrides hold duplicate literals           | 4 overrides read `catalog:otel`; `catalogs.otel` pins unchanged         | DONE   |
| T1b.3 others unchanged        | —                                                | §2.2 + §2.3 entries byte-identical to HEAD                              | DONE   |
| **T1b.4 lockfile no-change**  | —                                                | **`sha256sum` identical (`cf246d4b…`), `diff` NO_DIFF, git stat empty** | DONE   |
| T1b.5 CLI gates               | —                                                | frozen exit 0; audit exit 0; syncpack exit 0; 27 fitness hard-zero      | DONE   |
| T1b.6 docs                    | ADR/design duplicate-literal not codified        | ADR-0018 + design §2.1.a + step row 1b updated                          | DONE   |

## Verify gate results (Step 1b)

| Gate                                        | Result               | Note                                                                                       |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm install`                              | PASS (exit 0)        | "Lockfile is up to date, resolution step is skipped" — no re-resolution                    |
| **lockfile byte-identical (CRITICAL)**      | **PASS**             | sha256 `cf246d4b…` before == after; `diff` NO_DIFF; `git diff --stat pnpm-lock.yaml` empty |
| `pnpm install --frozen-lockfile`            | PASS (exit 0)        | clean; manifest consistent with lockfile                                                   |
| `pnpm audit --audit-level moderate`         | PASS (exit 0)        | 2 vulns, BOTH ignored (configured GHSAs); CVE floors preserved via catalog values          |
| `syncpack list-mismatches` (single + exact) | PASS (exit 0)        | 603 valid, 427 ws-ignored, 0 mismatches                                                    |
| `syncpack lint-semver-ranges`               | unchanged vs HEAD    | 419 `UnsupportedMismatch` (pre-existing: syncpack@12 doesn't parse `catalog:` protocol)    |
| 27 CI fitness greps                         | PASS (all hard-zero) | config-only change, 0 TS impact                                                            |
| full build / test suites                    | DEFERRED             | child-PR CI job (LXC-safety: not run on 9GB box)                                           |

## Files changed (Step 1b)

- `package.json` (root) — 10 `pnpm.overrides` entries converted from literal → `catalog:` (6) / `catalog:otel` (4). No other change. (`git diff --stat`: 10 insertions, 10 deletions.)
- `docs/technical/ADR-0018-dependency-freshness-canon.md` — new Decision bullet: dual-role packages reference the catalog from the override; never duplicate the literal.
- `openspec/changes/dependency-baseline/design.md` — new §2.1.a (dual-role handling + conversion table) + step-table row 1b.
- `openspec/changes/dependency-baseline/tasks.md` — new Step 1b block (T1b.1–T1b.6, all `[x]`).
- `pnpm-lock.yaml` — UNCHANGED (byte-identical; the whole point).

## Key notes / non-obvious findings (Step 1b)

1. **The conversion is a true no-op resolution-wise** because each catalog pin already equals the override literal it replaced (verified pre-edit: catalog `axios 1.17.0` == override `1.17.0`, … OTel set identical). This is WHY the lockfile stayed byte-identical and WHY it is safe — if any value had differed, the install would have moved a version and the slice would STOP-and-report.
2. **syncpack `lint-semver-ranges` reports `UnsupportedMismatch` for `catalog:` specs** — this is a syncpack@12 limitation (it does not understand the catalog protocol), NOT a range violation. Count is identical with/without this slice (419 on HEAD too), so it is pre-existing from Step 1's catalog migration. The authoritative single-version gate is `list-mismatches` (exit 0). Step 5 T5.1 still owns tuning the CI syncpack step.
3. **Audit floors preserved**: the catalog values ARE the CVE floors (axios 1.17.0, form-data 4.0.6, validator 13.15.22, ws 8.21.0), so referencing the catalog from the override preserves the security intent exactly while removing the duplication.
