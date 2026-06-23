# Tasks: Implementation-Plan Re-validation (Track 2)

## Review Workload Forecast

| Field                   | Value                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~3,500–5,000 across the full change (Phase A ~1,200–1,800 fixes+tests+CI; Phase B mostly `[x]` re-marks + surfaced RE-VERIFY fixes)                                                                                    |
| 400-line budget risk    | High (whole change); Low–Medium per slice once split                                                                                                                                                                   |
| Chained PRs recommended | Yes                                                                                                                                                                                                                    |
| Suggested split         | Phase A: 1 PR per confirmed cluster (IDOR, cache, auth, write-path) ≤400 lines each + §2G wired in-slice → Phase B: per-section PRs (B → F0 → F1 → F2 → F3), split per-item on real builds → catalog-bump root PR last |
| Delivery strategy       | ask-on-risk                                                                                                                                                                                                            |
| Chain strategy          | feature-branch-chain (tracker `workstream/impl-revalidation`)                                                                                                                                                          |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal                                                                        | Likely PR         | Notes                                                            |
| ---- | --------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| 1    | §2A IDOR cluster fix + §2G CI gate wired in-slice                           | PR 1 → tracker    | Confirmed IDOR-POSTS first; sequenced before client-portal items |
| 2    | §2B cache cross-tenant (HTTP + AI key namespace)                            | PR 2 → PR 1       | accountId into CachePort key; no per-class Map                   |
| 3    | §2C auth hardening (register priv-esc + rate-limit)                         | PR 3 → PR 2       | rate-limit fix BLOCKED on canon decision (see 3.x)               |
| 4    | §2F write-path integrity (double-post, OAuth-refresh, needsReauth, saga id) | PR 4 → PR 3       | OAUTH-REFRESH unblocks F1-API-4                                  |
| 5    | Phase B per-section re-validation walks (B → F3)                            | PR 5..N → prior   | Per-item DoD; per-item split on real builds; LXC-serial          |
| 6    | Catalog-bump candidates drain                                               | PR last → tracker | ONE root PR, post-walk                                           |

---

## Phase A — §2 security confirm-then-fix (each cluster = its own ≤400-line PR, verify-after-each)

> Adversarial-VERIFY converts each lead to a verdict BEFORE any fix. Only IDOR-POSTS
> is CONFIRMED (design obs 176: `DeletePostUseCase.execute({postId})` has no owner
> gate). All others are `UNVERIFIED-prelim` — confirm or refute with recorded
> evidence first; a refuted lead gets a not-a-defect log, no fix, no spec requirement.

### A1 — §2A Multi-tenant IDOR cluster (PR 1, wired WITH §2G)

