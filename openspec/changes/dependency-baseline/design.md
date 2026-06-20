# Design: Dependency-Freshness Baseline (catalogs + single-version pin)

> **Phase:** SDD design (the technical HOW). **Change:** `dependency-baseline`.
> **Canon:** ADR-0018 (Accepted). **Proposal:** `proposal.md` (approved).
> **Store:** openspec.

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

| Step | Child PR                             | What it does                                                                                            | Gate before next                                |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1    | `dep-baseline/01-structure`          | Catalogs at **CURRENT** versions + syncpack config + 90 manifests → `catalog:`. Upgrade-free.           | Full build + LXC-safe tests + 27 fitness green. |
| 2    | `dep-baseline/02-wildcards`          | Kill the 3 wildcards (`next-intl`, `zustand`, `msw`); fold each at its resolved exact into the catalog. | `syncpack lint` + `--frozen-lockfile`.          |
| 3    | `dep-baseline/03-reconcile`          | Reconcile the 13 drifters to single versions (runtime-critical first).                                  | Build + tests + `dedupe --check`.               |
| 4    | `dep-baseline/04-fam-<name>` (N PRs) | Per-family latest-stable bump, **verify-after-each**, `--frozen-lockfile` between families.             | Full fitness/test gate per family.              |
| 5    | `dep-baseline/05-final-lint`         | Wire the CI guard + Renovate; final `syncpack lint` + `dedupe --check` = the pinned baseline.           | All success criteria.                           |

> **Why structure before version (ADR-0018 §Risks):** step 1 changes ZERO
> resolved versions — it only relocates specs to `catalog:`. That isolates "did
> the catalog plumbing break anything?" from "did a version bump break
> something?" If a later family must be dropped, step 1 still stands alone.

---

## 1. Catalog structure (`pnpm-workspace.yaml`)

### 1.1 Decision: the default catalog + one named catalog for the OTel set

Use the **default catalog** (`catalog:` reference, no name) for the bulk of
shared deps — it is the lowest-ceremony reference and every manifest already
agrees on one version per package after reconciliation. Use **one named
catalog** `catalogs.otel` ONLY for the OpenTelemetry set, because the OTel
packages move as a locked family on their own release train (the `0.NNN.0`
instrumentation line vs the `2.x` core/SDK line) and a named group documents
that they bump together. Everything else (react family, tiptap family, langchain
family, googleapis family) lives in the default catalog with a version-locked
**grouping comment** rather than a separate named catalog — named catalogs add
reference churn (`catalog:react`) across 90 manifests for no mechanical benefit
once syncpack enforces single-version.

