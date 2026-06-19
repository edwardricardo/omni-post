# Design — knip-at-alias-resolution

> Technical design. Reads: `proposal.md` (required) + the empirically-verified RCA (a live knip
> run with `oxc-resolver.resolveFileSync` monkeypatched to capture the resolution path). The fix is
> already applied to `knip.json` and validated (`pnpm check:dead-code` → `RATCHET_EXIT=0`,
> 0 regressions). Additive, knip-only, single-line rollback.

## Technical Approach

One mechanism: add a knip workspace-level `paths` mapping mirroring the leaf tsconfig's `@/*` alias,
so knip's resolver has a **fallback** for files `oxc-resolver` (correctly) refuses to own.

| Layer                   | Edit                                                                                                             | Effect                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `knip.json` (knip only) | `workspaces["apps/client"].paths = { "@/*": ["./*"] }` and `workspaces["apps/admin"].paths = { "@/*": ["./*"] }` | knip resolves `@/...` from disowned test files via the `pathMappings` fallback, breaking the per-dir-cache cascade |

The bug is **knip-exclusive**. The application builds fine: Turbopack and `tsc` resolve `@/` via the
leaf tsconfig directly, and test files are not part of the Next build. So the fix belongs in knip's
resolution config, nowhere else.

## Why the resolution breaks (verified mechanism)

