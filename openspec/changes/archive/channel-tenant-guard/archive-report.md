# Archive Report: channel-tenant-guard (Slice 7, N-SEC-3)

**Status**: ARCHIVED — verified PASS, both PRs merged, living specs reconciled.

## What this change closed

`Channel` is the credential-bearing model of the project-scoped tenant-guard
rollout: every row holds a provider OAuth credential envelope (4 AES-256-GCM
columns) that the publish pipeline decrypts. Before this slice it was enrolled
in neither isolation layer, and the worker-side credential resolution ran on
the raw Prisma client with zero tenant scoping — the IDOR-with-secrets case.
After this slice, Channel is enrolled in the guard (58th model) and RLS
(policy parity 58/58), every create path validates parent ownership, and every
worker read/write of Channel requires the owning `accountId` alongside a
transaction-local RLS GUC binding.

## Delivery map

| PR                                               | Merge      | Carried                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #152 (`workstream/channel-tenant-guard`)         | `ce00d7ac` | Migration A (`20260723000000_add_channel_account_id`: column + backfill + RAISE + NOT NULL + Account FK + composite index) · guard flip 57→58 · Migration B (`20260723000100_add_rls_channel` + down.sql) · accountId threading (entity, `ChannelData`, adapter `upsert.create`, seeds/factories/suites) · OAuth-callback tenant binding + guarded Project probe (foreign/stale state → error redirect, no row) · Bluesky connect threading · admin hard-delete + force-reauth under `withSystemContext` · 16-test two-tenant integration suite wired into the tenant-isolation batch · guard unit matrix 61/61                                                                  |
| #164 (`workstream/channel-tenant-guard-workers`) | `9da39082` | `setTenantGuc` helper (+ `SYSTEM_TENANT_SCOPE`) · scoped `getChannelsByIds(ids, accountId)` + `getChannelOwnerAccountId` (system-scope GUC) · credential cache key `(accountId, ids)` · scoped `ChannelAuthFailureRecorder` with logged not-found · scoped mention-ingest channel resolution + unresolved-lookup counter · publish saga threads `accountId` and FAILS CLOSED when metadata lacks it · bounded owner-lookup fallback with WARN + counter and a verifiable removal condition · 7-test two-tenant publish regression (proves zero decryptions on a foreign scope) · db-prisma test-inclusive typecheck perimeter · `forbidOnly` on workers + adapter vitest configs |

**D5 amendment (design deviation, documented in `design.md`)**: the original
seam shipped the RLS pair in PR2 "with the code that honors it". The
MERGE-BLOCKING `rls-tenant-isolation` parity suite asserts guard↔RLS parity by
construction, so Migration B moved into PR1 (`fb0d2361`) instead of weakening
the suite — behaviorally inert under the current BYPASSRLS role, parity
satisfied, and the worker GUC code still landed in PR2.

## Review history

- **PR1**: full 4R adversarial review — zero merge-blocking; findings fixed
  in-branch (two context-less admin routes wrapped test-first, discriminating
  OAuth test via a `validateCode` spy, canon comment cleanup). Three post-push
  CI failures each root-caused: the parity suite (→ D5 amendment), advisory
  wave 6 (`next` 16.2.11, PR #153), and a poisoned turbo cache from a
  cancelled run.
- **PR2**: full 4R — three of four lenses MERGE-BLOCKING with converging
  evidence. All 16 findings fixed in one pass, the load-bearing ones being:
  the saga silently omitting a missing tenant (now fails closed at the pivot),
  the fallback's failures dying before any audit trail (now split into
  terminal channel-missing vs retryable database-fault, both writing the ERR
  publish log and metric), the owner lookup being the only Channel access
  without the GUC, and a red test in the very package whose contract changed —
  root-caused to `tsc` never reading that package's tests (now fixed there,
  and filed repo-wide as SMELL-68).

## Verification

Fresh-context verify against main after both merges: **PASS — 0 CRITICAL,
5 WARNING, 3 SUGGESTION** (engram `sdd/channel-tenant-guard/verify-report`).
Evidence: guard 61/61 · workers 122/122 · db-prisma 61/61 · integration
16/16 + 7/7 + 12/12 · full apps/api unit 8154/8154 · tsc 0 across four
packages · fitness greps 0 · live DB: zero NULL `accountId`, zero
project-mismatch rows, RLS enabled, 58/58 policy parity.

All five warnings were documentation-propagation gaps and are closed by this
archive commit: the three unmirrored requirements now live in the living specs
(`multi-tenant-isolation`: worker credential paths + child-table reads;
`tenant-context-boundaries`: worker seams declare their context), the stale
"PR2 adds the RLS policy" sentences state shipped reality, the
`AnalyticsAggregationQuery` row joined the child-table confirmation table
(verified safe: guarded project-scoped resolution before the summary read),
and the two memory-only escalations are now tracked backlog items.

## Open follow-ups (tracked, not dropped)

- **SMELL-68** — test files sit outside the `tsc --noEmit` perimeter in 60+
  packages including `apps/api` (523 files / 8154 tests); the structural root
  cause of the PR2 arity break. Fix direction: per-package test-inclusive
  typecheck perimeter.
- **SMELL-69** — no DB constraint ties `Channel.accountId` to
  `Project.accountId`; composite-FK hardening sketched, rollout-wide.
- Bounded fallback removal: delete the owner-lookup fallback and make
  `payload.accountId` required once the PUBLISH queue (including the BullMQ
  delayed set) holds no pre-deploy jobs — observable via the
  `accountid_source` counter and the grep anchor
  `TODO(2026-07-28|platform-engineering)`.
- Analytics daily/monthly summaries accept a raw `channelId` (wiring dead
  today; ownership probe required before any future wiring) · initiate-time
  project-ownership probe · NOBYPASSRLS role provisioning + mention-ingest
  Mention-write GUC coverage · fitness #23 cannot match the tagged-template
  raw form (false-negative class, documented).
- Slice 8 (**Post**) is the last enrollment; the rollout-wide composite-FK
  hardening (SMELL-69) sequences after it.