- [x] 1.1 FIX (CONFIRMED) IDOR-POSTS: added `callerAccountId` to `DeletePostInput` (owner gate via `findOwnerAccountId`) + to `GetPostInput`/`GetPostWithThreadInput`/`ListPostsInput`/`ListPostsGlobalInput` (joined filter `where: { project: { accountId } }` in `PrismaPostQueryRepository`); `postRoutes.ts` threads `customerUser.accountId` on delete/get/list/global. STRICT TDD RED→GREEN. (apply slice A1-IDOR-POSTS)
- [x] 1.2 VERIFY IDOR-ACCOUNTS → **CONFIRMED**: `/accounts/:accountId` get/update/delete look up by URL param via `this.prisma.account.findUnique({ where: { id: accountId } })` with `requireClientAuth` only and NO token-vs-URL check (accountRoutes.ts L150-151, L241-242); `listAccounts` returns ALL accounts unfiltered (L188); `updateAccount` writes `maxProjects` from body verbatim (L252-253 = quota tamper). Also DI/hexagonal smell: route uses injected `this.prisma` directly. FIX DEFERRED to follow-up slice.
- [x] 1.3 VERIFY IDOR-ANALYTICS → **REFUTED (not-a-defect for cross-tenant)**: `GET /analytics/project/:projectId` HAS `preHandler:[requireClientAuth]` (L1025) AND explicit ownership gate `getProjectAccess(user.accountId, projectId)` → 403 (L931-934); client `accountId` is stripped, token is authoritative (L87-89). No `getDashboard` method exists; analytics handler receives `prisma` by DI injection (not imported singleton). Residual = read-via-`this.prisma`-not-query-port purity smell (NON-IDOR), deferred to §1 hexagonal cleanup, NOT this cluster.
- [x] 1.4 VERIFY → IDOR-COMMENTS **CONFIRMED** (createComment passes body `authorId` L97, editComment passes body `editorId` L183 — `request.customerUser` read but ignored = identity spoof); IDOR-NOTIFICATIONS **CONFIRMED** (`POST /notifications` createNotification takes body `recipientId` L218/L246 under `requireClientAuth`, not admin — arbitrary recipient injection; user-facing mark-read handlers SAFE, use `user.id`); IDOR-RECURRING **CONFIRMED** (create passes body `projectId` L94, list passes query `projectId` L135, getOne by raw `id` L166 — all with NO `user.accountId` ownership gate); IDOR-SCHEDULEDREPORT **REFUTED at route boundary** (every handler threads token `accountId` via `getAccountId(request)`; get/update/delete by `:id` all pass accountId — recipients stored on accountId-owned report; confirm repo-level filter in own slice); IDOR-TRACKEDLINK **UNRESOLVED** (no tracked-link route surface found in apps/api/src — needs deeper search). FIXES DEFERRED.
- [ ] 1.5 FIX each CONFIRMED transitively-scoped surface (1.2–1.4): joined filter in `apps/api/src/infrastructure/repositories/Prisma*Repository.ts` (S2.1d); directly-scoped accounts → token-`accountId` owner check, remove URL-param bypass + quota tamper; analytics → preHandler + port not `this.prisma`. **DEFERRED to follow-up slice** (IDOR-ACCOUNTS, IDOR-COMMENTS, IDOR-NOTIFICATIONS, IDOR-RECURRING) — kept this slice ≤~400 lines per budget.
- [ ] 1.6 FIX root cause ARCH-PROJECT-SCOPED-GUARD-GAP: apply joined-filter pattern uniformly across confirmed adapters; document each (S2.1d method). **PARTIAL**: posts done (this slice); accounts/comments/notifications/recurring deferred.
- [ ] 1.7 WIRE §2G CI gate IN THIS SLICE: add CI-GAP-INTEGRATION (16 dead integration files incl. RLS isolation + publishing-saga E2E) + CI-GAP-RLS (51-table) into `.github/workflows/*`. Regression net lands WITH the fix, not after.
- [ ] 1.8 REGRESSION TESTS: per confirmed surface — unit (Vitest, foreign `callerAccountId` rejected) + integration (node:test, real DB+Redis, cross-tenant → 403/404). LXC-safe.
- [ ] 1.9 0-DEFECT GATE: lint `--max-warnings 0` · tsc · 24 fitness · targeted tests green. Re-mark only on green.

### A2 — §2B Cache cross-tenant (PR 2)

