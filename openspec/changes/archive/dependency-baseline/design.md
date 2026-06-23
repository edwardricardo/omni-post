# Design: Dependency-Freshness Baseline (catalogs + single-version pin)

> **Phase:** SDD design (the technical HOW). **Change:** `dependency-baseline`.
> **Canon:** ADR-0018 (Accepted). **Proposal:** `proposal.md` (approved).
> **Store:** openspec.
>
> **ARCHIVE NOTE (2026-06-23):** change merged via PR #95 (`552c63a9`). The design's
> structure-time version targets are floors; final pins are ≥ those per "always latest
> stable" (see `tasks.md` per-task annotations + `apply-progress.md`). The transitive model
> evolved to consumer-governed (ADR-0018) — see the living spec.

## The decision, up front

Migrate every **DIRECT** dependency (a name declared in at least one workspace
manifest) into a pnpm **catalog** as a single exact pin; leave every
**TRANSITIVE-only** override (a CVE/consistency force on an indirect dep that no
manifest declares) in `pnpm.overrides`. The catalog becomes the one edit point
that makes duplicate versions structurally un-representable;
`catalogMode: strict` + `syncpack lint` keep it that way; `taze -l
--maturity-period 7` + per-family verify-after-each keep it fresh without the
drift-hydra that bit PR #91.

**Classification result:** of the ~70 root overrides, **40 are DIRECT →
catalog**, **27 are TRANSITIVE-only → stay in overrides**, **3 are dual-role and
split** (catalog the declared version + keep a scoped override for the
transitive). Full table in §2.

## Quick path (the 5 baseline steps, sequenced)

Each step is one **per-family child PR** on the feature-branch-chain tracker
`workstream/dep-baseline`. Child PRs target the tracker; only the tracker merges
to main (atomic rollback).

| Step | Child PR                                 | What it does                                                                                                                                                              | Gate before next                                                                   |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1    | `dep-baseline/01-structure`              | Catalogs at **CURRENT** versions + syncpack config + 90 manifests → `catalog:`. Upgrade-free.                                                                             | Full build + LXC-safe tests + 27 fitness green.                                    |
| 1b   | `dep-baseline/01b-override-catalog-refs` | Convert the 10 dual-role overrides (6 default + 4 OTel) from literal versions to `catalog:` / `catalog:otel` references — single source of truth, zero resolution change. | Lockfile byte-identical + `--frozen-lockfile` + `audit` + `syncpack` + 27 fitness. |
| 2    | `dep-baseline/02-wildcards`              | Kill the 3 wildcards (`next-intl`, `zustand`, `msw`); fold each at its resolved exact into the catalog.                                                                   | `syncpack lint` + `--frozen-lockfile`.                                             |
| 3    | `dep-baseline/03-reconcile`              | Reconcile the 13 drifters to single versions (runtime-critical first).                                                                                                    | Build + tests + `dedupe --check`.                                                  |
| 4    | `dep-baseline/04-fam-<name>` (N PRs)     | Per-family latest-stable bump, **verify-after-each**, `--frozen-lockfile` between families.                                                                               | Full fitness/test gate per family.                                                 |
| 5    | `dep-baseline/05-final-lint`             | Wire the CI guard + Renovate; final `syncpack lint` + `dedupe --check` = the pinned baseline.                                                                             | All success criteria.                                                              |

> **Why structure before version (ADR-0018 §Risks):** step 1 changes ZERO
> resolved versions — it only relocates specs to `catalog:`. That isolates "did
> the catalog plumbing break anything?" from "did a version bump break
> something?" If a later family must be dropped, step 1 still stands alone.

---

## 1. Catalog structure (`pnpm-workspace.yaml`)

### 1.1 Decision: the default catalog + one named catalog for the OTel set

Use the **default catalog** (`catalog:` reference, no name) for the bulk of
shared deps. Use **one named catalog** `catalogs.otel` ONLY for the OpenTelemetry
set, because the OTel packages move as a locked family on their own release train.
Everything else (react, tiptap, langchain, googleapis families) lives in the
default catalog with a version-locked **grouping comment** rather than a separate
named catalog.

> **The OTel override-is-the-bump discovery (flag for Edward):** the
> `observability/opentelemetry` manifest declares OLDER versions than the root
> overrides force. The catalog must adopt the **override (newer)** version as the
> single pin AND the manifest specs change to `catalog:` — otherwise removing the
> override would silently DOWNGRADE these packages. Same for `@langchain/core`
> (api 1.1.46 vs override 1.2.0) and `fastify` (5.6.1 vs override 5.8.5).