`oxc-resolver` 11.20.0 ([PR #1161](https://github.com/oxc-project/oxc-resolver/pull/1161)) scopes a
tsconfig's default `**/*` include to the tsconfig's own directory and stops conflating omitted vs
empty `include`/`files`. This is **correct**. With it:

1. knip (6.12.2) drives `oxc-resolver` with `tsconfig: 'auto'` → walks **up** from the importing
   file to the nearest file named `tsconfig.json`, then `claims_ownership_of(file)` (honors
   `exclude`).
2. `apps/client/tsconfig.json` / `apps/admin/tsconfig.json` **exclude** `**/*.test.*` and
   `**/__tests__/**/*` → the leaf tsconfig (correctly) does **not** own a colocated `*.test.tsx`.
3. **No root `tsconfig.json`** exists (only `tsconfig.base.json`, a non-default name auto-discovery
   never scans) → a disowned test file finds **no** owner up the tree → **no path aliases at all**
   (`@/*` **and** `@core/*` both fail from a test file; both resolve fine from a non-test sibling the
   leaf owns).
4. **knip cache amplifier**: resolutions are cached by `(dir = dirname(containingFile), specifier)`.
   A disowned `*.test.tsx` populates `(dir, "@/...") = ERR`; the non-test siblings in the **same
   dir** read the cached ERR and are reported "unresolved" **without `oxc` ever being invoked** for
   them. One disowned test file poisons resolution for its whole directory.

## Architecture Decisions

### Decision: fix at the knip layer via `workspaces[<ws>].paths` (Option 1 — CHOSEN, APPLIED)

**Choice**: Add `paths: { "@/*": ["./*"] }` to the `apps/client` and `apps/admin` knip workspaces,
mirroring each leaf tsconfig's `@/*` alias exactly.

**Rationale**:

- knip's `paths` feeds `ProjectPrincipal.addPaths` → `createCustomModuleResolver`'s `pathMappings`,
  applied **as a fallback after `oxc-resolver` returns nothing** and **before** the per-dir cache
  records an ERR. It targets exactly the disowned-test-file case and breaks the cascade at its
  source.
- It mirrors the leaf tsconfig, so knip's view of `@/*` is **consistent with the app** — no drift.
- It is knip's **own canonical/documented** mechanism for monorepo path aliases. Idiomatic, not a
  hack.
- It is **not a suppression**: `paths` only supplies a resolution target. The genuinely-unused
  `InviteTeamMemberInput` type is **still flagged** after the fix — the ratchet keeps biting real
  dead code.
- **Zero build-break surface**: `knip.json` is read by knip only. Next 16/Turbopack resolve `@/` via
  the leaf tsconfig; `tsc` via tsconfig `paths`. Neither reads `knip.json`, and test files are not
  in the Next build. The real build and typecheck are untouched.

**Empirical proof**: with the two `paths` keys applied, `pnpm check:dead-code` returns
`RATCHET_EXIT=0` and all 12 false positives clear, while real dead code (`InviteTeamMemberInput`)
stays flagged. 0 regressions.

### Decision: do NOT pin `oxc-resolver` to 11.19.1

**Alternative**: pin `oxc-resolver` (knip's transitive resolver) back to 11.19.1 to restore the old
include-scoping behavior.

**Rejected because**: 11.20.0's behavior is the **correct/intentional** fix (verified against the
official CHANGELOG; PR #1161 is a deliberate correctness improvement). Pinning **depends on removed
behavior**, **masks the real issue** (the tsconfig-ownership mismatch), and adds an **override** —
which the team explicitly dislikes (cf. the very `vite` override that triggered the lockfile regen
that floated this bump). Pinning is fragile and backwards-facing; the knip-`paths` fix is forward-
compatible and idiomatic.

### Decision: do NOT add `baseUrl: "."` to the apps' tsconfigs

**Alternative**: set `baseUrl: "."` on `apps/client/tsconfig.json` / `apps/admin/tsconfig.json` to
re-anchor path resolution.

**Rejected because**: it was **tried and had no effect**. The failure mode is **ownership** (the
leaf tsconfig's `exclude` of test files + no root owner), not the `paths` anchor. Changing `baseUrl`
does not make the leaf tsconfig claim a `*.test.tsx`, so the disowned-file cascade persists. This
empirically confirms the root cause is ownership, and rules out the anchor as the lever.

### Decision: do NOT un-exclude test files from the leaf tsconfig

**Alternative**: remove `**/*.test.*` / `**/__tests__/**/*` from the leaf tsconfig `exclude` so
`oxc-resolver` owns the test files and grants them `@/*`.

**Rejected because**: it **widens the tsc type program** — test files would enter the Next build's
type-check, which the **transpile-only model deliberately avoids** (ADR-0017). That raises
build-break risk on the real pipeline for a problem that is **knip-only**. Trading a knip false
positive for a genuine build-graph change is the wrong direction.

### Decision: do NOT add a root `tsconfig.json` (in this change)

**Alternative**: add a root `tsconfig.json` so knip's up-the-tree auto-discovery finds an owner.

**Rejected (for this change) because**: a single root tsconfig **cannot cleanly provide the
app-specific `@/*` mapping** (`@/` resolves to different directories per app), and it is **broader
than a knip-only issue requires**. It may be revisited later as a **tooling-robustness** improvement
(a deliberate, separately-scoped change) — recorded as out-of-scope here, **not** part of this fix.

## Boundary respected: NodeNext-backend vs bundler-frontend split (do NOT unify)

This change is **orthogonal** to the build/emit model and **must not** touch it. Per **ADR-0017**
(`docs/technical/ADR-0017-production-build-bundler.md`), the repo runs a two-mechanism resolution
contract:

- **Backend (`apps/api`, `apps/workers`, `@core/*`)** — NodeNext, transpile-only; `.js`-specifier'd
  source; resolution via Node `exports` / conditional `development` branch (see the
  `dev-prod-resolution-model` change).
- **Frontend (`apps/admin`, `apps/client`, frontend-only packages)** — Turbopack/`moduleResolution:
bundler`, extensionless; `@/*` resolved via the leaf tsconfig `paths`.

The knip-`paths` fix lives **purely in knip's resolver view** and changes **neither** side of that
split. It does not add `.js`-on-`.ts` imports in any bundler-compiled dir (fitness **#26** stays at
zero — the mapping is in `knip.json`, not in import statements). It does not alter any `package.json`
`exports`, any tsconfig, or any source file. The real build and typecheck pipelines are byte-for-byte
unchanged.

## The forgotten-features (documented, NOT deleted)

`apps/admin/hooks/api/useAuditLogs.ts` and `useContentLibrary.ts` surfaced as knip "unused files"
**only** because the unresolved `@/` test-import edge severed their last live importer (their tests).
Applying the deletion discipline (`~/.claude/feedback/audit-deletion.md`, 3-questions +
feature-surface audit), both are **FORGOTTEN-FEATURE**, not dead:

| Hook                | Backend state                                                                                                          | Frontend state       | Missing               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------- |
| `useAuditLogs`      | **Fully implemented** — `apps/api/src/audit/auditRoutes.ts` + Prisma `model AuditLog` + `auditLogRetentionDays` config | Hook + tests written | Admin page to wire it |
| `useContentLibrary` | Calls the **real** `/api/backend/posts` endpoint                                                                       | Hook + tests written | Admin page to wire it |

Both originate from the Genesis commit (`5603de6b`, 2026-03-08) = intentional scaffolding. Correct
action is **wire the admin pages OR keep tracked** — a **product** decision for Edward, never an
automatic delete. This change records them in `docs/reports/roadmap-detected-smells-backlog.md`
(`SMELL-51`, FORGOTTEN-FEATURE) and deletes nothing.

## File Changes

| File                                              | Action        | Description                                                                                                                |
| ------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `knip.json`                                       | Modify (DONE) | Add `paths: { "@/*": ["./*"] }` to `workspaces["apps/client"]` and `workspaces["apps/admin"]`. Already applied + verified. |
| `docs/reports/roadmap-detected-smells-backlog.md` | Modify        | Add `SMELL-51` FORGOTTEN-FEATURE row for the admin audit-logs + content-library pages (pending product decision).          |

## What MUST NOT regress (and how preserved)

1. **Knip still bites real dead code** — `paths` supplies a resolution target only; unused symbols
   (`InviteTeamMemberInput`) are still flagged (verified).
2. **Real build + typecheck** — `knip.json` is knip-only; the `@/*` → `./*` mapping mirrors the leaf
   tsconfig, so the app's resolution is unchanged. ADR-0017 split untouched.
3. **`jscpd` + `madge`** sub-checks of the `Code Quality` gate — only knip's resolver config is
   touched; duplication/cycle surfaces are unaffected.
4. **Fitness #26 (and the other 25)** — no `.js`-on-`.ts` imports added; no `@layer`/import/source
   surface touched. The change is `knip.json` + one backlog `.md` row.
5. **No file deletions** — the two forgotten-feature hooks, their tests, types, and backend stay.

## Sequencing / Rollback

1. `knip.json` `paths` mapping — **already applied + verified** (`RATCHET_EXIT=0`, 0 regressions).
2. Backlog `SMELL-51` FORGOTTEN-FEATURE entry — documentation only.

**Rollback**: remove the two `paths` keys from `knip.json` (single mechanical revert; nothing else
depends on them). The backlog entry may stay (it records a real product decision; no CI/runtime
coupling).

## Open Questions

- [ ] Whether to later add a root `tsconfig.json` (or otherwise make knip's auto-discovery robust to
      the no-root-owner case) as a separate tooling-robustness change — out of scope here, noted for
      product/tooling backlog.
- [ ] Product decision on the two forgotten-features (wire the admin pages vs keep tracked) — owned
      by Edward; tracked as `SMELL-51`.
