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
  with NO upstream fix available** (no patched release published on the registry), or
  whose only patched release sits on a major line that no consumer of the advisory in the
  lockfile can take, measured and recorded as a Blocked floor in
  [`DEPENDENCY_AUDIT_RECORD.md` §"Blocked floors"](DEPENDENCY_AUDIT_RECORD.md#blocked-floors--a-patch-we-cannot-take-without-a-decision),
  while the advisory is not reachable (the Maintainer's decision of 2026-10-31 on
  `minimatch` 3.x). It is not a suppression list
  for inconvenient advisories. Growing it to silence a fixable or newly
  introduced advisory is prohibited.
- Because the ignore list is an explicit allowlist of specific GHSA IDs, **any
  newly introduced vulnerability has a different GHSA and will fail the gate** —
  the gate still prevents regressions.

## Currently ignored

The list lives in two places and nowhere else: `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`
is the machine list `pnpm audit` reads, and
[`DEPENDENCY_AUDIT_RECORD.md` §"Audited audit-ignores"](DEPENDENCY_AUDIT_RECORD.md#audited-audit-ignores) › "Ignored
GHSAs" is the authoritative record of each entry's chain, reason and remove-when. This page keeps no
copy of either, because a copy drifts: the table that stood here on 2026-10-02 still listed two ignores
already removed and omitted two that had been added.

## Review cadence

Re-evaluate on every Dependabot dependency-update cycle: if an upstream fix
becomes available for an ignored GHSA, remove it from `ignoreGhsas` and apply
the override/upgrade instead. The list must trend toward empty.

## Pin the latest stable version, exactly

A dependency is added or updated at its latest stable release, written as an exact version: never a pre-release (canary, rc, beta, alpha, preview, next, nightly) and never a range that updates by itself (`^`, `~`, `*`, `latest`). A library that offers only a pre-release is not ready: say so, do not take it. The same holds for the version of an external API a client names. A peer-dependency range is a constraint and stays a range.

## Raising a range-scoped CVE floor

Move the BAND and the TARGET in the same edit, so the band's exclusive upper bound stays the target (`"pkg@<X": X`). Raising only the value leaves the tree resolved to the PREVIOUS target — a version the old band no longer selects — so the override applies to nothing while the audit record still reads as holding the floor, and the audit goes green because the advisory's range stopped matching. Never an inclusive bound (`<=W`): it names a different number from the target and therefore cannot move with it. A band that genuinely cannot take that shape (an advisory whose named patched version was never published; a compatibility pin scoped to one major line) is recorded in the allowlist of `scripts/testing/override-bands-gate.mjs` with its measured reason, and that allowlist may only shrink. Enforced by the `Override bands` step of the `Dependency Consistency` job.

## Patching a dependency

Only by the Maintainer's decision, recorded in its own ADR (ADR-0037 is the shape): reproduce a merged upstream change and nothing else, key it to the exact version (`pnpm patch <pkg>@<version>`, then `pnpm patch-commit`), read the generated file and keep only the intended hunks (pnpm lists the edited package through its `files` field, so a file the tarball ships outside that field is recorded as deleted; then `pnpm install` records the new hash), add its entry to §"Patched dependencies" of the audit record, add its record to `scripts/testing/patched-dependencies.json` with a `resolvedBy` range whose first stable release ends it (fitness #48 refuses a key without one, and the patched-dependencies workflow then watches the registry for it every 6 hours until its remove-when fires), and add `COPY patches/ ./patches/` to the four Dockerfiles, before `pnpm install`, while any patch exists: pnpm reads every patch file on each install. The change that removes a patch deletes its file, its key and its record together; fitness #48 refuses any one of the three left behind. The change that removes the last one also deletes that `COPY` line, because a `COPY` of a missing directory fails the build.
