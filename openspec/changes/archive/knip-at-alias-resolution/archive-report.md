# Archive Report — knip-at-alias-resolution

> Closure record for the `knip-at-alias-resolution` SDD change. Archived 2026-06-19.

## Outcome

The 12-finding false-positive cascade the `oxc-resolver` 11.20.0 bump surfaced in the
`Code Quality (knip + jscpd + madge)` gate is cleared. The root cause was ownership-via-`exclude`:
the leaf app tsconfigs exclude test files and there is no root `tsconfig.json`, so disowned
`*.test.tsx` files got no `@/*` aliases, and knip's per-directory resolution cache propagated the
ERR to non-test siblings. The fix adds a knip-layer `paths` mapping (`@/*` → `./*`) on the
`apps/client` and `apps/admin` workspaces, mirroring the leaf tsconfig exactly. It is a resolution
target, not a suppression: the genuinely-unused `InviteTeamMemberInput` is still flagged, and the
two surfaced hooks (`useAuditLogs`, `useContentLibrary`) are documented as FORGOTTEN-FEATURE in the
backlog rather than deleted. Build-break surface is zero — Turbopack and `tsc` never read
`knip.json` — and all 26 fitness functions stay hard-zero. `pnpm check:dead-code` returns
`RATCHET_EXIT=0`. The change shipped verified.

## Capabilities / specs applied

The change's delta spec was folded into the cumulative living specification:

- `code-quality` → `openspec/specs/code-quality/spec.md`

## Merge reference

- PR: **#91** (rebase-merged into `main`)
- Branch: `workstream/next-dev-resolution`
- Date archived: **2026-06-19**