### 1.2 Manifest reference rewrite

Every DIRECT spec across the 90 manifests changes to a catalog reference
(`"react": "catalog:"`, `"@opentelemetry/core": "catalog:otel"`). `workspace:*`
specs for local packages are **untouched** — catalogs cover registry deps only.

### 1.3 Wildcard peerDeps — special handling

The 3 wildcards live as `peerDependencies` (`next-intl: *` + `zustand: *` in
`@shared/types`; `msw: 2.x` in `@providers/shared`). pnpm DOES resolve `catalog:`
inside `peerDependencies`. The `peerDependenciesMeta.optional: true` flags stay
as-is.

### 1.4 `savePrefix` / `.npmrc`

`savePrefix` is read from `.npmrc` (`save-prefix=""`), NOT from
`pnpm-workspace.yaml`. Add `save-prefix=""` to root `.npmrc` so any future
`pnpm add` writes an exact spec instead of `^`.

---

## 2. Override classification table (the load-bearing artifact)

**Method:** each override name was grepped across all 90 workspace manifests.
DIRECT = declared in ≥1 manifest. TRANSITIVE-only = declared in 0 manifests.

### 2.1 DIRECT → migrate to catalog (remove from overrides)

react family, zod, pino, typescript, @anthropic-ai/sdk, @langchain/_,
@opentelemetry/_ (the 4 override-forced), cloudinary, fastify, handlebars, axios,
form-data, validator, ws, uuid, next, next-intl, postcss, vitest. The
override-forces-newer names (langchain/fastify/cloudinary/handlebars/OTel-4) adopt
the **override (newer)** value in the catalog. `dompurify` re-grepped at apply time
→ 0 decls → kept in overrides.

#### 2.1.a Dual-role handling — the override REFERENCES the catalog (step 1b)

A **dual-role** package is BOTH a direct dependency (→ catalog entry) AND must
force its pinned version onto transitive copies (→ `pnpm.overrides` entry). The
override **REFERENCES the catalog** via the `catalog:` protocol instead of
duplicating the literal version. pnpm resolves `catalog:` / `catalog:<name>` inside
`pnpm.overrides`, so the catalog stays the single source of truth. The relocation
is resolution-neutral by construction (catalog value == the literal it replaces),
so `pnpm install` leaves the lockfile **byte-identical**. The 10 dual-role
overrides converted in step 1b: axios, form-data, validator, uuid, ws, postcss →
`catalog:`; the 4 OTel override-forced → `catalog:otel`.

### 2.2 TRANSITIVE-only → STAY in `pnpm.overrides`

No manifest declares these; each is a CVE patch or a consistency force on an
indirect dependency. Catalogs cannot express "force a version on a package I don't
depend on". Keep all: shell-quote, esbuild, xmlhttprequest-ssl,
@babel/plugin-transform-modules-systemjs, @hono/node-server, @protobufjs/utf8,
@smithy/config-resolver, @tootallnate/once, @xmldom/xmldom, bn.js, brace-expansion,
defu, diff, fast-uri, fast-xml-builder, flatted, follow-redirects, googleapis-common,
hono, icu-minify, js-yaml, jws, lodash, markdown-it, minimatch, path-to-regexp,
protobufjs, qs, rollup, serialize-javascript, tough-cookie, vite, xmlhttprequest,
@opentelemetry/api-logs (the OTel 5-version unifier).

### 2.3 Dual-role / scoped — SPLIT (catalog the direct, keep the scoped override)

- `google-auth-library`: catalog the DIRECT 9.14.1 (youtube) + keep
  `"google-auth-library@10": "10.3.0"` scoped override.
- `gaxios@7` → `7.1.4`: overrides only (NOT declared).
- `msw>path-to-regexp` → `6.3.0`: overrides only (nested selector, load-bearing —
  msw needs v6 while the tree top-level forces v8). No catalog representation.

### 2.4 Classification summary

DIRECT → catalog: ~35 entries. TRANSITIVE-only → overrides (kept): ~34. Dual-role
split: 3.

---

## 3. The 13 drifters — reconciliation targets (step 3)

