# Code Quality — Specification

> Living specification for the **code-quality** capability: the dead-code gate
> (`Code Quality (knip + jscpd + madge)`) and how knip resolves `@/*` aliases in the Next
> apps. Source of truth: the empirically-verified RCA (a live knip run with
> `oxc-resolver.resolveFileSync` monkeypatched to capture the resolution path; fix applied
> to `knip.json` and validated — `pnpm check:dead-code` → `RATCHET_EXIT=0`).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement carries
> Given/When/Then acceptance scenarios. Scenarios marked **[empirical]** were reproduced
> in the RCA and are the literal pass/fail bar.

---

## Requirements

### Requirement: knip resolves `@/*` aliases for files the leaf tsconfig does not own

knip MUST resolve a `@/*` import to a real source file **even when** the importing file is one the
leaf app tsconfig does **not** own (because the tsconfig `exclude`s test files and no root
`tsconfig.json` exists to own it up the tree). For the `apps/client` and `apps/admin` workspaces,
knip's `@/*` resolution MUST mirror the leaf tsconfig's `@/*` → `./*` mapping, so that knip's view
of the alias is consistent with the application's. Resolution MUST NOT depend on `oxc-resolver`
granting the importing file ownership.

This closes the false-positive cascade `oxc-resolver` 11.20.0 surfaced — a deliberate, correct
include-scoping fix ([PR #1161](https://github.com/oxc-project/oxc-resolver/pull/1161)), not a
regression.

#### Scenario: A `@/*` import from a disowned test file resolves [empirical]

- **Given** `apps/client/tsconfig.json` excludes test files (`**/*.test.*`, `**/__tests__/**/*`)
- **And** there is no root `tsconfig.json` (only the non-default `tsconfig.base.json`)
- **And** `apps/client/components/team/TeamMemberRow.test.tsx` imports `@/hooks/api/useTeam`
- **When** knip resolves the import (after `oxc-resolver` declines to own the test file)
- **Then** knip's `paths` fallback (`@/*` → `./*`, mirroring the leaf tsconfig) resolves
  `@/hooks/api/useTeam` to the real source file
- **And** the import is **not** reported as an unresolved import

#### Scenario: Non-test siblings in the same directory are no longer mislabelled [empirical]

- **Given** a disowned `*.test.tsx` and its non-test siblings (`InviteMemberModal.tsx`,
  `TeamMemberRow.tsx`, `TeamPage.tsx`) live in the same directory
- **And** knip caches resolutions by `(dir = dirname(containingFile), specifier)`
- **When** knip resolves the disowned test file's `@/...` import via the `paths` fallback
- **Then** the per-directory cache records a **success** for `(dir, "@/...")`
- **And** the non-test siblings reading that cache entry are **not** reported "unresolved"

---

### Requirement: The 12-finding false-positive cascade is cleared

After the change, the `knip` sub-check of the `Code Quality (knip + jscpd + madge)` gate MUST report
**zero** of the 12 findings that flowed from the unresolved `@/` edges: 5 unresolved imports
(`@/hooks/api/useTeam` ×4, `@/lib/api/types` ×1), 3 unused exports (the `useTeam` hooks), 2 unused
files (`apps/admin/hooks/api/useAuditLogs.ts`, `useContentLibrary.ts`), and 2 unused types
(`apps/admin/lib/apiClient.ts::AuditLog`, `AuditLogFilters`). `pnpm check:dead-code` MUST exit with
`RATCHET_EXIT=0`.

#### Scenario: pnpm check:dead-code passes with the cascade cleared [empirical]

- **Given** the `knip.json` `paths` mapping (`@/*` → `./*`) is present on the `apps/client` and
  `apps/admin` workspaces
- **When** `pnpm check:dead-code` runs
- **Then** none of the 12 cascade findings are reported
- **And** the command exits with `RATCHET_EXIT=0`
- **And** `0` regressions are introduced relative to the pre-change ratchet baseline

#### Scenario: The chained unused-files and unused-types clear with their resolved importer

- **Given** `apps/admin/hooks/api/useAuditLogs.ts` and `useContentLibrary.ts` are imported only by
  their tests, and `apps/admin/lib/apiClient.ts::AuditLog` / `AuditLogFilters` are consumed only by
  `useAuditLogs`
- **When** the unresolved `@/` test-import edge is restored by the `paths` fallback
- **Then** the two hooks are no longer reported as unused files
- **And** the two types are no longer reported as unused types

---

### Requirement: The fix is a resolution mapping, NOT a suppression — genuine dead code is still flagged

The `knip.json` `paths` mapping MUST only supply a **resolution target**; it MUST NOT ignore,
allowlist, or otherwise suppress reporting. Genuinely-unused symbols MUST still be flagged by the
knip ratchet after the change, so the gate keeps detecting real dead code.

#### Scenario: A genuinely-unused type is still flagged after the fix [empirical]

- **Given** the `paths` mapping is applied
- **And** `InviteTeamMemberInput` is a genuinely-unused type
- **When** `pnpm check:dead-code` runs
- **Then** `InviteTeamMemberInput` is **still** reported as unused
- **And** the `paths` mapping does not mask it

---

### Requirement: The fix has zero build-break surface — the real build and typecheck are untouched

The change MUST be confined to `knip.json` (read by knip only). Next 16/Turbopack and `tsc` MUST NOT
be affected: Turbopack resolves `@/` via the leaf tsconfig, `tsc` via tsconfig `paths`, and neither
reads `knip.json`. Test files are not part of the Next build. The change MUST NOT add any
`.js`-on-`.ts` relative import in a bundler-compiled frontend directory (fitness **#26** MUST stay at
zero), and MUST NOT modify any `package.json` `exports`, any tsconfig, or any source file.

#### Scenario: Turbopack and tsc resolution are unchanged

- **Given** the `knip.json` `paths` mapping is the only resolution change
- **When** `next build` (Turbopack) and `tsc` run
- **Then** `@/` continues to resolve via the leaf tsconfig (`next build`) and tsconfig `paths`
  (`tsc`)
- **And** neither tool reads `knip.json`
- **And** the build and typecheck outputs are unchanged from before the fix

#### Scenario: Fitness #26 and the other fitness functions stay at their hard-zero counts

- **Given** the change touches `knip.json` and one backlog `.md` row only
- **When** the 26 CI fitness functions run
- **Then** fitness **#26** (no `.js`-on-`.ts` imports in bundler-compiled frontend dirs) stays at
  `0`
- **And** every other fitness function remains at its hard-zero count

---

### Requirement: The two surfaced hooks are documented as forgotten-features, never deleted

The two files knip flagged as "unused" — `apps/admin/hooks/api/useAuditLogs.ts` and
`useContentLibrary.ts` — MUST NOT be deleted by this change. They are FORGOTTEN-FEATURE (3-questions

- feature-surface audit, `~/.claude/feedback/audit-deletion.md`): each has a fully- or
  real-implemented backend and written hook + tests, missing only an admin page to wire it; both
  originate from the Genesis commit (`5603de6b`). They MUST be recorded in
  `docs/reports/roadmap-detected-smells-backlog.md` as a pending **product** decision.

#### Scenario: The forgotten-features are recorded, not removed

- **Given** knip surfaced `useAuditLogs.ts` and `useContentLibrary.ts` as "unused files"
- **And** both are classified FORGOTTEN-FEATURE (backend implemented; hook + tests written; only an
  admin page missing)
- **When** the change is applied
- **Then** neither file (nor its tests, types, or backend) is deleted
- **And** a backlog entry records them as "FORGOTTEN-FEATURE: admin audit-logs + content-library
  pages pending product decision"
- **And** the decision to wire the pages or keep them tracked is left to product (Edward)

---

## Verification note (config-only change)

This change is a single `knip.json` resolution-config edit (plus one backlog `.md` row). There is no
production TypeScript to drive RED→GREEN. The "tests" are the resolution scenarios above run against
the real tree:

- **RED proof**: before the `paths` mapping (with `oxc-resolver` 11.20.0), `pnpm check:dead-code`
  reports the 12-finding cascade and the ratchet fails.
- **GREEN proof**: with the `paths` mapping applied, `pnpm check:dead-code` returns
  `RATCHET_EXIT=0`, the 12 findings clear, the genuinely-unused `InviteTeamMemberInput` is still
  flagged, and 0 regressions are introduced.

The fix is already applied to `knip.json` and validated. LXC constraint: `pnpm check:dead-code` is
the single command to run; no app build is required to verify (the gate is knip-only).