```yaml
# pnpm-workspace.yaml (shape — versions are illustrative; step 1 freezes CURRENT,
# step 4 bumps to latest-stable)
catalogMode: strict # off-catalog `pnpm add` errors before CI
# savePrefix lives in .npmrc (see §1.4) — pnpm reads save-prefix from npmrc,
# NOT from pnpm-workspace.yaml. Documented here so the intent is co-located.

catalog:
  # ── React family (move atomically: react + react-dom + @types) ──
  react: 19.2.4
  react-dom: 19.2.4
  "@types/react": 19.2.14
  "@types/react-dom": 19.2.3

  # ── Tiptap + prosemirror family (atomic) ──
  "@tiptap/core": 3.27.1
  "@tiptap/react": 3.27.1
  "@tiptap/pm": 3.27.1
  "@tiptap/starter-kit": 3.27.1
  "@tiptap/extension-character-count": 3.27.1
  "@tiptap/extension-placeholder": 3.27.1

  # ── LangChain family (atomic) ──
  "@langchain/core": 1.2.0 # was: api 1.1.46 + override 1.2.0 → unify on override
  "@langchain/langgraph": 1.4.4 # was: api 1.3.1 + override 1.4.4 → unify on override

  # ── googleapis family (atomic; NOTE the @10 scoped override stays in overrides) ──
  google-auth-library: 9.14.1 # DIRECT 9.x in youtube; the @10 transitive is overrides-only
  googleapis: 160.0.0

  # ── Build/test toolchain (single-version drifters) ──
  vitest: 4.1.8 # drift 4.0.18 ↔ 4.1.8 → unify on 4.1.8
  typescript: 5.9.3
  msw: 2.14.3 # wildcard 2.x + 2.14.3 → fold at exact
  next: 16.2.6
  next-intl: 4.9.2 # wildcard * + 4.9.0/4.9.2 → fold at 4.9.2
  postcss: 8.5.14 # drift 8.5.10 ↔ 8.5.14 → unify on 8.5.14 (newer)
  zustand: 5.0.12 # wildcard * + 5.0.11/5.0.12 → fold at 5.0.12 (newer)

  # ── Runtime-critical drifters ──
  "@prisma/client": 7.6.0 # drift 7.4.1 ↔ 7.6.0 → unify on 7.6.0 (engine match)
  opossum: 9.0.0 # drift 8.0.0 ↔ 9.0.0 → unify on 9.0.0 (fitness #25)
  prom-client: 15.1.3 # drift 15.0.0 ↔ 15.1.3 → unify on 15.1.3

  # ── App/server runtime (DIRECT) ──
  fastify: 5.8.5 # decl 5.6.1 + override 5.8.5 → unify on override (newer)
  pino: 10.3.1
  zod: 4.3.6 # drift 4.3.6 ↔ 4.4.3 → reconcile (see §3 note)
  "@anthropic-ai/sdk": 0.91.1
  cloudinary: 2.7.0 # decl 2.0.0 + override 2.7.0 → unify on override
  handlebars: 4.7.9 # decl 4.7.8 + override 4.7.9 → unify on override
  axios: 1.17.0 # DUAL: DIRECT tiktok 1.7.7 + CVE floor — catalog carries floor
  form-data: 4.0.6 # DUAL: DIRECT tiktok 4.0.0 + CVE floor
  validator: 13.15.22 # DUAL: DIRECT api 13.15.15 + CVE floor
  uuid: 13.0.1 # drift 13.0.0 ↔ 13.0.1 → unify on 13.0.1
  ws: 8.21.0 # DUAL: DIRECT api + CVE floor
  fast-xml-parser: 5.7.0 # DUAL: DIRECT (if any) + CVE floor

  # ── OTel: prefer the named catalog below; kept out of default ──

catalogs:
  otel:
    "@opentelemetry/api": 1.9.1
    "@opentelemetry/auto-instrumentations-node": 0.75.0 # decl 0.72.0 + override 0.75.0 → override
    "@opentelemetry/core": 2.8.0 # decl 2.6.1 + override 2.8.0 → override
    "@opentelemetry/exporter-prometheus": 0.217.0 # decl 0.214.0 + override 0.217.0 → override
    "@opentelemetry/sdk-node": 0.217.0 # decl 0.214.0 + override 0.217.0 → override
    "@opentelemetry/exporter-trace-otlp-http": 0.217.0
    "@opentelemetry/instrumentation": 0.217.0
    "@opentelemetry/instrumentation-fastify": 0.57.0
    "@opentelemetry/instrumentation-fs": 0.33.0
    "@opentelemetry/instrumentation-http": 0.217.0
    "@opentelemetry/instrumentation-redis": 0.62.0
    "@opentelemetry/propagation-utils": 0.31.17
    "@opentelemetry/resources": 2.8.0
    "@opentelemetry/semantic-conventions": 1.40.0
```

> **The OTel override-is-the-bump discovery (flag for Edward):** the
> `observability/opentelemetry` manifest declares OLDER versions
> (`core` 2.6.1, `sdk-node` 0.214.0) than the root overrides force
> (`core` 2.8.0, `sdk-node` 0.217.0). The override is silently performing a
> latest-stable bump that the manifest never recorded. Same for `@langchain/core`
> (api 1.1.46 vs override 1.2.0) and `fastify` (5.6.1 vs override 5.8.5). The
> catalog must adopt the **override (newer)** version as the single pin AND the
> manifest specs change to `catalog:` — otherwise removing the override would
> silently DOWNGRADE these packages to the stale manifest value. This is the
> single highest-risk relocation in step 1.

### 1.2 Manifest reference rewrite

Every DIRECT spec across the 90 manifests changes to a catalog reference:

```jsonc
// before                         // after (default catalog)
"react": "19.2.4"            →    "react": "catalog:"
"@prisma/client": "7.6.0"    →    "@prisma/client": "catalog:"
// OTel (named catalog)
"@opentelemetry/core": "2.6.1" → "@opentelemetry/core": "catalog:otel"
```

`workspace:*` specs for local packages (`@core/*`, `@adapters/*`, `@providers/*`,
`@shared/types`, etc.) are **untouched** — catalogs cover registry deps only.

### 1.3 Wildcard peerDeps — special handling

The 3 wildcards live as `peerDependencies`, not regular deps:

| Wildcard         | Location                    | Current                      | Catalog target | peerDep rewrite           |
| ---------------- | --------------------------- | ---------------------------- | -------------- | ------------------------- |
| `next-intl: "*"` | `@shared/types` peerDep     | admin 4.9.0 / client 4.9.2   | `4.9.2`        | `"next-intl": "catalog:"` |
| `zustand: "*"`   | `@shared/types` peerDep     | admin 5.0.11 / client 5.0.12 | `5.0.12`       | `"zustand": "catalog:"`   |
| `msw: "2.x"`     | `@providers/shared` peerDep | 2.14.3 everywhere            | `2.14.3`       | `"msw": "catalog:"`       |

