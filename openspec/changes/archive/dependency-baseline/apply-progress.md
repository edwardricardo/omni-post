# Apply Progress: dependency-baseline

> Consolidated apply-progress for the `dependency-baseline` change. Archived 2026-06-23
> (merged via PR #95 / `552c63a9`). Covers Steps 1 (`01-structure`), 1b
> (`01b-override-catalog-refs`), the Step 4 per-family bumps + Step 3 T3.5 transitive
> dedupe, and the Step 5 CI-guard wiring (applied in `07601968` with the
> `sensitive-edit` token).

## Status: DONE (all steps applied + CI-green + merged to main)

The dependency MODEL evolved mid-flight (Edward): TRANSITIVES are consumer-governed
(highest-in-range; multiple versions may coexist); a `pnpm.overrides` entry is justified
ONLY by a real CVE floor at the minimal patched version. "Always latest stable" applies to
DIRECT deps only. Codified in `docs/technical/ADR-0018`.

---

## Step 1 + 1b — structure + dual-role override refs

- **T1.1–T1.13 DONE.** catalogMode:strict + default `catalog:` (34 entries incl. 4 design-gap)
  - `catalogs.otel` (14 entries); `.npmrc save-prefix=""`; overrides surgery (26 DIRECT removed;
    34 transitive + 3 scoped kept); 94 manifests / 411 specs → `catalog:`/`catalog:otel`; lockfile
    re-resolved with **0 downgrades** (CRITICAL PASS) — reconcile-UP only.
- **T1.14:** `syncpack list-mismatches` exit 0 at Step 1; `dedupe --check` reached exit 0 at the
  END-STATE (after T3.5 + Step 4 flatten `62e12284`).
- **T1.15:** 27 fitness hard-zero locally; build/test green in tracker CI.
- **Step 1b:** the 10 dual-role overrides converted from literals → `catalog:` (6) / `catalog:otel`
  (4); lockfile byte-identical (`cf246d4b…`); all gates green.

### Key decisions / deviations (Step 1/1b)

1. **dompurify (T1.3.b):** 0 direct declarations → KEPT in `pnpm.overrides` (3.4.11), NOT cataloged.
2. **fast-xml-parser (T1.10):** 0 direct declarations → reclassified TRANSITIVE, KEPT in overrides at 5.7.0.
3. **zod direction (pulled forward from Step 3 T3.7):** reconcile-UP to 4.4.3 (apps' value), override removed in Step 1.
4. **4 design-gap drifters cataloged (NEW):** `@types/node`, `jsdom`, `tsx`, `@tanstack/react-query` — cataloged at MAX.
5. **postcss → 8.5.15** (tree resolved 8.5.15 transitively; "never pin lower").
6. **OTel non-override names kept at manifest-current** in Step 1; full set bump = Step 4 04b-otel; transitive dedupe = T3.5.

---

## Steps 2 + 3 — ABSORBED into Steps 1 + 4

- **Step 2 (wildcards):** T1.12 folded the 3 wildcard peerDeps to `catalog:` in Step 1; Step 4 bumped each
  to latest stable (next-intl 4.13.0, zustand 5.0.14, msw 2.14.6). 0 wildcards remain.
- **Step 3 (reconcile):** the 13 drifters reconciled UP in Step 1's catalog migration, then carried to latest
  stable by Step 4. Each resolves ONCE in the final lockfile.
- **T3.5 (OTel transitive dedupe):** `@opentelemetry/api-logs` GONE from the store (0 versions) — the OTel
  family bump collapsed the 5-version split. Residual split was in `@opentelemetry/instrumentation` (5 versions),
  `resources` (2), `semantic-conventions` (2) → 3 `pnpm.overrides` entries → `catalog:otel`; all collapse to ONE.
  Commit `193c223f`. After a `pnpm dedupe` flatten (`62e12284`), `dedupe --check` exits 0 (fully converged).

---

## Step 4 — Per-family latest-stable bumps (per-family work-unit commits on the tracker)

`taze` cannot read pnpm catalogs; latest-stable resolved via `npm view <pkg> time --json` + a 7-day
publish-age filter. Light-verify per family (LXC-safe): `--frozen-lockfile` exit 0 + `audit` exit 0 + 27
fitness hard-zero. Full build/test deferred to CI.

| Family / group         | result                                                                                                                                                    | commit     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| typescript             | 5.9.3 → **6.0.3** (MAJOR)                                                                                                                                 | `2c25d76c` |
| react family           | react/react-dom → **19.2.7**; @types/react → **19.2.17**                                                                                                  | `08e662b6` |
| OTel set (atomic)      | 0.219 line; resources 2.8.0; semantic-conventions 1.41.1                                                                                                  | `725c8363` |
| googleapis family      | google-auth-library 9.14.1 → **10.7.0** (MAJOR); googleapis → **173.0.0**; scoped in lockstep                                                             | `08f4f6d9` |
| prisma                 | @prisma/client 7.6.0 → **7.8.0** (+ CLI)                                                                                                                  | `b1cce35a` |
| next + next-intl       | next 16.2.6→16.2.9; next-intl → **4.13.0**                                                                                                                | `4681bcb7` |
| @types/node + jsdom    | @types/node → **25.9.3** (MAJOR); jsdom → **29.1.1** (MAJOR)                                                                                              | `58f01d73` |
| msw                    | 2.14.3 → 2.14.6                                                                                                                                           | `1ae74eae` |
| zustand + react-query  | zustand → 5.0.14; @tanstack/react-query → **5.101.0**                                                                                                     | `80627448` |
| anthropic + cloudinary | @anthropic-ai/sdk → **0.104.1**; cloudinary → 2.10.0                                                                                                      | `9ab44e82` |
| validator + uuid       | validator → 13.15.35; uuid → **14.0.0** (MAJOR)                                                                                                           | `1b00b94d` |
| transitive (minor)     | systemjs, smithy, defu, fast-xml-builder/parser, icu-minify, lodash, path-to-regexp, rollup, xmlhttprequest                                               | `067c0f92` |
| transitive (MAJOR)     | @hono/node-server→2.0.4, @xmldom/xmldom→0.9.10, brace-expansion→5.0.6, diff→9.0.0, fast-uri→4.0.0, minimatch→10.2.5, protobufjs→8.6.3, tough-cookie→6.0.1 | `45b4eb0c` |
| tiptap / langchain     | ALREADY latest (7d candidates older; kept)                                                                                                                | —          |

### STOPPED → RESOLVED family: `vite` (HOLD at 7.3.5)

`vite` override 7.3.5 → 8.0.16 (`feb800a4`) then REVERTED to 7.3.5 (`1c5c24fa`).
`@vitejs/plugin-react@5.1.4` peer-requires vite `^4||^5||^6||^7` — does NOT accept vite 8;
Storybook's `@storybook/csf-plugin@10.2.13` likewise. **Resolution:** vite stays 7.3.5 for the 2
JSX frontends; the ~83 plain-TS backend packages auto-install vite 8 — a sanctioned
consumer-governed-transitive HOLD (ADR-0018). Vite 8 is a coupled frontend-toolchain follow-up.

### Dedupe convergence

`pnpm dedupe --check` was exit 1 at slice start (pre-existing transitive fragmentation). After T3.5 + a
`pnpm dedupe` flatten (`62e12284`), it exits **0** — FULLY CONVERGED.

### Residual peer warnings (NOT failures)

`madge@8.0.0` ← typescript ^5.4.4 vs 6.0.3 (dev tooling; introduced by TS-6 bump);
`@monaco-editor/react@4.6.0` + `@emoji-mart/react@1.1.1` ← react ^16-18 vs 19 (PRE-EXISTING).

---

## Step 5 — CI guard + Renovate + §7 absorptions (applied in `07601968`)

- **T5.1** `.syncpackrc.json` — workspace-ignore + single-version `highestSemver` + exact-range `""`;
  single-version group sees only manifest-declared specs (consumer-governed transitives invisible by design).
- **T5.2** `dependency-consistency` job appended to `fitness.yml`: `syncpack list-mismatches`,
  `pnpm install --frozen-lockfile`, `pnpm dedupe --check || pnpm dedupe --check` (single-retry wrapper for
  the pnpm 10.16 false-positive `ERR_PNPM_DEDUPE_CHECK_ISSUES`). Applied with the `sensitive-edit` token.
- **T5.3** `dependency-updates.yml` marked `# superseded-by-renovate`; `pnpm audit` analysis job retained.
- **T5.4** `.github/renovate.json` — `rangeStrategy: pin`, `pnpm-catalog` manager, family groups,
  `minimumReleaseAge: 7 days` (14 for runtime-critical P0).
- **T5.5** `CONCURRENTLY-BUMP` OBSOLETE — `concurrently` removed (Turbo replaces it); CLOSED 2026-06-23.
- **T5.6** `ESBUILD-OVERRIDE` + `SHELL-QUOTE-OVERRIDE` kept with dated-debt/remove-when in §7.
- **T5.7** 3 GHSAs → dated-debt lines (2026-06-19) with remove-when; `auditConfig` untouched.
- **T5.8** "Audited audit-ignores" table in `SECURITY_CANON.md` (3 GHSAs + CVE-floor pins); fitness #24 hard-zero.
- **T5.9** delta spec "24"→"27" + consumer-governed-transitives model reconciliation; `syncpack lint`→`list-mismatches`.
- **T5.10** final gate green in tracker CI.
- **T5.11** tracker→main **PR #95 MERGED** (`552c63a9`).

---

## Final verify gate

| Gate                                | Result                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | PASS (exit 0)                                                           |
| `pnpm audit --audit-level moderate` | PASS (exit 0; 2 vulns ignored — configured GHSAs; CVE floors preserved) |
| `pnpm dedupe --check`               | PASS (exit 0; fully converged)                                          |
| `syncpack list-mismatches`          | PASS (exit 0)                                                           |
| 27 CI fitness greps                 | PASS (all hard-zero)                                                    |
| build / test (tracker CI)           | PASS (PR #95 required checks green)                                     |