- [ ] 2.1 VERIFY CACHE-XTENANT-HTTP (`UNVERIFIED-prelim`): confirm/refute `autoCache` key omits accountId on client-portal routes. Record evidence.
- [ ] 2.2 VERIFY CACHE-XTENANT-AI (`UNVERIFIED-prelim`): confirm/refute AI cache key omits accountId. Record evidence.
- [ ] 2.3 FIX each CONFIRMED: add `accountId` to cache-key namespace via `CachePort` (prefix convention); NEVER a per-class `Map` (fitness #14).
- [ ] 2.4 REGRESSION TESTS: same-tenant still hits, cross-tenant miss (InMemoryCacheAdapter).
- [ ] 2.5 0-DEFECT GATE (same bar as 1.9).

### A3 — §2C Auth / privilege-escalation (PR 3)

- [ ] 3.1 VERIFY AUTH-REGISTER-PRIVESC (`UNVERIFIED-prelim`, highest individual severity): confirm/refute public `POST /auth/register` accepts `role`. Record evidence.
- [ ] 3.2 FIX (if confirmed): strip `role` from public register payload; default non-priv role; ADMIN not self-assignable.
- [ ] 3.3 `[!]` FLAG — RATELIMIT-DEAD has NO `SECURITY_CANON` entry (canon gap, logged `.claude/canon-decision-gaps.log`). Research the rate-limit canon (or get Edward authorization) for `@fastify/rate-limit` registration BEFORE applying. Do NOT apply blind. BLOCKS 3.4–3.5.
- [ ] 3.4 VERIFY RATELIMIT-DEAD (`UNVERIFIED-prelim`, after 3.3 cleared): confirm/refute `@fastify/rate-limit` never registered + `X-Forwarded-For`/`trustProxy` key spoof. Distinct from `rateLimitingDashboard` plugin (§4A).
- [ ] 3.5 FIX (if confirmed AND 3.3 authorized): register `@fastify/rate-limit` live + non-spoofable key.
- [ ] 3.6 REGRESSION TESTS: role-in-body ignored; rate-limit fires (node:test, LXC-safe).
- [ ] 3.7 0-DEFECT GATE.

### A4 — §2F Write-path integrity (PR 4)

- [ ] 4.1 VERIFY each (`UNVERIFIED-prelim`): WRK-DOUBLE-POST (`known_smell`), OAUTH-REFRESH-UNWIRED, WRK-NO-REAUTH, SAGA-ACCOUNTID-AS-USERID. Confirm/refute with evidence.
- [ ] 4.2 FIX (confirmed): idempotency guard on provider-OK→log gap (no re-post); wire `OAuthTokenRefresher` into publish + double-refresh guard; set `needsReauth` on cred failure; saga persists `accountId` AS `accountId` not `userId`.
- [ ] 4.3 REGRESSION TESTS: crash-between-steps no re-post; needsReauth set on failure; saga tenant-id correct (node:test, LXC-safe).
- [ ] 4.4 0-DEFECT GATE. OAUTH-REFRESH-UNWIRED closed here unblocks F1-API-4.

---

## Phase B — per-item re-validation walk (INDIVIDUAL, all 67), section-ordered B → F0 → F1 → F2 → F3

> Per-item DoD: SCOPE → dep-freshness gate (shared `ASSERT == catalog pin`; private
> `freshen-contained` via taze private-only) → `pnpm install --frozen-lockfile` +
> `syncpack list-mismatches` green → RE-VERIFY (tests + item DoD + 0-defect canon +
> the now-CONFIRMED §2 caveats for its area, vs MERGED-main post-Phase-A) → `[x]`.
> NO mid-walk catalog edits. Respect `🔗 dep:` + §8.5 (no Fase 3 while any Fase 1 open).
> `[PAUSE-STACK]` = heavy install/build/test → pause dev, heap-cap, run sequential on 9GB LXC.

### B0 — Bloque B (shared blockers, 5)

- [ ] 5.1 RE-VALIDATE **B1** (agent orchestration ADR + PoC + trajectory eval) `[PAUSE-STACK]`.
- [ ] 5.2 RE-VALIDATE **B2** (BullMQ repeatable → Job Schedulers; fitness #20) `[PAUSE-STACK]`.
- [ ] 5.3 RE-VALIDATE **B3** (OAuth 2.1 + PKCE substrate) — cross-check vs §2F OAUTH-REFRESH fix.
- [ ] 5.4 RE-VALIDATE **B4** (multi-language scope decision, doc-only).
- [ ] 5.5 RE-VALIDATE **B5** (semantic layer ≥10 metrics).

### B1 — Fase 0 (autonomous, 11) — all 🔗 dep:B1

- [ ] 6.1 RE-VALIDATE **F0-WRK-1** (repurpose consumer) `[PAUSE-STACK]`.
- [ ] 6.2 RE-VALIDATE **F0-API-1** (repurpose routes) 🔗 dep:F0-WRK-1.
- [ ] 6.3 RE-VALIDATE **F0-CLI-1** (repurpose UI) 🔗 dep:F0-API-1 — `[PAUSE-STACK]` vite 7.3.5 hold; gated by A1 (client-portal).
- [ ] 6.4 RE-VALIDATE **F0-WRK-2** (triage worker) `[PAUSE-STACK]`.
- [ ] 6.5 RE-VALIDATE **F0-API-2** (triage endpoints) 🔗 dep:F0-WRK-2 — apply A1 IDOR caveat (cross-tenant).
- [ ] 6.6 RE-VALIDATE **F0-CLI-2** (triage view) 🔗 dep:F0-API-2 — `[PAUSE-STACK]` vite hold; gated by A1.
- [ ] 6.7 RE-VALIDATE **F0-WRK-3** (trend radar) `[PAUSE-STACK]`.
- [ ] 6.8 RE-VALIDATE **F0-API-3** (trend endpoints) 🔗 dep:F0-WRK-3 — apply A1 cross-tenant caveat.
- [ ] 6.9 RE-VALIDATE **F0-CLI-3** (trend UI) 🔗 dep:F0-API-3 — `[PAUSE-STACK]` vite hold; gated by A1.
- [ ] 6.10 RE-VALIDATE **F0-API-4** (guardrails + telemetry) 🔗 dep:F0-API-1.
- [ ] 6.11 RE-VALIDATE **F0-API-5** (trajectory evals in CI) 🔗 dep:F0-WRK-1/2/3.

### B2 — Fase 1 (necessary, 16)

- [ ] 7.1 RE-VALIDATE **F1-API-1** (per-locale AI + pgvector RAG) 🔗 dep:B4 `[PAUSE-STACK]`.
- [ ] 7.2 RE-VALIDATE **F1-CLI-1** (next-intl `[locale]`) 🔗 dep:B4 — `[PAUSE-STACK]` vite hold.
- [ ] 7.3 RE-VALIDATE **F1-CLI-2** (ICU catalogs) 🔗 dep:F1-CLI-1 — vite hold.
- [ ] 7.4 RE-VALIDATE **F1-WRK-1** (mention fan-in ingest) `[PAUSE-STACK]` — apply A1 WRK-MENTION-XTENANT caveat.
- [ ] 7.5 RE-VALIDATE **F1-API-1b** (mentions + SoV) 🔗 dep:F1-WRK-1 — apply A1 cross-tenant caveat.
- [ ] 7.6 RE-VALIDATE **F1-CLI-3** (listening dashboard) 🔗 dep:F1-API-1b — `[PAUSE-STACK]` vite hold; gated by A1.
- [ ] 7.7 RE-VALIDATE **F1-API-2** (CSV parser + Zod) — standalone.
- [ ] 7.8 RE-VALIDATE **F1-API-3** (bulk CSV fan-out + DLQ) 🔗 dep:F1-API-2 `[PAUSE-STACK]`.
- [ ] 7.9 `[!]` BLOCKED **F1-CLI-4** (CSV upload UI) 🔗 dep:F1-API-3 — stays `[!]` until `bulk_schedule_targeting_gap` (per-provider-vs-per-channel) redesign lands. Do NOT re-validate green.
- [ ] 7.10 `[!]` BLOCKED **F1-API-4** (Canva OAuth) 🔗 dep:B3 — stays `[!]` until §2F OAUTH-REFRESH-UNWIRED fixed (A4.2). Re-validate only after A4 green.
- [ ] 7.11 RE-VALIDATE **F1-CLI-5** (Canva embed) 🔗 dep:F1-API-4 — blocked transitively by 7.10; vite hold.
- [ ] 7.12 RE-VALIDATE **F1-DEC-1** (mobile decision ADR, doc-only).

### B3 — Fase 2 (good-to-have, 21)

- [ ] 8.1 RE-VALIDATE **F2-WRK-1, F2-API-1, F2-CLI-1** (reviews track) — F2-API-1 🔗 dep:F2-WRK-1, F2-CLI-1 🔗 dep:F2-API-1; CLI vite hold + A1 gate; `[PAUSE-STACK]` on WRK.
- [ ] 8.2 RE-VALIDATE **F2-API-2, F2-ADM-1, F2-CLI-2** (white-label) — both surfaces 🔗 dep:F2-API-2; A1 tenant-by-hostname caveat critical here.
- [ ] 8.3 RE-VALIDATE **F2-API-3, F2-WRK-2, F2-CLI-3** (recycling) 🔗 dep:B2 chain `[PAUSE-STACK]`.
- [ ] 8.4 RE-VALIDATE **F2-API-4, F2-WRK-3, F2-CLI-4** (moderation) — WRK/CLI 🔗 dep:F2-API-4.
- [ ] 8.5 RE-VALIDATE **F2-API-5, F2-CLI-5** (collision detection) 🔗 dep:F2-API-5.
- [ ] 8.6 RE-VALIDATE **F2-API-6..11** (complete-partials: benchmarking, link-in-bio, carousels 🔗 dep:F0-API-1, MCP 🔗 dep:B3, Looker 🔗 dep:B5, report-builder 🔗 dep:B5).

### B4 — Fase 3 (differentiation, 14) — §8.5: do NOT start while any Fase 1 item open

- [ ] 9.1 RE-VALIDATE **F3-API-1** (full triage) 🔗 dep:F0-API-2 — apply §2E TRIAGE-INJECTION caveat if confirmed.
- [ ] 9.2 RE-VALIDATE **F3-WRK-1, F3-API-2, F3-CLI-1** (AI video) chain `[PAUSE-STACK]`.
- [ ] 9.3 RE-VALIDATE **F3-API-3, F3-WRK-2, F3-CLI-2** (content discovery) chain.
- [ ] 9.4 RE-VALIDATE **F3-WRK-3, F3-API-4, F3-CLI-3** (RSS auto-posting) 🔗 dep:B2 chain `[PAUSE-STACK]`.
- [ ] 9.5 RE-VALIDATE **F3-API-5** (image-to-caption), **F3-API-6** (alt-text) 🔗 dep:F0-API-1.
- [ ] 9.6 RE-VALIDATE **F3-API-7** (paid-ads analytics) `[PAUSE-STACK]`, **F3-API-8** (audience targeting).

### B5 — Catalog-bump drain (final)

- [ ] 10.1 Collect all shared-dep stale `catalog-bump candidates` logged during the walk; validate each vs CURRENT pin (no force-pin to latest; override only for real CVE floor at minimal patched version, ADR-0018).
- [ ] 10.2 Drain ALL candidates as ONE root PR (zero mid-walk catalog edits). `[PAUSE-STACK]` frozen-lockfile install + syncpack + targeted suite. 0-defect gate.

---

## Sequencing bottlenecks

- **Phase A gates Phase B client-portal**: A1 (IDOR/auth) must land before F0-CLI-1/2/3, F1-CLI-3, F2-CLI-1/2 re-validate green (they carry cross-tenant caveats). A4 (OAUTH-REFRESH) gates F1-API-4 → F1-CLI-5.
- **Canon-gap stall**: A3.3 (rate-limit canon decision) blocks A3.4–A3.5; the rest of A3 (register priv-esc) proceeds independently.
- **LXC serialization**: every `[PAUSE-STACK]` item runs sequentially, heap-capped, dev paused — the dominant wall-clock cost of Phase B (~44 open items build-then-confirm).
- **Hard blockers**: F1-CLI-4 (bulk-schedule redesign) and F1-API-4 (until A4) stay `[!]`; frontend items held at vite 7.3.5.