pnpm DOES resolve `catalog:` inside `peerDependencies` (supported since the
catalogs feature shipped). The `peerDependenciesMeta.optional: true` flags stay
as-is. The consuming apps (admin/client) keep declaring the package as a regular
dep so the peer is satisfied; those specs also become `catalog:`.

### 1.4 `savePrefix` / `.npmrc`

`savePrefix` is read from `.npmrc` (`save-prefix=""`), NOT from
`pnpm-workspace.yaml`. Add to root `.npmrc`:

```ini
save-prefix=""
```

so any future `pnpm add` writes an exact spec instead of `^`. This backs the
ADR-0018 "no `^ ~ * >=`" rule at the tooling level even before syncpack lints it.

---

## 2. Override classification table (the load-bearing artifact)

**Method:** each override name was grepped across all 90 workspace manifests
(`dependencies` / `devDependencies` / `peerDependencies`). DIRECT = declared in
≥1 manifest. TRANSITIVE-only = declared in 0 manifests.

### 2.1 DIRECT → migrate to catalog (remove from overrides)

| Override                                    | Declared by (sample)                                                | Class      | Destination  | Note                                                     |
| ------------------------------------------- | ------------------------------------------------------------------- | ---------- | ------------ | -------------------------------------------------------- |
| `react`                                     | apps/admin, apps/client, apps/api, ui, query-client, browser-logger | DIRECT     | catalog      | react family                                             |
| `react-dom`                                 | apps/admin, apps/client, ui, query-client, browser-logger           | DIRECT     | catalog      | react family                                             |
| `@types/react`                              | apps/admin, apps/client, ui, query-client, browser-logger           | DIRECT     | catalog      | react family                                             |
| `@types/react-dom`                          | apps/admin, apps/client, ui                                         | DIRECT     | catalog      | react family                                             |
| `zod`                                       | apps/api, apps/admin, apps/client, apps/workers, api-common         | DIRECT     | catalog      | **drift 4.3.6↔4.4.3**                                    |
| `pino`                                      | ~30 packages (logger, providers, adapters, api)                     | DIRECT     | catalog      |                                                          |
| `typescript`                                | ~80 manifests (devDep)                                              | DIRECT     | catalog      |                                                          |
| `@anthropic-ai/sdk`                         | apps/api                                                            | DIRECT     | catalog      |                                                          |
| `@langchain/core`                           | apps/api (1.1.46)                                                   | DIRECT     | catalog      | **override forces newer 1.2.0**                          |
| `@langchain/langgraph`                      | apps/api (1.3.1)                                                    | DIRECT     | catalog      | **override forces newer 1.4.4**                          |
| `@opentelemetry/auto-instrumentations-node` | observability/opentelemetry (0.72.0)                                | DIRECT     | catalog:otel | **override forces 0.75.0**                               |
| `@opentelemetry/core`                       | observability/opentelemetry (2.6.1)                                 | DIRECT     | catalog:otel | **override forces 2.8.0**                                |
| `@opentelemetry/exporter-prometheus`        | observability/opentelemetry (0.214.0)                               | DIRECT     | catalog:otel | **override forces 0.217.0**                              |
| `@opentelemetry/sdk-node`                   | observability/opentelemetry (0.214.0)                               | DIRECT     | catalog:otel | **override forces 0.217.0**                              |
| `cloudinary`                                | storage-cloudinary (2.0.0)                                          | DIRECT     | catalog      | **override forces 2.7.0**                                |
| `fastify`                                   | apps/api (5.6.1), api-common (5.6.1)                                | DIRECT     | catalog      | **override forces 5.8.5**                                |
| `handlebars`                                | @shared/types (4.7.8)                                               | DIRECT     | catalog      | **override forces 4.7.9**                                |
| `axios`                                     | providers/tiktok (1.7.7)                                            | DIRECT     | catalog      | **DUAL — CVE floor 1.17.0**                              |
| `form-data`                                 | providers/tiktok (4.0.0)                                            | DIRECT     | catalog      | **DUAL — CVE floor 4.0.6**                               |
| `fast-xml-parser`                           | (provider adapters)                                                 | DIRECT     | catalog      | **DUAL — CVE floor 5.7.0**                               |
| `dompurify`                                 | (via isomorphic-dompurify chain / direct)                           | DIRECT\*   | catalog      | **DUAL — verify decl in step 1; if 0 decls → overrides** |
| `validator`                                 | apps/api (13.15.15)                                                 | DIRECT     | catalog      | **DUAL — CVE floor 13.15.22**                            |
| `ws`                                        | apps/api (8.21.0)                                                   | DIRECT     | catalog      | **DUAL — CVE floor**                                     |
| `uuid`                                      | apps/api (13.0.0), workers (13.0.0), dlq (13.0.0)                   | DIRECT     | catalog      | **drift 13.0.0↔13.0.1**                                  |
| `next`                                      | apps/admin, apps/client (16.2.6)                                    | DIRECT     | catalog      |                                                          |
| `next-intl`                                 | apps/admin (4.9.0), apps/client (4.9.2), shared peer `*`            | DIRECT     | catalog      | **wildcard + drift**                                     |
| `postcss`                                   | apps/admin (8.5.14), apps/client (8.5.14)                           | DIRECT     | catalog      | **override 8.5.10 STALE vs decl**                        |
| `vitest`                                    | ~60 manifests                                                       | DIRECT     | catalog      | **drift 4.0.18↔4.1.8**                                   |
| `esbuild`                                   | (override only — pin for vite)                                      | TRANSITIVE | overrides    | see §2.2 (kept)                                          |

