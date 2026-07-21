# Merge Campaign — Extraction & Hygiene (2026-07-19..21)

> Report of the 2-day campaign that closed the four MFA/security mega-branches
> (#97/#107/#108/#110) by re-landing their content on `main` as reviewable extraction
> slices, then swept the dependency/CI backlog and pruned stale branches.
> **Base of record:** `main @ 1aa3f553`. **Owner:** Platform engineering.
> **Cross-refs:** `MASTER_PLAN_ES.md §1` (Nivelación N-SEC-\*), `NORMALIZATION_ROADMAP.md`
> (changelog 2026-07-21), `SECURITY_CANON.md §Audited audit-ignores`.

## Executive summary

The four mega-branches never merged as monoliths. Instead each was **decomposed into
per-slice PRs** that landed on `main` with their own review + adversarial gate. Net result:
the Nivelación security cluster's **cross-tenant, DoS, register-privesc and MFA** items are
now on `main`; the dependency baseline absorbed **two same-day CVE waves + a codeql v4 bump +
two dependabot group supersessions**; and **93 stale branches** were deleted after per-commit
audits, leaving three deliberately-kept blueprint branches.

What did **not** change: the tenant-guard rollout (N-SEC-3, `projectId`-only models) is still
**in progress**; the inbound webhook pipeline is still **deliberately unwired** on `main`; and
containerization (#89) stays **paused** behind the bundler ADR.

> **Labeling caveat (flagged, unresolved):** the campaign fact sheet labels PR #128
> (CQRSIntegration purge) as "N-SEC-3", but in the repo commits and `MASTER_PLAN_ES.md`
> `N-SEC-3` is the tenant-guard workstream (in progress). They are different items — do not
> read #128 as closing the tenant guard.

## 1. Security extraction slices (mega-branches → `main`)

| PR            | Item                  | What landed                                                                                                                                                                                 |
| ------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#124**      | N-SEC-1 / N-SEC-1b    | Circuit-breaker / fallback per-tenant cache disclosure fix (CWE-639) + 3-tier opossum eviction. The assessment saw 1 vector; there were 3 (L1 cache, L2 fallback, breaker-closure binding). |
| **#125**      | N-SEC-2               | Canonical client-IP resolver `resolveClientIp` + `TRUSTED_PROXY_HOP_COUNT` + fitness **#28/#29** (CWE-807/290/348). Next portals relay `X-Forwarded-For` verbatim (no hop append).          |
| **#126**      | CWE-269               | Public `POST /auth/register` (role → ADMIN, mass-assignment priv-esc) removed; admins provisioned only via `AuthService.registerAdmin`.                                                     |
| **#127**      | hygiene               | Nivelación hygiene slice.                                                                                                                                                                   |
| **#128**      | CQRSIntegration purge | Dead `apps/api/src/cqrs/CQRSIntegration.ts` removed (+30/−2358); coverage `statements` floor re-baselined **55→54** (authorized). _(fact sheet mislabels this "N-SEC-3" — see caveat)_      |
| **#129-#133** | N-SEC-5 MFA           | MFA consolidation **complete** (see §1.1).                                                                                                                                                  |

### 1.1 MFA consolidation (#129-#133)

Unified subject-typed `MfaService` behind `MfaUserRepositoryPort` + Prisma adapters (admin +
customer); customer MFA persistence; **TOTP single-use** (atomic claim); **backup-code CAS
single-use**; **customer login MFA gate** end-to-end (Redis challenge store 180s + step-2 route +
client UI). Legacy `auth/mfaService.ts` **deleted**; admin backup-code backfill script added;
`openspec/mfa-consolidation` **archived** with a delivery map. Living specs:
`unified-mfa-service-and-port`, `customer-mfa-persistence`, `mfa-flow-correctness`,
`customer-login-mfa-challenge`.

Also in #130: **audit-actor A1 foundation** (ADR-0020 — `AuditActorType`, exclusive-arc CHECK,
`deriveActorType` + `normalizeAuditActorInput`, actor attribution across 12 services). The **A2
read path is PENDING** (openspec change `audit-actor-polymorphism` stays live; source commits on
`cluster-b-mfa`).

Three renumbered migrations landed: `20260717000000` (audit-actor), `20260717000100`
(customer MFA), `20260717000200` (TOTP single-use).

## 2. Dependency & CI hygiene batch

| PR       | Change                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#134** | `github/codeql-action` v3→v4 (Dec-2026 deprecation resolved).                                                                                                                   |
| **#135** | CVE wave: brace-expansion (3 lines) + axios 1.18.0 + js-yaml 4.3.0.                                                                                                             |
| **#136** | CVE: protobufjs 7.6.5. **Also closed homelab F-1 root cause**: ioredis `commandTimeout:0` was a real 0ms timer → canonical `duplicateForSubscriber` helper, 4 subscriber sites. |
| **#137** | Testing toolchain catalog slice (vitest 4.1.10 + jest-dom 7) — supersedes dependabot group #103.                                                                                |
| **#138** | Code-quality catalog slice (ts-eslint 8.65 + prettier 3.9.5 reformat); **eslint HELD at 9** (react/jsx-a11y lack eslint-10 peers; boundaries v7 config migration = SMELL-66).   |
| **#139** | `@aws-sdk` S3 family lockstep 3.1091.0 (supersedes dependabot #105).                                                                                                            |
| **#140** | lucide-react 1.7.0 (zero impact).                                                                                                                                               |
| **#141** | `S3_ENDPOINT` support (MinIO/LocalStack) + Sentry `disableLogger` → `webpack.treeshake.removeDebugLogging` + OTEL/S3/`TRUSTED_PROXY_HOP_COUNT` documented in `.env.example(s)`. |
| **#104** | isomorphic-dompurify 3.19 merged.                                                                                                                                               |

Plus 8 dependabot minors/CI-actions merged; **#39 closed** (recharts already 3.8.1). All CVE
floors are recorded in `SECURITY_CANON.md §CVE-floor pins`.

## 3. Branch end-state

- **93 branches deleted** after per-commit audits.
- **Kept (mapped):**
  - `cluster-b-mfa` — §2F write-path **v1 reference** (DO-NOT-SHIP) + **A2** audit-actor read-path source.
  - `webhook-wiring` — **WEBHOOK-INGEST blueprint** (inbound pipeline still deliberately unwired on `main`).
  - `containerization-image-hardening` — **#89 paused**, bundler ADR first.
- **Only open PRs:** #89 + #98-101 (its deferred docker bumps).

## 4. New backlog logged during the campaign

- **SMELL-60-66** (`docs/reports/roadmap-detected-smells-backlog.md`): 60 MfaService tx-integrity ·
  61 generic-disable without password re-check · **62 CLOSED (#131)** · 63 force-disable
  dual-audit · 64 duplicate client MFA path + form-test selectors · 65 16× test-wiring factory ·
  66 `eslint-plugin-boundaries` v7 config migration.
- **Test-coverage gap:** admin charts (`Donut` / `HorizontalBar` / `StackedBar` / `TrendArea`) +
  client `PlatformMetricsChart` have no component tests.

## 5. Docs synced by this campaign

- `MASTER_PLAN_ES.md` — N-SEC-1/1b/2/5 annotated with merge PRs + dates; §1 campaign coordination
  note; §5.3 CQRSIntegration #128 + naming caveat; §5.6 dependency batch; §5.1 SMELL-60-66 +
  SMELL-37 MfaService extraction; §6 dashboard N-Nivelación 17/3.
- `FEATURE_TRACE_MATRIX_ES.md` — Nivel-6 MFA row updated to the unified service + customer MFA
  end-to-end + login challenge.
- `NORMALIZATION_ROADMAP.md` — changelog 2026-07-21; §2.2 coverage-floor note; §6.1 pause note.
- `PENDING_WORK_INVENTORY.md` — successor banner; §2F v1-on-`cluster-b-mfa` note; WEBHOOK-INGEST
  blueprint-branch note; SMELL-37 MfaService extraction; ESLINT-HELD re-confirmation.

## 6. Ordered next steps

1. **N-SEC-3 tenant guard (P0, in progress)** — finish Slices 3-8 for the `projectId`-only models
   (RecurringPost, TrackedLink, GeneratedImage, ProjectMember, Channel, Post + out-of-context
   caller audit). Prioritize the credential-bearing models.
2. **N-SEC-4 (P1)** — AI response cache omits `accountId` (`CACHE-XTENANT-AI`).
3. **Audit-actor A2 read path (P1)** — land `audit-actor-polymorphism` (source on `cluster-b-mfa`).
4. **N-COR-1..7 core-publishing correctness** — the data-loss class (UpdatePostStatus no-op,
   saga-restart recovery, client publishing, dunning, cascade-delete tx, timezone, saga tenant-id).
5. **§2F write-path redesign (P1)** — the ~7-slice × 11-provider sub-workstream; the v1 fix on
   `cluster-b-mfa` is DO-NOT-SHIP.
6. **Backlog hygiene** — component tests for the 5 untested charts; SMELL-66 boundaries v7 config
   migration (its own change with per-layer enforcement-preservation probes).
