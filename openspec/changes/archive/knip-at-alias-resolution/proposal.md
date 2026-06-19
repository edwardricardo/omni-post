# Proposal — knip-at-alias-resolution

> SDD proposal artifact. Inputs: a completed, empirically-verified RCA (knip run
> monkeypatched at `oxc-resolver.resolveFileSync` to capture the live resolution path;
> fix applied to `knip.json` and validated — `pnpm check:dead-code` → `RATCHET_EXIT=0`,
> 0 regressions). This proposal does not re-explore — it commits the decision.

- **Change**: `knip-at-alias-resolution`
- **Artifact store**: `openspec` (this file is committable)
- **Mode**: interactive (orchestrator pauses after this phase before spec/design)
- **Status**: proposed
- **Date**: 2026-06-17
- **Branch context**: `workstream/next-dev-resolution` (PR #91, OPEN)

---

## 1. Intent — what problem, why now, what success looks like

### The problem

On `workstream/next-dev-resolution` (PR #91), a forced `pnpm` lockfile regeneration — needed
to apply a sticky `vite` security override — incidentally floated knip's module resolver,
**`oxc-resolver` 11.19.1 → 11.20.0**. That bump
([oxc-resolver PR #1161](https://github.com/oxc-project/oxc-resolver/pull/1161)) is a
**deliberate, correct fix**: it scopes a tsconfig's default `**/*` include to the tsconfig's
own directory (`path.starts_with(self.directory())`) and stops conflating an omitted
`include`/`files` with an empty one. **It is NOT a regression** — verified against the official
CHANGELOG. The new behavior is more correct than before.

The correct behavior, however, surfaced a latent mismatch between how knip discovers an owning
tsconfig and how this monorepo lays out its tsconfigs, producing a cascade of **12 false-positive
findings** in the `Code Quality (knip + jscpd + madge)` gate.

**Root cause (empirically proven** — a research workflow monkeypatched `oxc-resolver.resolveFileSync`
inside a live knip run and captured the resolution path):

1. knip 6.12.2 drives `oxc-resolver` with `tsconfig: 'auto'`, which walks **up** from the importing
   file to the nearest file literally named `tsconfig.json` and checks `claims_ownership_of(file)`
   (which honors the tsconfig's `exclude`).
2. `apps/client/tsconfig.json` and `apps/admin/tsconfig.json` **exclude test files**
   (`**/*.test.*`, `**/__tests__/**/*`). So `oxc-resolver` 11.20.0 correctly does **not** let the
   leaf tsconfig claim ownership of a colocated `*.test.tsx`.
3. There is **no root `tsconfig.json`** (only `tsconfig.base.json`, a non-default name that
   auto-discovery never scans). So a disowned test file finds **no** owning tsconfig up the tree
   and gets **no path aliases at all** — both `@/*` **and** `@core/*` fail from a test file, while
   both resolve fine from a non-test sibling the leaf owns.
4. **knip amplifier**: knip caches module resolutions by `dir = dirname(containingFile)` then
   specifier. A disowned `*.test.tsx` (e.g. `apps/client/components/team/TeamMemberRow.test.tsx`)
   populates the cache `(components/team, "@/hooks/api/useTeam") = ERR`; its three **non-test**
   siblings in the same dir (`InviteMemberModal.tsx`, `TeamMemberRow.tsx`, `TeamPage.tsx`) hit the
   cached ERR and are reported "unresolved" **without `oxc` ever being invoked for them**.
5. The whole 12-finding cascade flowed from these unresolved `@/` edges:
   - **5 unresolved imports** (`@/hooks/api/useTeam` ×4, `@/lib/api/types` ×1)
   - **3 unused exports** (the `useTeam` hooks)
   - **2 unused files** (`apps/admin/hooks/api/useAuditLogs.ts`, `useContentLibrary.ts` — imported
     **only** by their tests; knip traces test imports even from `ignore`d test files, so the
     unresolved `@/` test-import edge made these look like unused files)
   - **2 unused types** (`apps/admin/lib/apiClient.ts::AuditLog`, `AuditLogFilters` — consumed only
     by the dead-looking `useAuditLogs`)

**Key fact**: `@/*` resolution is **fine for files the leaf tsconfig owns**. The problem is
**ownership via `exclude`**, not the paths anchor.

### Why now

The 12 false positives flip the `Code Quality (knip + jscpd + madge)` gate red. That gate is a
**required status check on `main` with `enforce_admins: true`** — it blocks PR #91 from merging.
The change is also self-amplifying: any future colocated `*.test.tsx` next to an `@/`-importing
sibling re-triggers the cascade, so a one-time suppression is the wrong shape. The fix must make
knip's view of `@/*` consistent with the app's, without touching the real build or typecheck.

### Success criteria

- `pnpm check:dead-code` returns `RATCHET_EXIT=0` with **0** of the 12 false positives
  (empirically achieved with the applied `knip.json` change).
- The fix does **not** suppress genuine dead code — the truly-unused `InviteTeamMemberInput` type
  is **still** flagged after the fix (the knip ratchet still bites).
- **Zero build-break surface**: Next 16/Turbopack and `tsc` never read `knip.json`, so the real
  build and typecheck are untouched.
- The two "unused file" hooks (`useAuditLogs`, `useContentLibrary`) are **documented as
  forgotten-features, not deleted** — a product decision is recorded in the backlog.

---

## 2. Scope

### In scope

**Knip-layer `paths` mapping (Option 1 — ALREADY APPLIED to `knip.json` and VERIFIED).**

Add a workspace-level `paths` mapping mirroring the leaf tsconfig's `@/*` exactly:

```jsonc
workspaces["apps/client"].paths = { "@/*": ["./*"] }
workspaces["apps/admin"].paths  = { "@/*": ["./*"] }
```

**Why it works**: knip's `paths` feeds `ProjectPrincipal.addPaths` → `createCustomModuleResolver`'s
`pathMappings`, which is applied as a **fallback** — **after** `oxc-resolver` returns nothing
(exactly the disowned-test-file case) and **before** knip's per-dir cache can mislabel the siblings.
It mirrors the leaf tsconfig's `@/*` exactly, keeping knip's view consistent with the app. This is
knip's own **canonical, documented mechanism** for monorepo path aliases — not a suppression.

**Backlog entry for the two forgotten-features** (`apps/admin/hooks/api/useAuditLogs.ts`,
`useContentLibrary.ts`): record them in `docs/reports/roadmap-detected-smells-backlog.md` as a
`FORGOTTEN-FEATURE` pending a product decision (wire the admin pages, or keep tracked). **Do NOT
delete anything.**

### Out of scope (named — do NOT do them in this change)

1. **Deleting `useAuditLogs.ts` / `useContentLibrary.ts`.** These are **not** dead code. The
   3-questions + feature-surface audit (`~/.claude/feedback/audit-deletion.md`) classified both as
   **FORGOTTEN-FEATURE**:
   - `useAuditLogs`: backend **fully implemented** (`apps/api/src/audit/auditRoutes.ts` + Prisma
     `model AuditLog` + `auditLogRetentionDays` config); hook + tests written; **only** missing an
     admin page to wire it.
   - `useContentLibrary`: calls the real `/api/backend/posts` endpoint; hook + tests written;
     **only** missing an admin page.
   - Both originate from the Genesis commit (`5603de6b`, 2026-03-08) = **intentional scaffolding**.
     Correct action is to **wire the admin pages OR keep tracked** — a **product** decision for
     Edward, never an automatic delete.
2. **Adding a root `tsconfig.json`** (so auto-discovery finds an owner up the tree). Rejected for
   this change — it cannot cleanly provide the **app-specific** `@/*` mapping and is broader than a
   knip-only problem needs. May be revisited later as a tooling-robustness improvement (see design).
3. **Pinning `oxc-resolver` back to 11.19.1.** Rejected — 11.20.0 is the **correct** behavior;
   pinning depends on removed behavior, masks the real issue, and adds an override the team dislikes
   (see design for the full rejected-alternatives analysis).
4. **Wiring the actual admin audit-logs / content-library pages.** That is the product follow-up
   the backlog entry tracks — not this change.

---

## 3. Approach — knip-layer fallback mapping, with rationale

**One mechanism, knip-only.** The bug lives entirely in knip's resolution view; the app itself
builds fine (Turbopack/`tsc` resolve `@/` via the leaf tsconfig directly, and test files are not in
the app build). So the fix belongs where the false positive is generated: knip's resolver.

knip exposes `workspaces[<ws>].paths` precisely for monorepo path aliases. It feeds
`ProjectPrincipal.addPaths` → `createCustomModuleResolver`'s `pathMappings`, applied as a fallback
**after** `oxc-resolver` returns nothing and **before** knip's per-dir resolution cache records (and
then propagates) an ERR to the importing file's siblings. Mapping `@/*` → `./*` mirrors the leaf
tsconfig (`apps/client/tsconfig.json`, `apps/admin/tsconfig.json` both declare `"@/*": ["./*"]`), so:

- A disowned `*.test.tsx` that `oxc` refused now resolves `@/...` via the fallback → the per-dir
  cache records a **success**, so its non-test siblings resolve too. The 5 unresolved imports, the
  3 chained unused-exports, the 2 chained unused-files, and the 2 chained unused-types all clear.
- It is **not** a blanket ignore: `paths` only supplies a resolution target; genuinely unused
  symbols (e.g. `InviteTeamMemberInput`) are still flagged. The ratchet keeps biting real dead code.
- **Build-break surface is zero**: `knip.json` is read by knip only. Next 16/Turbopack resolve `@/`
  via the leaf tsconfig; `tsc` via tsconfig `paths`. Neither reads `knip.json`. Test files are not
  in the Next build. So the real build and typecheck are untouched.

`baseUrl: "."` was tried on the apps tsconfigs and had **no effect** — confirming the failure is
**ownership** (via `exclude`), not the `paths` anchor. Recorded as a rejected alternative in design.

---

## 4. What MUST NOT regress

1. **The knip ratchet still bites real dead code** — the genuinely-unused `InviteTeamMemberInput`
   type MUST still be flagged after the fix (verified). The change resolves false positives, it does
   not silence true positives.
2. **The real build + typecheck** — Next 16/Turbopack and `tsc` do not read `knip.json`; the
   `@/*` → `./*` knip mapping mirrors the leaf tsconfig, so the app's resolution is unchanged.
3. **`jscpd` (duplication) and `madge` (cycles)** sub-checks of the same `Code Quality` gate — the
   change touches only knip's resolver config, not the duplication or cycle surfaces.
4. **No file deletions** — the two forgotten-feature hooks and their tests, types, and backend stay
   in place; only a backlog entry is added.

---

## 5. Rollback plan

Single, mechanical revert: remove the two added `paths` keys from `knip.json`
(`workspaces["apps/client"].paths` and `workspaces["apps/admin"].paths`). No other artifact depends
on them. The backlog entry is documentation and may stay (it records a real product decision); it
carries no runtime or CI coupling.

---

## 6. CI / required-checks interaction

| Check / gate                          | Interaction                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Code Quality (knip + jscpd + madge)` | **Primary target.** Required status check on `main` (`enforce_admins: true`). The `knip` sub-check goes from 12 false positives → 0; `jscpd`/`madge` untouched. |
| Next build / Turbopack                | **No interaction** — Turbopack never reads `knip.json`. Zero build-break surface.                                                                               |
| `tsc` typecheck                       | **No interaction** — `tsc` resolves `@/` via tsconfig `paths`, never `knip.json`.                                                                               |
| The 26 CI fitness functions           | **No interaction** — the change is a `knip.json` config edit plus a backlog `.md` entry; no source/`@layer`/import surface is touched.                          |

---

## Next recommended

- `sdd-spec` and `sdd-design` (can run in parallel — both read this proposal).