> `dompurify`: `apps/api` uses `isomorphic-dompurify` (a wrapper); whether
> `dompurify` itself is a DIRECT dep depends on a wrapper-internal declaration.
> **Step 1 action:** re-grep `"dompurify":` across manifests at apply time; if 0
> direct declarations, it is TRANSITIVE → keep in overrides. Flagged so the
> applier confirms rather than guesses.

> `google-auth-library` (DIRECT, youtube 9.14.1) is handled in §2.3 (dual
> identity vs the `@10` scoped override).

### 2.2 TRANSITIVE-only → STAY in `pnpm.overrides`

No manifest declares these; each is a CVE patch or a consistency force on an
indirect dependency. Catalogs cannot express "force a version on a package I
don't depend on" — overrides are the correct mechanism. **Keep all of these.**

| Override                                   | Why it exists             | Keep-reason                                                       |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| `shell-quote`                              | CVE pin                   | transitive; §7 SHELL-QUOTE-OVERRIDE remove-when gate              |
| `esbuild`                                  | pin for vite/build chain  | transitive; §7 ESBUILD-OVERRIDE remove-when (vite allows ≥0.28.1) |
| `xmlhttprequest-ssl`                       | CVE pin                   | transitive (engine.io chain)                                      |
| `@babel/plugin-transform-modules-systemjs` | consistency               | transitive (build)                                                |
| `@hono/node-server`                        | consistency               | transitive                                                        |
| `@protobufjs/utf8`                         | consistency               | transitive (protobuf chain)                                       |
| `@smithy/config-resolver`                  | consistency               | transitive (AWS SDK chain)                                        |
| `@tootallnate/once`                        | CVE/consistency           | transitive                                                        |
| `@xmldom/xmldom`                           | CVE pin                   | transitive                                                        |
| `bn.js`                                    | consistency               | transitive (crypto chain)                                         |
| `brace-expansion`                          | CVE pin                   | transitive                                                        |
| `defu`                                     | consistency               | transitive                                                        |
| `diff`                                     | consistency               | transitive                                                        |
| `fast-uri`                                 | consistency               | transitive (fastify chain)                                        |
| `fast-xml-builder`                         | consistency               | transitive                                                        |
| `flatted`                                  | consistency               | transitive                                                        |
| `follow-redirects`                         | CVE pin                   | transitive (axios chain)                                          |
| `googleapis-common`                        | consistency               | transitive (googleapis chain)                                     |
| `hono`                                     | consistency               | transitive                                                        |
| `icu-minify`                               | consistency               | transitive (next-intl chain)                                      |
| `js-yaml`                                  | CVE pin                   | transitive                                                        |
| `jws`                                      | CVE pin                   | transitive (jwt chain)                                            |
| `lodash`                                   | CVE pin                   | transitive                                                        |
| `markdown-it`                              | consistency               | transitive                                                        |
| `minimatch`                                | CVE pin                   | transitive                                                        |
| `path-to-regexp`                           | CVE pin                   | transitive (the `8.4.0` top-level pin)                            |
| `protobufjs`                               | CVE pin                   | transitive                                                        |
| `qs`                                       | CVE pin                   | transitive                                                        |
| `rollup`                                   | consistency               | transitive (vite chain)                                           |
| `serialize-javascript`                     | CVE pin                   | transitive                                                        |
| `tough-cookie`                             | CVE pin                   | transitive (request chain — ties §7 GHSA)                         |
| `vite`                                     | pin for build chain       | transitive                                                        |
| `xmlhttprequest`                           | CVE pin                   | transitive                                                        |
| `@opentelemetry/api-logs`                  | OTel 5-version unifier    | **transitive; NOT declared — see §2.4**                           |
| `gaxios@7`                                 | googleapis transitive pin | **scoped selector — see §2.3**                                    |

> `@opentelemetry/api-logs` is the 5-versions-in-store drifter from the ADR. It
> is **not declared in any manifest** (it is a transitive of `sdk-node`). It is
> currently NOT in the overrides block either. **Action:** add an explicit
> `"@opentelemetry/api-logs": "<resolved>"` to `pnpm.overrides` (NOT the catalog,
> since no manifest declares it) so the 5-version split collapses to one — this
> is the override that closes the OTel "multiple API instances → no-op signals"
> trap.

