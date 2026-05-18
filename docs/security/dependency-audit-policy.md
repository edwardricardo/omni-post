# Dependency audit policy

## Gate

CI runs `pnpm audit --audit-level moderate`. It must exit 0.

## Policy

- **Every advisory with an available upstream fix MUST be fixed**, by upgrading
  the direct dependency or pinning the patched transitive version in
  `pnpm.overrides`. On 2026-05-18, 124 advisories across 44 transitive modules
  (axios, next, dompurify, protobufjs, handlebars, @xmldom/xmldom, hono,
  fastify, vite, uuid, …) were resolved this way — see the `pnpm.overrides`
  block in the root `package.json`. The full monorepo build was verified green
  with these pins.
- **`pnpm.auditConfig.ignoreGhsas` contains ONLY advisories with NO upstream
  fix available** (`patched_versions: <0.0.0`). It is not a suppression list
  for inconvenient advisories. Growing it to silence a fixable or newly
  introduced advisory is prohibited.
- Because the ignore list is an explicit allowlist of specific GHSA IDs, **any
  newly introduced vulnerability has a different GHSA and will fail the gate** —
  the gate still prevents regressions.

## Currently ignored (no upstream fix)

| GHSA                | Sev      | Module           | Why unfixable                                                                                             | Blast radius                                                                                                                                        | Burn-down                                                                                      |
| ------------------- | -------- | ---------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GHSA-p8p7-x288-28g6 | moderate | `request@2.88.2` | `request` was deprecated/archived in 2020; `patched_versions: <0.0.0` — no fixed release will ever exist. | **Dev/tooling only.** Path: `jq` (devDependency, build/CI helper) → `jsdom@0.2.19` → `request`. Never bundled into any production runtime artifact. | Remove this entry when the `jq` npm wrapper drops the old `jsdom`, or replace the `jq` helper. |
| GHSA-848j-6mx2-7j84 | low      | `elliptic`       | No patched release published; `patched_versions: <0.0.0`.                                                 | Transitive crypto utility, low severity.                                                                                                            | Remove when a patched `elliptic` ships or the parent drops it.                                 |

## Review cadence

Re-evaluate on every Dependabot dependency-update cycle: if an upstream fix
becomes available for an ignored GHSA, remove it from `ignoreGhsas` and apply
the override/upgrade instead. The list must trend toward empty.
