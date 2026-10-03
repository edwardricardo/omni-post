# Dependency audit policy

## Gate

CI runs `pnpm audit --audit-level moderate`. It must exit 0.

## Policy

- **Every advisory with an available upstream fix MUST be fixed**, by upgrading
  the direct dependency or pinning the patched transitive version in the
  `overrides` block. On 2026-05-18, 124 advisories across 44 transitive modules
  (axios, next, dompurify, protobufjs, handlebars, @xmldom/xmldom, hono,
  fastify, vite, uuid, …) were resolved this way — see the `overrides`
  block in `pnpm-workspace.yaml` (relocated from root `package.json` by ADR-0019,
  since pnpm 11 no longer reads the `package.json` `pnpm` field). The full
  monorepo build was verified green with these pins.
- **`auditConfig.ignoreGhsas` (in `pnpm-workspace.yaml`) contains ONLY advisories
  with NO upstream fix available** (no patched release published on the registry). It is not a suppression list
  for inconvenient advisories. Growing it to silence a fixable or newly
  introduced advisory is prohibited.
- Because the ignore list is an explicit allowlist of specific GHSA IDs, **any
  newly introduced vulnerability has a different GHSA and will fail the gate** —
  the gate still prevents regressions.

## Currently ignored

The list lives in two places and nowhere else: `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`
is the machine list `pnpm audit` reads, and
[`SECURITY_CANON.md` §"Audited audit-ignores"](SECURITY_CANON.md#audited-audit-ignores) › "Ignored
GHSAs" is the authoritative record of each entry's chain, reason and remove-when. This page keeps no
copy of either, because a copy drifts: the table that stood here on 2026-10-02 still listed two ignores
already removed and omitted two that had been added.

## Review cadence

Re-evaluate on every Dependabot dependency-update cycle: if an upstream fix
becomes available for an ignored GHSA, remove it from `ignoreGhsas` and apply
the override/upgrade instead. The list must trend toward empty.