### 2.3 Dual-role / scoped — SPLIT (catalog the direct, keep the scoped override)

These three need both mechanisms. The catalog handles the DIRECT major; the
scoped override (pnpm-only syntax, no catalog equivalent) handles a DIFFERENT
transitive major.

| Override (current)                  | Direct identity             | Transitive identity                                                                      | Destination                                                                                                                  |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `google-auth-library@10` → `10.3.0` | youtube declares `9.14.1`   | googleapis pulls `10.x`                                                                  | **catalog** `google-auth-library: 9.14.1` (direct) **+ keep** `"google-auth-library@10": "10.3.0"` in overrides (transitive) |
| `gaxios@7` → `7.1.4`                | NOT declared anywhere       | googleapis/google-auth pull `7.x`                                                        | **overrides only** — `"gaxios@7": "7.1.4"` stays (no direct dep to catalog)                                                  |
| `msw>path-to-regexp` → `6.3.0`      | `msw` is DIRECT (→ catalog) | `path-to-regexp` nested under msw needs `6.3.0` (msw wants v6, repo top-level forces v8) | **overrides only** — `"msw>path-to-regexp": "6.3.0"` stays (nested selector, catalog cannot express parent>child)            |

> **`msw>path-to-regexp` is load-bearing:** the top-level `path-to-regexp` is
> pinned `8.4.0` (CVE), but `msw` requires the `6.x` line. The nested selector
> `msw>path-to-regexp: 6.3.0` scopes the v6 ONLY under msw while the rest of the
> tree gets v8. This selector has NO catalog representation and MUST stay in
> overrides verbatim. Removing it breaks msw resolution.

### 2.4 Classification summary

- **DIRECT → catalog:** 28 names in the default catalog + 4 OTel names in
  `catalogs.otel` + 3 wildcard folds (next-intl, zustand, msw) = **~35 catalog
  entries** (plus the locked-family siblings the catalog also pins for atomic
  moves: tiptap, googleapis, langchain, react `@types`).
- **TRANSITIVE-only → overrides (kept):** ~34 entries, including the new explicit
  `@opentelemetry/api-logs` unifier.
- **Dual-role split:** 3 (`google-auth-library@10`, `gaxios@7`,
  `msw>path-to-regexp`) — scoped/nested forms stay in overrides; only the
  declared `google-auth-library` 9.x crosses to the catalog.

---

## 3. The 13 drifters — reconciliation targets (step 3)

Target single versions, runtime-critical first. Each row is asserted, then
`pnpm install --frozen-lockfile` + `syncpack lint` before the next.

| #   | Package                   | Current drift                                                       | Target                | Why (priority)                                |
| --- | ------------------------- | ------------------------------------------------------------------- | --------------------- | --------------------------------------------- |
| 1   | `@prisma/client`          | 7.4.1 (db-prisma) ↔ 7.6.0 (api, infra/prisma)                       | **7.6.0**             | engine/client mismatch — runtime-critical P0  |
| 2   | `opossum`                 | 8.0.0 (external-apis) ↔ 9.0.0 (db-prisma, queue-bullmq)             | **9.0.0**             | circuit-breaker invariants + fitness #25 — P0 |
| 3   | `prom-client`             | 15.0.0 (cache-redis, storage-cloudinary) ↔ 15.1.3 (everywhere else) | **15.1.3**            | metrics consistency — P0                      |
| 4   | `zustand`                 | 5.0.11 (admin) ↔ 5.0.12 (client) + `*` (shared)                     | **5.0.12**            | store consistency — P0                        |
| 5   | `@opentelemetry/api-logs` | 5 versions in store (transitive)                                    | single (via override) | OTel no-op-signals trap — P0                  |
| 6   | `vitest`                  | 4.0.18 (~50 pkgs) ↔ 4.1.8 (api, client, admin, cache-redis…)        | **4.1.8**             | test-runner consistency                       |
| 7   | `zod`                     | 4.3.6 (api-common, override) ↔ 4.4.3 (api, admin, client, workers)  | **4.4.3**             | see note below                                |
| 8   | `next-intl`               | 4.9.0 (admin) ↔ 4.9.2 (client) + `*`                                | **4.9.2**             | i18n consistency                              |
| 9   | `postcss`                 | 8.5.10 (override, STALE) ↔ 8.5.14 (admin, client)                   | **8.5.14**            | build consistency                             |
| 10  | `uuid`                    | 13.0.0 (api, workers, dlq) ↔ 13.0.1 (override)                      | **13.0.1**            | id consistency                                |
| 11  | `validator`               | 13.15.15 (api) ↔ 13.15.22 (override)                                | **13.15.22**          | CVE floor wins                                |
| 12  | `@langchain/core`         | 1.1.46 (api) ↔ 1.2.0 (override)                                     | **1.2.0**             | LLM family lock                               |
| 13  | `@langchain/langgraph`    | 1.3.1 (api) ↔ 1.4.4 (override)                                      | **1.4.4**             | LLM family lock                               |