@prisma/client 7.6.0, opossum 9.0.0, prom-client 15.1.3, zustand 5.0.12,
@opentelemetry/api-logs (single via override), vitest 4.1.8, zod 4.4.3 (reconcile
UP — override is STALE-BEHIND the apps), next-intl 4.9.2, postcss 8.5.14, uuid
13.0.1, validator 13.15.22, @langchain/core 1.2.0, @langchain/langgraph 1.4.4.

> **`zod` reconciliation note:** the override pins `zod: 4.3.6` but the apps declare
> `4.4.3`. Reconcile UP to `4.4.3`, then catalog it. Verify
> `fastify-type-provider-zod@6.1.0` accepts zod 4.4.x.

---

## 4. Per-family latest-stable bump order (step 4)

Updater `taze -l --maturity-period 7`. One child PR per family. `--frozen-lockfile`
between families. Verify-after-each = full fitness/test/build gate. Order:
04a-toolchain, 04b-otel, 04c-react, 04d-tiptap, 04e-langchain, 04f-googleapis,
04g-runtime (LAST), 04h-misc.

> **Atomic-family rule (ADR-0018):** a family PR bumps ALL siblings or NONE. A
> half-bumped family is the drift-hydra and is rejected by `syncpack lint`.

---

## 5. CI guard wiring (step 5)

### 5.1 syncpack config — `.syncpackrc.json` (new, repo root)

workspace-protocol ignore group + single-version `highestSemver` group +
`semverGroups.range: ""` exact-range gate. `syncpack list-mismatches` is the CI gate
command (not `lint` — syncpack@12 reports `catalog:` refs as `UnsupportedMismatch`).

### 5.2 Where the guards plug into `.github/workflows/`

Add a `dependency-consistency` job to **`fitness.yml`** (D5 — the invariant home).
Steps: `syncpack list-mismatches`, `pnpm install --frozen-lockfile`,
`pnpm dedupe --check`. The existing `dependency-updates.yml` is marked
`# superseded-by-renovate` (its `pnpm audit` analysis job is retained).

### 5.3 Renovate config — `.github/renovate.json` (new)

`rangeStrategy: pin`, `pnpm-catalog` manager (catalog-aware), family `groupName`s
(react/tiptap/langchain/googleapis/opentelemetry), `minimumReleaseAge: 7 days`
(14 for runtime-critical P0).

---

## 6. Q2 — the 3 ignored GHSAs (approved: dated-debt, do NOT move auditConfig)

The `pnpm.auditConfig.ignoreGhsas` block keeps its 3 entries in `package.json`. Each
gets a dated-debt entry (§7 inventory, dated 2026-06-19) + a `SECURITY_CANON.md`
note with reason + remove-when: `GHSA-q7cg-457f-vx79` (request via wait-on),
`GHSA-p8p7-x288-28g6` (request SSRF), `GHSA-848j-6mx2-7j84` (elliptic).

---

## 7. ADR-style decisions

- **D1** — default catalog + one named `otel` catalog (not all-named, not all-default).
- **D2** — DIRECT → catalog, TRANSITIVE → overrides (declared-by-a-manifest is the bright line).
- **D3** — dual-role packages → catalog the declared version, keep the scoped override.
- **D4** — CVE-floor packages carry the floor in the catalog (with `# CVE floor` comment), not a range.
- **D5** — wire the guard into `fitness.yml`, not a new workflow.

---

## 8. Risks specific to the design

| Risk                                                                                  | Mitigation                                                                              |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Removing an override **downgrades** the package (override forced newer than manifest) | Catalog adopts the override (newer) value; step-1 diff review asserts no version DROPS. |
| `dompurify` mis-classified                                                            | Step-1 applier re-greps; 0 decls → overrides.                                           |
| `catalog:` inside `peerDependencies` unsupported                                      | pnpm 10.16.0 supports it; assert with a 1-package smoke first.                          |
| `msw>path-to-regexp` selector dropped                                                 | D3 marks it MUST-KEEP verbatim; `--frozen-lockfile` catches the break.                  |
| `zod 4.4.3` breaks `fastify-type-provider-zod@6.1.0`                                  | Step-3 asserts the peer range; full API integration tier gates the reconcile PR.        |
| OOM on the 9GB box                                                                    | Run apply with Edward's dev stack PAUSED.                                               |

---

## Next step

`sdd-tasks` — break these 5 steps + 8 family PRs into ordered, verifiable task units.
