# Update Session U2 — lucide-react + recharts + pnpm

Date: 2026-03-26

## Updates Applied

| Package               | From           | To             | Breaking Changes Fixed                  |
| --------------------- | -------------- | -------------- | --------------------------------------- |
| lucide-react          | 0.544.0        | 1.7.0          | None (all 83 icons backward-compatible) |
| recharts              | 2.15.0         | 3.8.1          | Tooltip `formatter` type signature      |
| pnpm (packageManager) | 10.16.0+sha512 | 10.33.0+sha512 | N/A                                     |

## Icon Renames Applied (lucide-react)

No icon renames were needed. All 83 icons used in the codebase (across 72 files in 3 packages: `apps/admin`, `apps/client`, `packages/ui`) are backward-compatible in lucide-react 1.7.0. The import API is unchanged.

## recharts Prop Changes Fixed

| Component           | Old Signature                         | New Signature                                                          | Files Updated |
| ------------------- | ------------------------------------- | ---------------------------------------------------------------------- | ------------- |
| Tooltip `formatter` | `(value: number) => [string, string]` | `(value) => [\`$\${Number(value ?? 0).toLocaleString()}\`, "Revenue"]` | 1 file        |

**Detail:** In recharts 3.x, the `Tooltip` `formatter` prop changed its type signature. The `value` parameter is now `ValueType | undefined` instead of a concrete type. Fixed by removing the explicit `: number` annotation and handling the `undefined` case with `Number(value ?? 0)`.

**File:** `apps/admin/app/(dashboard)/analytics/page.tsx`

## Additional Pinning Applied

14 dependencies across 4 files had `^` prefixes removed to enforce exact version pinning:

| File                                    | Package                     | Pinned To |
| --------------------------------------- | --------------------------- | --------- |
| apps/api/package.json                   | argon2                      | 0.44.0    |
| apps/api/package.json                   | @fastify/rate-limit         | 10.3.0    |
| apps/admin/package.json                 | @radix-ui/react-popover     | 1.1.15    |
| apps/admin/package.json                 | @radix-ui/react-scroll-area | 1.2.10    |
| apps/admin/package.json                 | @types/papaparse            | 5.5.2     |
| apps/admin/package.json                 | cronstrue                   | 3.13.0    |
| apps/admin/package.json                 | papaparse                   | 5.5.3     |
| apps/admin/package.json                 | zustand                     | 5.0.11    |
| packages/providers/bluesky/package.json | @atproto/api                | 0.13.28   |
| packages/providers/bluesky/package.json | image-size                  | 2.0.2     |
| package.json                            | @ast-grep/cli               | 0.41.0    |
| package.json                            | jscpd                       | 4.0.8     |
| package.json                            | knip                        | 5.85.0    |
| package.json                            | madge                       | 8.0.0     |

## Files Modified

| File                                          | Change                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- |
| packages/ui/package.json                      | lucide-react 0.544.0 -> 1.7.0                                       |
| apps/client/package.json                      | lucide-react 0.544.0 -> 1.7.0                                       |
| apps/admin/package.json                       | lucide-react 0.544.0 -> 1.7.0, recharts 2.15.0 -> 3.8.1, pin 4 deps |
| apps/api/package.json                         | Pin argon2, @fastify/rate-limit                                     |
| packages/providers/bluesky/package.json       | Pin @atproto/api, image-size                                        |
| package.json                                  | pnpm 10.16.0 -> 10.33.0 (with SHA), pin 4 devDeps                   |
| apps/admin/app/(dashboard)/analytics/page.tsx | Fix Tooltip formatter type for recharts 3.x                         |
| pnpm-lock.yaml                                | Updated lockfile                                                    |

## Build and Test Status

| Check             | Result                                         |
| ----------------- | ---------------------------------------------- |
| TypeScript build  | 0 errors, 9/9 tasks successful                 |
| API unit tests    | 305 files passed, 6,478 tests passed, 0 failed |
| Unpinned versions | 0 (all dependencies use exact versions)        |

## Decisions Made

No DECISION REQUIRED blocks were triggered. All three upgrades completed cleanly:

- lucide-react 1.7.0 maintained full backward compatibility with v0 icon names
- recharts 3.8.1 required a single Tooltip formatter fix
- corepack was available and updated pnpm with SHA automatically

## Packages That Could Not Be Updated

Carried forward from U1:

| Package           | Reason                                     | Session |
| ----------------- | ------------------------------------------ | ------- |
| TypeScript        | 5.9.2 -> 6.0 major                         | U3      |
| openai            | Major — AI orchestrator changes            | U4      |
| fluent-ffmpeg     | Deprecated — needs replacement             | U5      |
| @opentelemetry/\* | Suite update — needs comprehensive testing | U6      |