> **`zod` reconciliation note (flag for Edward):** the existing override pins
> `zod: 4.3.6` but the apps already declare `4.4.3`. The override is STALE-BEHIND
> the apps — the opposite direction from the OTel case. Reconcile UP to `4.4.3`
> (the apps' newer value), then catalog it. `api-common` at `4.3.6` is the laggard
> and bumps with the rest. Verify `fastify-type-provider-zod@6.1.0` accepts
> zod 4.4.x at the reconcile step (it does per its peer range, but assert in CI).

---

## 4. Per-family latest-stable bump order (step 4)

Updater: `taze -l --maturity-period 7` (7-day yank buffer; `newest`/`greatest`/
`--pre` forbidden per ADR-0018). One child PR per family. `--frozen-lockfile`
between families so a drifted lockfile is a hard failure, not a silent
re-resolve. **Verify-after-each = full fitness/test/build gate before the next
family starts.**

Order (lowest blast-radius first, runtime-critical families gated hardest):

1. **`04a-toolchain`** — `typescript`, `vitest`, `eslint*`, `prettier`, `@types/*`.
   Cheapest to verify (compile + lint). Establishes the green baseline.
2. **`04b-otel`** — the whole `catalogs.otel` set, moved together. Verify metrics
   endpoint + span emission in integration tier.
3. **`04c-react`** — `react` + `react-dom` + `@types/react` + `@types/react-dom`,
   atomic. Verify frontend unit tests + size-limit.
4. **`04d-tiptap`** — `@tiptap/*` + `prosemirror-*`, atomic. Verify editor stories.
5. **`04e-langchain`** — `@langchain/*`, atomic. Verify AI eval tier.
6. **`04f-googleapis`** — `googleapis` + `google-auth-library` (+ the `@10`/`gaxios@7`
   scoped overrides bumped in lockstep). Verify youtube provider contract tests.
7. **`04g-runtime`** — `@prisma/client`, `opossum`, `prom-client`, `fastify`,
   `pino`, `bullmq`, `ioredis`. Runtime-critical — full integration + saga + RLS
   tiers. Land LAST so the rest of the tree is already green underneath it.
8. **`04h-misc`** — remaining single-package bumps (`zod`, `next`/`next-intl`,
   `cloudinary`, `handlebars`, `uuid`, `validator`, etc.).

> **Atomic-family rule (ADR-0018):** a family PR bumps ALL siblings in the same
> `taze` pass or NONE. A half-bumped family (e.g. `@tiptap/core` 3.28 with
> `@tiptap/pm` 3.27) is the drift-hydra and is rejected by `syncpack lint` (the
> single-version group catches the mismatch).

---

## 5. CI guard wiring (step 5)

### 5.1 syncpack config — `.syncpackrc.json` (new, repo root)

```jsonc
{
  "$schema": "https://unpkg.com/syncpack@latest/dist/schema.json",
  "dependencyTypes": ["prod", "dev", "peer", "overrides"],
  "versionGroups": [
    {
      // Local workspace packages keep workspace:* — exclude from version checks.
      "label": "workspace protocol",
      "dependencies": [
        "@core/**",
        "@adapters/**",
        "@providers/**",
        "@monitoring/**",
        "@observability/**",
        "@packages/**",
        "@ports/**",
        "@infra/**",
        "@shared/**",
        "@apps/**",
      ],
      "isIgnored": true,
    },
    {
      // Everything else: exactly ONE version repo-wide (the single-version invariant).
      "label": "single version across the monorepo",
      "dependencies": ["**"],
      "packages": ["**"],
      "preferVersion": "highestSemver",
    },
  ],
  "semverGroups": [
    {
      // Exact pins only — no ^ ~ * >= (ADR-0018). The exact-range gate.
      "label": "exact ranges only",
      "range": "",
      "dependencies": ["**"],
      "packages": ["**"],
    },
  ],
}
```

- **`semverGroups.range: ""`** = the exact-range gate (any `^`/`~`/`>=` fails).
- **`versionGroups` highestSemver** = the single-version gate (any duplicate
  fails). Together they ARE the ADR-0018 invariant, mechanically.
- `syncpack list-mismatches` is the report; `syncpack lint` (exit non-zero on
  mismatch) is the CI gate.

### 5.2 Where the guards plug into `.github/workflows/`

Add a `dependency-consistency` job to **`fitness.yml`** (it is the
invariant-enforcement workflow; this is one more invariant). It runs on the same
`push`/`pull_request` triggers:

```yaml
dependency-consistency:
  name: Dependency consistency (syncpack + frozen-lockfile + dedupe)
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node-pnpm-cache
    - name: syncpack lint (single-version + exact-range)
      run: pnpm exec syncpack lint
    - name: Lockfile is frozen (no drift)
      run: pnpm install --frozen-lockfile
    - name: No duplicate versions in the store
      run: pnpm dedupe --check
```

- `--frozen-lockfile` turns a drifted `pnpm-lock.yaml` into a hard failure
  (a PR that edits a manifest without updating the lock fails here).
- `pnpm dedupe --check` fails if the store could be flattened further — the
  "≥2 versions resolved" signal the ADR targets.
- The existing **`ci.yml` → `security` job** (`pnpm audit --audit-level moderate`)
  stays as-is; the GHSA ignores (§6) keep it green.
- The existing **`dependency-updates.yml`** scheduled workflow is **superseded**
  by Renovate (§5.3) for the update mechanism, but its `pnpm audit` analysis job
  may remain as a daily security report. Mark it `# superseded-by-renovate` in
  step 5; do not delete in this change (out of scope — proposal §Out of Scope).

### 5.3 Renovate config — `.github/renovate.json` (new)

```jsonc
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "rangeStrategy": "pin", // ADR-0018: exact pins, never ^
  "lockFileMaintenance": { "enabled": true },
  "minimumReleaseAge": "7 days", // mirrors taze --maturity-period 7
  "ignorePresets": [":prHourlyLimit2"],
  "packageRules": [
    {
      "matchManagers": ["pnpm-catalog"], // Renovate is catalog-aware
      "rangeStrategy": "pin",
    },
    {
      "groupName": "react",
      "matchPackageNames": ["react", "react-dom", "@types/react", "@types/react-dom"],
    },
    { "groupName": "tiptap", "matchPackagePrefixes": ["@tiptap/", "prosemirror-"] },
    { "groupName": "langchain", "matchPackagePrefixes": ["@langchain/"] },
    {
      "groupName": "googleapis",
      "matchPackageNames": ["googleapis", "google-auth-library", "gaxios", "googleapis-common"],
    },
    { "groupName": "opentelemetry", "matchPackagePrefixes": ["@opentelemetry/"] },
    {
      "matchPackageNames": ["@prisma/client", "prisma", "opossum", "prom-client"],
      "labels": ["runtime-critical"],
      "minimumReleaseAge": "14 days", // extra buffer for the P0 set
    },
  ],
  "vulnerabilityAlerts": { "labels": ["security"], "rangeStrategy": "pin" },
}
```

- **`rangeStrategy: pin`** + **`pnpm-catalog` manager** = Renovate edits the
  catalog entry (one place) with an exact version. Family `groupName`s keep
  locked families moving in ONE PR (mirrors the atomic-family rule).
- **`minimumReleaseAge: 7 days`** = Renovate's equivalent of
  `taze --maturity-period 7`; runtime-critical gets 14.

---

## 6. Q2 — the 3 ignored GHSAs (approved: dated-debt, do NOT move auditConfig)

The `pnpm.auditConfig.ignoreGhsas` block keeps its 3 entries in `package.json`
(moving `auditConfig` to YAML is OUT OF SCOPE per the task). Each gets a
dated-debt entry + a `SECURITY_CANON.md` note with reason + remove-when.

| GHSA                  | Package                                                | Reason kept                                                                      | Remove-when                                                              |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GHSA-q7cg-457f-vx79` | `request` (`wait-on` chain via `jest-process-manager`) | transitive, no fixed upstream that satisfies the consumer's `wait-on ^7`         | when `jest-process-manager` ships `wait-on ^8` (§7 JOI-GHSA-IGNORE gate) |
| `GHSA-p8p7-x288-28g6` | `request` SSRF (medium)                                | transitive; ties to §2E SSRF-WEBHOOK — no direct exploit surface confirmed       | when the `request`-bearing dep is replaced or upstream patches           |
| `GHSA-848j-6mx2-7j84` | `elliptic` risky-crypto (low)                          | transitive (crypto chain); low severity, no signing path uses the affected curve | when the consuming dep bumps `elliptic`                                  |

**§7 inventory edit** (`docs/product/PENDING_WORK_INVENTORY.md` §7
UNDOCUMENTED-GHSA-IGNORES): convert the "no backlog/remove-when gate" flag into a
dated-debt line per GHSA with the remove-when above, dated `2026-06-19`.

**`SECURITY_CANon.md` note**: add to §Secrets-and-Environment's neighbour (or a
new short §"Audited audit-ignores") a table mirroring the above, so the security
canon records WHY each GHSA is ignored and the removal trigger — closing the
"undocumented ignore" smell without moving the mechanism.

---

## 7. ADR-style decisions

### D1 — default catalog + one named `otel` catalog (not all-named, not all-default)

- **Decision:** bulk deps in the default catalog; only the OTel set gets a named
  catalog `catalogs.otel`.
- **Rationale:** named catalogs add `catalog:<name>` reference churn across 90
  manifests; once `syncpack` enforces single-version, the mechanical benefit of
  named groups is zero. OTel earns a name purely as documentation of its
  independent release train (the `0.NNN` vs `2.x` split).
- **Rejected — all named catalogs:** maximal reference churn, no added safety.
- **Rejected — all default catalog (OTel included):** loses the self-documenting
  family boundary for the one set that bumps on its own cadence.

### D2 — DIRECT → catalog, TRANSITIVE → overrides (Edward's approved principle)

- **Decision:** declared-by-a-manifest is the bright line.
- **Rationale:** catalogs can only reference packages a manifest depends on;
  overrides are the only mechanism for forcing versions on indirect deps.
  The line is mechanical and greppable, so the applier cannot guess.
- **Rejected — everything to catalog:** impossible (catalog can't express
  transitive forces or nested selectors like `msw>path-to-regexp`).
- **Rejected — everything stays in overrides:** the ADR's entire point is one
  edit-point per shared version; overrides do not give manifests a `catalog:`
  reference, so drift stays possible.

### D3 — dual-role packages → catalog the declared version, keep the scoped override

- **Decision:** `google-auth-library` (declared 9.x) → catalog; the `@10` scoped
  override stays. `gaxios@7` and `msw>path-to-regexp` stay (no declared form).
- **Rationale:** the scoped/nested override syntax has NO catalog equivalent and
  targets a DIFFERENT major than the direct dep. Splitting preserves both intents.
- **Rejected — collapse to one version:** would force youtube's google-auth 9.x
  and googleapis' transitive 10.x to the same major → resolution break.

### D4 — CVE-floor packages carry the floor in the catalog comment, not a range

- **Decision:** `axios`, `form-data`, `validator`, `ws`, `fast-xml-parser`,
  `dompurify(?)` go to the catalog at the floor version with an inline
  `# CVE floor` comment; the override is removed.
- **Rationale:** the catalog pin IS exact and ≥ the floor, so the security intent
  holds without a range. The comment + `SECURITY_CANON` keep the intent auditable.
- **Rejected — keep both override + catalog:** double-source for the same version
  re-creates the drift the ADR kills; syncpack would flag it.

### D5 — wire the guard into `fitness.yml`, not a new workflow

- **Decision:** add `dependency-consistency` job to `fitness.yml`.
- **Rationale:** fitness.yml is the home of mechanical invariants; single-version
  - exact-pin is one more. Avoids a new required-check to register.
- **Rejected — new `dependency-consistency.yml`:** more surface, another required
  check to add to branch protection, no benefit over a job in the existing file.

---

## 8. Risks specific to the design

| Risk                                                                                                                  | Mitigation                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Removing an OTel/langchain/fastify override **downgrades** the package (override was forcing newer than the manifest) | Catalog adopts the override (newer) value; step-1 diff review asserts no version DROPS vs the resolved lockfile. |
| `dompurify` mis-classified (DIRECT vs transitive ambiguous via isomorphic-dompurify)                                  | Step-1 applier re-greps `"dompurify":`; 0 decls → overrides, else catalog. Flagged.                              |
| `catalog:` inside `peerDependencies` unsupported on the installed pnpm                                                | pnpm 10.16.0 supports it; assert with a 1-package smoke before the 90-manifest sweep.                            |
| `msw>path-to-regexp` selector dropped during the overrides cleanup                                                    | D3 marks it MUST-KEEP verbatim; CI `--frozen-lockfile` catches the resulting msw resolution break.               |
| `zod 4.4.3` breaks `fastify-type-provider-zod@6.1.0`                                                                  | Step-3 asserts the peer range; full API integration tier gates the reconcile PR.                                 |
| OOM on the 9GB box during the 90-manifest install/build                                                               | Run apply with Edward's dev stack PAUSED (proposal §Risks).                                                      |

---

## Checklist (design → tasks handoff)

- [ ] Catalog structure defined: default + `catalogs.otel`, `catalogMode: strict`, `save-prefix=""` in `.npmrc`.
- [ ] All ~70 overrides classified: ~35 → catalog, ~34 → overrides, 3 split (table §2).
- [ ] 3 wildcards resolved to exact (next-intl 4.9.2, zustand 5.0.12, msw 2.14.3).
- [ ] 13 drifters targeted (runtime-critical first, §3).
- [ ] Per-family bump order with verify-after-each (§4, 8 family PRs).
- [ ] 5 baseline steps sequenced as feature-branch-chain child PRs (Quick path).
- [ ] CI guard: syncpack `.syncpackrc.json` + `dependency-consistency` job in fitness.yml + Renovate `.github/renovate.json` (§5).
- [ ] Q2: 3 GHSAs → dated-debt in §7 inventory + SECURITY_CANON note (§6).

## Next step

`sdd-tasks` — break these 5 steps + 8 family PRs into ordered, verifiable task
units (the WHAT-to-do). This design is the architectural HOW; tasks are the steps.
