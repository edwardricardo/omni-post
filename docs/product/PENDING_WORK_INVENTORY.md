# OmniPost — Consolidated Pending-Work Inventory

> **Status:** Living document. THE base reference for ongoing work.
> **Last consolidated:** 2026-06-19.
> **Owner:** Platform engineering.
>
> **⚠️ Successor note (2026-07-21):** the actionable planning spine is now
> [`MASTER_PLAN_ES.md`](MASTER_PLAN_ES.md) (consolidated 2026-06-29, which asserts this
> inventory was retired that day — but it is still referenced and kept as the detailed
> §2-§7 companion; treat MASTER_PLAN's Nivelación dashboard as newer where they diverge).
> **Merge campaign 2026-07-19..21** landed several §2 items on `main`: AUTH-REGISTER-PRIVESC
> (§2C, PR #126), the MFA cluster behind SMELL-37 (§3B, PRs #129-133), and the circuit-breaker
> cross-tenant cache fix (tracked as N-SEC-1 in MASTER_PLAN §1, PR #124). Full campaign +
> dependency batch: [`../reports/merge-campaign-2026-07-21.md`](../reports/merge-campaign-2026-07-21.md).

## Intro

This is the single, authoritative inventory of all open work in omni-post. It is
**anchored on `docs/product`** — the product roadmap is the SPINE, and every
technical, security, architecture, dead-code, docs, and backlog item below is
classified as **supporting** or **blocking** the product phases and mapped back
onto them.

The two authoritative product docs are `IMPLEMENTATION_PLAN_ES.md` (open
work-items, canonical task IDs) and `FEATURE_TRACE_MATRIX_ES.md` (feature
catalog). Where they conflict, the IMPLEMENTATION_PLAN dashboard is newer and
wins; the matrix's status column is a mayo-2026 snapshot.

**Canonical work-item keys:** `IMPLEMENTATION_PLAN_ES.md` task IDs
(`<FASE>-<APP>-<n>`). Progress ground-truth: **23/67 tasks = 34%** (B done ·
Fase 0 done · Fase 1 7/16 · Fase 2 0/21 · Fase 3 0/14).

Every item below carries: **provenance** (which brief/source it came from), a
**confidence flag**, and a **blocks-which-Fase** tag so the product spine remains
the organizing index rather than a header that the technical sections abandon.

### Confidence legend

| Flag                | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `verified`          | Cross-checked against HEAD / upstream during recovery.                                                    |
| `pending-review`    | F5 audit finding; needs per-item confirmation before acting.                                              |
| `UNVERIFIED-prelim` | WF2 single-pass finder output, **no adversarial verify ran** — a LEAD to confirm, not a confirmed defect. |
| `stale-verify`      | Memory/source > 2 weeks old; re-audit before acting.                                                      |

### Provenance sources

- **product-spine** — `docs/product/IMPLEMENTATION_PLAN_ES.md` + `FEATURE_TRACE_MATRIX_ES.md` + `MULTILINGUAL_SCOPE_ES.md` + `INVESTOR_ES.md`.
- **WF1 / WF2** — the paused "Full Repo Assessment 2026-06-12" (`/root/.claude/projects/-root-omni-post/assessment-work/`). WF1 docs+engram audit is COMPLETE; WF2 code review is PARTIAL (9/20 finders) and UNVERIFIED.
- **F5 / FN-\*** — the f5-audit (`_AUDIT_FINDINGS.md` + `AUDIT_REVIEW_TRACKING.md`).
- **SMELL-\*** — `docs/reports/roadmap-detected-smells-backlog.md`.
- **§N.N** — `docs/architecture/NORMALIZATION_ROADMAP.md`.
- **engram-standing** — engram observations + `~/.claude/projects/-root-omni-post/memory/`.

---

## 1. PRODUCT ROADMAP — `docs/product` (THE SPINE)

> **Done & frozen:** Bloque B (B1-B5) · Fase 0 (all WRK/API/CLI autonomous-function
> slices) · Fase 1 closed tracks (multi-idioma, social-listening, bulk-parser).
> **44 open items remain.**
> **Provenance:** `IMPLEMENTATION_PLAN_ES.md` (PRIMARY, work-items) +
> `FEATURE_TRACE_MATRIX_ES.md` (PRIMARY, feature catalog — status column is a
> mayo-2026 snapshot, superseded by the plan).
> **Confidence:** `verified` for the work-item list; the per-Fase feature-status
> sub-counts (e.g. "Fase 1 7/16") are plan-asserted and conflict with the matrix
> snapshot — treat the open-vs-done split as solid, the matrix status column as stale.

### Fase 1 — "lose deals without it" (4 open) — P1, do these FIRST per §8.5

| ID           | Size | Item                                                                                                | Dep         |
| ------------ | ---- | --------------------------------------------------------------------------------------------------- | ----------- |
| **F1-CLI-4** | M    | Bulk CSV upload UI + per-row outcome report.                                                        | 🔗 F1-API-3 |
| **F1-API-4** | M    | Canva Connect OAuth backend (encrypted tokens, refresh rotation, reuse B3).                         | 🔗 B3       |
| **F1-CLI-5** | M    | Canva embed in composer.                                                                            | 🔗 F1-API-4 |
| **F1-DEC-1** | S    | Mobile decision spike: Expo (RN) vs PWA → ADR in `docs/technical/`. Candidate to defer post-Fase 1. | —           |

> ⚠️ **BLOCKER on F1-CLI-4:** bulk-schedule **targeting concept error** (engram
> `bulk_schedule_targeting_gap.md`) — targeting is per-provider, not per-channel;
> the original design is conceptually wrong. A redesign was flagged before resuming
> the bulk track. Resolve before F1-CLI-4.
> ⚠️ **F1-API-4 (Canva OAuth)** confidence depends on **OAUTH-REFRESH-UNWIRED (§2E)**
> being fixed first — Canva OAuth lands on the publish-flow refresh substrate.

> **§8.5 RULE (hard):** Do NOT start Fase 3 while any Fase 1 item is open.

### Fase 2 — "good to have" (21 open, all pending) — P2

- **Reviews:** F2-WRK-1 [M] GBP/Yelp/Trustpilot adapters · F2-API-1 [S] review model + low-star alerts (🔗F2-WRK-1) · F2-CLI-1 [M] review inbox+reply (🔗F2-API-1)
- **White-label:** F2-API-2 [M] tenant-by-hostname + branding · F2-ADM-1 [S] branding/domain config (🔗F2-API-2) · F2-CLI-2 [M] runtime CSS-var theming (🔗F2-API-2)
- **Recycling/evergreen (🔗B2):** F2-API-3 [S] recurrence model + cooldown · F2-WRK-2 [M] re-enqueue on completed (🔗F2-API-3) · F2-CLI-3 [S] evergreen queue UI (🔗F2-API-3)
- **Moderation:** F2-API-4 [M] cascade engine (rules→LLM judge) · F2-WRK-3 [S] apply in inbox sync (🔗F2-API-4) · F2-CLI-4 [S] rules config UI (🔗F2-API-4)
- **Collision:** F2-API-5 [M] short-TTL lease + optimistic concurrency on send · F2-CLI-5 [S] presence indicator WebSocket (🔗F2-API-5)
- **Complete-partials:** F2-API-6 [S] competitor benchmarking · F2-API-7 [S] link-in-bio public page · F2-API-8 [M] AI carousels (🔗F0-API-1) · F2-API-9 [M] stateless MCP server (🔗B3) · F2-API-10 [S] Looker Studio connector (🔗B5) · F2-API-11 [S] custom report builder (🔗B5)

### Fase 3 — "differentiation" (14 open, all pending) — P2 (gated by Fase 1)

F3-API-1 [M] full multi-tone triage+self-correction (🔗F0-API-2) · F3-WRK-1 [M] real AI video pipeline (text-to-video, async+webhook) · F3-API-2 [S] video endpoints (🔗F3-WRK-1) · F3-CLI-1 [M] video gen UI (🔗F3-API-2) · F3-API-3 [M] content discovery feeds · F3-WRK-2 [S] discovery worker (🔗F3-API-3) · F3-CLI-2 [S] discovery+curation UI (🔗F3-API-3) · F3-WRK-3 [M] RSS auto-posting (🔗B2) · F3-API-4 [S] RSS feed config (🔗F3-WRK-3) · F3-CLI-3 [S] RSS feed UI (🔗F3-API-4) · F3-API-5 [S] image-to-caption (🔗F0-API-1) · F3-API-6 [S] AI alt-text (🔗F0-API-1) · F3-API-7 [M] paid-ads analytics (Meta/Google→star schema) · F3-API-8 [S] audience targeting/sponsoring

> **Out of scope (no tasks):** AI voiceover · meme generator · influencer marketing · blog→video · e-commerce product→post.

### 1.1. Built-but-uncommunicated differentiators (investor-narrative gap)

> Not work-items — these are **13 features already built** but absent from the
> investor narrative (`FEATURE_TRACE_MATRIX_ES.md §7`). ≥5 flagged defensible.
> **Provenance:** product-spine. **Confidence:** `verified`. **Blocks:** nothing
> (narrative/positioning, not engineering) — but lives IN the spine, so tracked here.

The full 13: content versioning · Git-like template versioning (commits/collab) ·
native A/B testing · IG Stories projects · **video segmentation** · crisis
management · **task management** · thread composer · outbound webhooks+DLQ ·
**in-app notifications** · dual payment gateway (Stripe+Paddle) · Saga/Outbox/Inbox ·
audited secret rotation.

### 1.2. Product-scope conflict — default locale (B4)

> **Provenance:** product-spine (`MULTILINGUAL_SCOPE_ES.md:22-26`, conflict #4).
> **Confidence:** `verified`. **Blocks:** localization positioning vs vision.

Default locale flipped `es`→`en` on 2026-05-22 for admin/client consistency; `es`
stays first-class. **Only es/en supported; pt-BR explicitly OUT pending a new
decision** — this conflicts with the INVESTOR roadmap's "2027 es/pt/fr
localization" aspiration. Committed-scope vs vision; needs a reconciling decision.
`MULTILINGUAL_SCOPE_ES.md` is the decision-record artifact.

---

## 2. SECURITY / CORRECTNESS CRITICAL — jumps the queue (BLOCKS product trust)

> These BLOCK client-portal product work across Fase 1-2 (multi-tenant features,
> white-label, reviews, inbox). A cross-tenant IDOR in `/posts` or `/accounts`
> poisons every per-client dashboard the product depends on.
>
> **CONFIDENCE — read before acting:** **every WF2 finding in this section is
> single-pass and UNVERIFIED (no adversarial Verify phase ran).** Treat them as
> LEADS to confirm. The IDOR/auth cluster is corroborated by the smells backlog +
> `known_smell` tags + SMELL-31/32, so confidence is ELEVATED for those; standalone
> WF2 items are leads only. **§8 is the gate that converts these to confirmed defects.**

### 2A. Multi-tenant IDOR cluster — P0 **[SECURITY]** — confidence: mixed, triangulated

The single strongest signal across all sources. Root cause: entities scoped by
`projectId` (not `accountId`) sit OUTSIDE the Prisma `$extends`/RLS guard.
**Blocks:** Fase 1 client-portal + ALL Fase 2 multi-tenant features (white-label,
reviews inbox, per-client dashboards).

- **IDOR-POSTS** — `GET /posts` (no projectId) enumerates ALL tenants' posts; `GET/DELETE /posts/:id` + list-by-projectId lack tenant gate (CWE-639 half-applied). Merge into one fix: add `callerAccountId` owner gate to list/get/delete + `DeletePostUseCase`. **Provenance:** WF2 `api-sec-01/02` (base finder run), `posts-sec-01/02` (`known_smell`) + SMELL-31 sibling. **Confidence:** `UNVERIFIED-prelim` (corroborated by `known_smell`).
- **IDOR-ACCOUNTS** — `/accounts/*` get/list/update/delete by URL param, never checks token `accountId` → full cross-tenant CRUD. Plus `updateAccount` lets any customer raise `maxProjects` (billing quota tamper). **Provenance:** WF2 `acct-idor-01`, `acct-quota-02` (`known_smell`). **Confidence:** `UNVERIFIED-prelim`.
- **IDOR-ANALYTICS** — `GET /analytics/project/:projectId` has NO preHandler; `getDashboard` doesn't verify `accountId` ownership + uses `this.prisma` directly (hexagonal #1 violation). **Provenance:** SMELL-31 (pending) + WF2 theme. **Confidence:** `pending-review`.
- **IDOR-TRACKEDLINK** — TrackedLink (links + UTM) subsystem has zero tenant isolation. **Provenance:** WF2 `api-sec-03` (`known_smell`). **Confidence:** `UNVERIFIED-prelim`.
- **IDOR-SCHEDULEDREPORT** — cross-tenant IDOR + data exfil via attacker-chosen `recipients`. **Provenance:** WF2 `api-sec-04`. **Confidence:** `UNVERIFIED-prelim`.
- **IDOR-NOTIFICATIONS** — `POST /notifications` injects to arbitrary `recipientId`, no tenant check. **Provenance:** WF2 `notif-tenant-01`. **Confidence:** `UNVERIFIED-prelim`.
- **IDOR-RECURRING** — RecurringPost cross-tenant CRUD. **Provenance:** WF2 `api-sec-05` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **IDOR-COMMENTS** — Comments IDOR + authorId/editorId spoof from request body. **Provenance:** WF2 `api-sec-06` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **WRK-MENTION-XTENANT** — mention dedup global `(provider, externalId)` w/o accountId → only the first tenant keeps a shared public mention. **Provenance:** WF2 `wrk-mention-xtenant-dedup-01` (CRIT). **Confidence:** `UNVERIFIED-prelim`.
- **ARCH-PROJECT-SCOPED-GUARD-GAP** — project-scoped models outside the guard rely on inconsistent ad-hoc checks (the root-cause class for this whole cluster). **Provenance:** WF2 `api-arch-01` (ALTA). **Confidence:** `UNVERIFIED-prelim`.

### 2B. Cache cross-tenant — P0 **[SECURITY]** — two distinct sites

> Split out from the IDOR cluster: these are **two separate findings, two
> severities, two cache layers** — they share the root pattern (key omits
> accountId) but are distinct fix sites. **Blocks:** Fase 1-2 client-portal caching.

- **CACHE-XTENANT-HTTP** — `autoCache` HTTP response cache collides cross-tenant on client-portal routes (key omits accountId). **Provenance:** WF2 `cache-sec-01` (CRITICA). **Confidence:** `UNVERIFIED-prelim`.
- **CACHE-XTENANT-AI** — AI cache key omits accountId → cross-tenant AI-response collision. **Provenance:** WF2 MEDIA. **Confidence:** `UNVERIFIED-prelim`.

### 2C. Auth / privilege-escalation — P0 **[SECURITY]**

> **Blocks:** ALL portals (auth substrate). The `api-sec-01` id collision below is
> deliberate: there are TWO finder runs that both emitted `api-sec-01` — the **base
> run** (= IDOR-POSTS in §2A) and the **validation run** (= AUTH-REGISTER-PRIVESC
> here). They are DIFFERENT findings; the disambiguator is load-bearing.

- **AUTH-REGISTER-PRIVESC** — **RESOLVED 2026-07-19 (PR #126)**: the public `POST /auth/register` endpoint (which accepted `role` → created ADMIN users; priv-esc + mass-assignment) was removed for CWE-269; admin users are now provisioned only via `AuthService.registerAdmin` (seed/bootstrap), never a public route. **Provenance:** WF2 `api-sec-01` **(validation run)**. **Confidence:** was `UNVERIFIED-prelim`, now CONFIRMED + FIXED.
- **RATELIMIT-DEAD** — `@fastify/rate-limit` is NEVER registered → the auth `rateLimit` config is dead code; the key is spoofable via `X-Forwarded-For` with `trustProxy:true`. This is the **core rate-limit middleware being absent** — a DIFFERENT artifact from FN-010/FN-027 (the `rateLimitingDashboard` observability plugin, see §4A): different files, different fix. **Provenance:** WF2 `api-sec-02/03` **(validation run)** (ALTA). **Confidence:** `UNVERIFIED-prelim`.

### 2D. DoS / resource — P0/P1 **[SECURITY]**

> **Blocks:** Fase 1-2 realtime/SSE-backed client features.

- **SSE-DOS-CAP** — no per-account concurrent-SSE-connection cap; unbounded `/analytics/stream` + `/notifications/stream`, each allocates a heartbeat scheduler task. P0. **Provenance:** SMELL-32 (pending). **Confidence:** `pending-review`.
- **REALTIME-FULLSCAN** — `updateAllMetrics` (every 30s) pulls full analytics history with joins, no `take`; analytics cache ignores date range + full-table in-memory scans + N+1 on webhook subscriptions. P1. **Provenance:** WF2 `realtime-perf-03` + MEDIA. **Confidence:** `UNVERIFIED-prelim` (the "every 30s full scan" claim is a single-pass lead, not confirmed).

### 2E. Injection / SSRF — P1 **[SECURITY]**

- **TRIAGE-INJECTION** — unmitigated prompt injection in inbox triage via inbound message body; no PII redaction/truncation. **Blocks Fase 3 F3-API-1 (full triage).** **Provenance:** WF2 `triage-injection-02` (ALTA) + MEDIA. **Confidence:** `UNVERIFIED-prelim`.
- **SSRF-WEBHOOK** — blind SSRF in webhook test + media-url allowlist bypass; latent SSRF in the unwired uploadPipeline. Ties to the undocumented `request` SSRF GHSA ignore (§7). **Provenance:** WF2 MEDIA/BAJA. **Confidence:** `UNVERIFIED-prelim`.

### 2F. Write-path correctness — P1 (data-loss class)

> **Blocks:** the core publishing product (Nivel-6 mandatory feature). OAUTH-REFRESH
> additionally blocks F1-API-4 (Canva OAuth).
>
> **⚠️ Scope note (2026-07-21):** §2F is NOT three single-post patches — it is a
> ~7-slice × 11-provider sub-workstream (engram `2f-write-path-real-scope`). A **v1
> write-path fix exists but is DO-NOT-SHIP** (classifier-starvation: `statusCode`-vs-`status`
> means expired tokens never flag reauth on 4 providers); that v1 reference is **preserved on
> the kept branch `cluster-b-mfa`**, NOT on `main`. The redesign stays **P1 pending** — the
> canonical items below (WRK-DOUBLE-POST, OAUTH-REFRESH-UNWIRED, WRK-NO-REAUTH, …) are the
> Nivelación N-COR/N-SEC targets, tracked in `MASTER_PLAN_ES.md §1.B`.

- **WRK-DOUBLE-POST** — crash between provider-OK and OK-log re-posts the tweet (idempotency gap). **Provenance:** WF2 `wrk-publish-double-post-02` (`known_smell`). **Confidence:** `UNVERIFIED-prelim`.
- **OAUTH-REFRESH-UNWIRED** — no OAuth token refresh in publish flow; `OAuthTokenRefresher` unwired; double-refresh race. **Blocks F1-API-4 (Canva OAuth) confidence.** **Provenance:** WF2 `oauth-refresh-01` (ALTA) + MEDIA. **Confidence:** `UNVERIFIED-prelim`.
- **WRK-NO-REAUTH** — publish worker doesn't set `needsReauth` on cred failure → channel silently broken. **Provenance:** WF2 `wrk-publish-no-reauth-04` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **BILLING-DUNNING-DEAD** — Stripe dunning never runs (re-derives provider from payload); failed billing webhook stays `processed=true`+200. **Provenance:** WF2 `billing-fail-01` (ALTA) + MEDIA. **Confidence:** `UNVERIFIED-prelim`.
- **DELETE-CASCADE-NONTX** — multi-table cascade delete not transactional → orphans on partial failure. **Provenance:** WF2 `delete-cascade-tx-04` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **SCHED-TZ** — `computeNextRun` ignores timezone/DST. Affects scheduling correctness (Nivel-6 mandatory). **Provenance:** WF2 `sched-tz-01` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **SAGA-ACCOUNTID-AS-USERID** — saga `accountId` persisted as `userId`. This is a **tenant-identity correctness bug** (a tenancy field written as the wrong identity), NOT cosmetic type-debt. **Provenance:** WF2 MEDIA. **Confidence:** `UNVERIFIED-prelim`.
- **ACCOUNTLIFECYCLE-AGG-BYPASS** — `accountLifecycleService` mutates via `repo.update({field})`, skipping the aggregate (CQRS/DDD violation, data-integrity risk). **Provenance:** WF2 MEDIA. **Confidence:** `UNVERIFIED-prelim`. (Architecture cross-ref: §3B.)
- **STRUCT-BREAKER-BYPASS** — `generateStructured` skips the circuit breaker (resilience gap on AI calls). **Provenance:** WF2 `struct-breaker-03` (ALTA). **Confidence:** `UNVERIFIED-prelim`.

### 2G. CI test-execution gaps — P0/P1 **[SECURITY-ASSURANCE]**

> The regression net for the §2A IDOR fixes. These existing tests run NOWHERE in
> CI — so once the IDOR/auth cluster is fixed, there is no automated gate to keep it
> fixed. A CRITICA + 4 HIGH cluster. **Blocks:** safe remediation of §2A/§2C +
> reliable Fase 1-2 delivery.
> **Distinct from** §3.2 provider contract tests (those are NEW provider MSW
> handlers; this is EXISTING tests not wired into CI).

- **CI-GAP-INTEGRATION** — 16 integration test files run NOWHERE in CI, incl. RLS multi-tenant, publishing saga E2E, GDPR retention, bulk-schedule reconciliation. P0/P1. **Provenance:** WF2 `api-test-01` (CRITICA). **Confidence:** `UNVERIFIED-prelim`.
- **CI-GAP-LIVE-TIER** — live-API tier runs only on main-push, not on PRs; `t.skip` route tests pass green without a server. **Provenance:** WF2 `api-test-02` (ALTA, `known_smell`). **Confidence:** `UNVERIFIED-prelim`. (Backlog sibling: SMELL-1, §3C.)
- **CI-GAP-ROUTE-COVERAGE** — 36/77 route files have zero referencing test (incl. billingWebhook signature, postRoutes). **Provenance:** WF2 `api-test-03` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **CI-GAP-BULK-SCHEDULE** — bulk-schedule reconciliation/relay-retry tests (ADR-0016) don't run. **Provenance:** WF2 `api-test-04` (ALTA). **Confidence:** `UNVERIFIED-prelim`.
- **CI-GAP-RLS** — RLS isolation test (51 tables) not in CI. **Provenance:** WF2 `api-test-05` (ALTA). **Confidence:** `UNVERIFIED-prelim`.

### 2H. Other named MEDIA-tier correctness findings — P2

> Pulled out of the catch-all so nothing is buried. **Blocks:** general reliability;
> none gates a specific Fase. **Confidence (all):** `UNVERIFIED-prelim`.

- **SAGA-NO-INFLIGHT-GUARD** — `executeSagaAsync` has no in-flight guard (concurrent-execution risk). WF2 MEDIA.
- **SAGA-DOUBLE-NOTIFY** — saga double-notify. WF2 MEDIA.
- **THREAD-CORRELATIONID-LEAK** — thread `correlationId` Map leak (unbounded growth). WF2 MEDIA.
- **WORKERS-OTEL-NO-FLUSH** — workers OTel never flushed on shutdown (lost spans). WF2 MEDIA.
- **STRUCT-BACKOFF-NO-CAP** — structured retry backoff without cap/jitter. WF2 MEDIA.
- **OCC-VERSION-HARDCODED** — OCC version hardcoded in `UpdatePostCommandHandler`. WF2 MEDIA.
- **FITNESS-23-EVADED** — fitness #23 evaded via `$queryRaw<T>` tagged-template form. WF2 MEDIA.

---

## 3. ARCHITECTURE / QUALITY DEBT — supporting (enables clean Fase 2-3 build)

### 3A. Normalization roadmap follow-ups

> **Provenance:** NORMALIZATION_ROADMAP.md. **Confidence:** `verified` (roadmap is canon).

- **§6.1 Containerization image hardening** — P1 — 7 Dockerfiles, Trivy CVEs, Docker Hub flake; `apps/api/Dockerfile:8` references a nonexistent base path with invalid syntax. **The only chronic red on `main`.** IN-PROGRESS, PAUSED pending a real bundler (tsup/esbuild) via ADR first (engram `containerization-paused-resume`). **Blocks:** §6.2 (k8s) + deployment.
- **§3.1.b/c OpenAPI auto-gen** — P1 — migrate ~342 routes to full Zod schemas (~50-60h); 411 paths carry `unknown` responses; then wire admin/client typed-clients. **Blocks typed product UI work across all Fases.**
- **§3.2.b/c/d Provider contract tests** — P1 — migrate 10 remaining providers to MSW (Telegram done, ~20h); sandbox apps (Edward, out-of-repo); nightly `provider-sandbox.yml`. **Blocks reliable adapter work for Fase 2 Reviews (F2-WRK-1) + new providers.**
- **§4.1.b/c Saga+Outbox chaos** — P1 — 2 remaining L1 scenarios + L2 real-crash infra (~6-10h). **Blocks:** publishing-saga reliability confidence.
- **§4.2.b/c Observability ops** — P1 — 6+ canon alerts + runbooks (~3-4h) + Alertmanager/Slack/PagerDuty wireup (~4-6h, NOT token-blocked).
- **§2.2.b Coverage+mutation gates** — P1 — measure per-scope, ratchet to aspirational (domain 90 / app 85 / infra 70), drift alert. Blocked on ≥1 post-Phase-A2 CI run with `--coverage`.
- **§5.1.e** — P1, trivial — delete empty `@core/application` package once zero importers.
- **§4.3.b/c/d Data retention/GDPR** — P2 — DSAR real dump + event retention + PII masking in `AuditLog.metadata`.
- **§6.2 Kubernetes readiness** — P2 — zero manifests today (7 sub-gaps: manifests, resources, secrets, migration Job, stateful deps, preStop/readiness, GitOps). Blocked on §6.1.
- **§5.2 queue triada** (DEFERRED, trigger not met: 1 worker entry) + **§1.6 Phase-3** feedback-tripwire ramp-up — P2 / deferred.

### 3B. Architecture smells (dedup'd with WF2 + F5)

> **Provenance:** SMELL backlog + WF2 + F5. **Confidence:** SMELL `pending`, WF2 `UNVERIFIED-prelim`, F5 `pending-review`.

- **ARCH-RAW-PRISMA** — **two distinct surfaces, do not conflate:**
  - **ARCH-WORKERS-PRISMA** (`apps/workers`) — processors talk to Prisma directly, bypassing DI use-cases/aggregate/UoW/outbox + no tenantGuard/RLS GUC. = SMELL-26 + WF2 `wrk-no-tenant-guard-defense-03`. P1, also security-adjacent (§2F). **Blocks:** Fase 2 recycling/moderation workers.
  - **ARCH-ROUTES-PRISMA** (`apps/api` routes) — route handlers use PrismaClient directly, bypassing use-case/UoW/aggregate/events + fitness #1/#21. = WF2 `routes-prisma-03`. P1.
- **EVENT-DUAL-SYSTEM** — CQRS integration events published outside the UoW tx; parallel `EventService`/Redis pub-sub vs outbox `EventDispatcher`. The integration-events pipeline is dead in prod. Classify canonical-separation vs drift. = SMELL-10 + WF2 MEDIA + WF2 `api-dead-01`. P1.
- **PROVIDER-CAPS-DRIFT** — `ProviderCapabilities` shape duplicated in 4 drifted places (`mentions` flag only on port+adapters); plus `ProviderId` declared in 3 places (`"twitter"` vs `"x"`). Unify to single source. = SMELL-23 + F5 FN-042. P1.
- **ROI-CALC-DUP** — 3 ROI calc sites → delete legacy. = F5 FN-043 (+ SMELL). P2.
- **SMELL-37 AdminAuthService Control Freak** — PARTIAL (BruteForce injected via ADR-0015); the `MfaService` collaborator was **extracted behind `MfaUserRepositoryPort` + DI** by the MFA consolidation (N-SEC-5, PRs #129-133, 2026-07-19..21) — still 2 inline collaborators (`PasswordService`, `SessionManager`) + off-spine audit write (`this.prisma.auditLog.create`). P1.
- **SMELL-47** — 14 sites bypass `AuditLogRepository` port (write/read `prisma.auditLog` directly) across 9 files. **DI hygiene, NOT security** (AuditLog is outside RLS by canon). P1.
- **SMELL-44** — `ChannelAuthFailureRecorder` (workers) overlaps `UpdateChannelAuthStateUseCase` (@core); needs a canonical `ChannelAuthFailed` domain event first. P2. (Related: WRK-NO-REAUTH §2F.)
- **SMELL-28** — `Account.subscription` column dropped but 2 prod sites still reference it (`updateSubscription` THROWS at runtime; `AccountDto.subscription` always undefined). **Runtime bug.** P1.
- **ACCOUNTLIFECYCLE-AGG-BYPASS** — see §2F; architecture facet is the aggregate bypass. P2.
- **SMELL-49 TS project references** — all 48 `packages/core/*` should migrate to real project refs (`composite:true`); currently uniform `noEmit:true`. Needs its own ADR/workstream; high risk. P2.
- **SMELL-48 bundle size** — admin+client exceed size-limit; interim bumps applied (admin 1.2→1.35MB, client 1.4→1.75MB); possible server-only-import pollution. Needs audit + tree-shake + restore limits. P2.
- **SMELL-50 hoisting audit** (every `.npmrc` hoist pattern + phantom/hoisted-dep reliance) + **SMELL-43** (19 `no-orphans` warns in admin). P2.
- **Cosmetic casts / type-debt:** SMELL-2 (`customReportRoutes.getAccountId` cast), SMELL-5 (`structuredSchemas` 4× `as Record`), SMELL-7 (`index.ts:883` double-cast), SMELL-8 (`orchestrator.ts` `as Record`), SMELL-33 (`byProvider` shape mismatch FE vs engine). P2.

### 3C. Architecture/AI quality smells previously dropped — now restored

> **Provenance:** SMELL backlog. **Confidence:** `pending`.

- **SMELL-16** — Trend-radar multi-source has NO plan-tier/on-demand billing gate (Perplexity Sonar consumed regardless of plan). **Direct cost/revenue leak.** P2 (cost). **Blocks:** Fase 3 trend-radar monetization.
- **SMELL-17** — `AIServicePort.generateStructured` doesn't expose Perplexity native citations; workaround embeds URLs in schema (hallucination risk). Needs citation-aware `WebSearchPort`. P2.
- **SMELL-21** — RAG not validated against live providers (AI keys empty in `.env`); re-run once a key is configured. P2.
- **SMELL-24** — Bluesky mention search requires a connected channel; no public-AppView no-auth fallback path. P2. **Blocks:** social-listening completeness.
- **SMELL-25** — Mention→tracked-term attribution is case-insensitive substring, first-match, single-valued (no multi-term, no synonym map). **Attribution-quality issue** (recategorized — not a cast). P2.
- **SMELL-29** — `PrismaAccountRepository` (command repo) has no dedicated integration test (mis-named file masked it). P2. (Test-gap sibling of §2G.)
- **SMELL-1** — Old integration tests use the skip-if-API-down anti-pattern (silent green CI) vs fail-loud canon. P2. (Overlaps CI-GAP-LIVE-TIER §2G conceptually; distinct backlog marker.)
- **SMELL-52** — Frontend `dev` scripts switched to `next dev --webpack` (from Next 16 Turbopack) to avoid OOM on the 9GB homelab box (~350MB win, 21→8 procs). Verdict: **DEFERRED (revert-when-RAM-allows)** — drop `--webpack` when the box has more RAM. Production build untouched. Not a code defect. P2.

### 3D. F5 SUPERSEDED dead-code — P2, DELETE-NOW

> **Provenance:** F5 §1-2. **Confidence:** `pending-review`. **Blocks:** nothing (cleanup).

- **FN-001** PublishingOrchestrator + 3 siblings (superseded by `publishPostSaga`) — DELETE-NOW.
- **FN-002** EventPublisher (dup of `ComposedEventDispatcher`) — DELETE-NOW.
- **FN-003 / FN-049** `orchestration/sync/*` (6 files), no productive caller — DELETE-NOW.
- **FN-005** DLQ adapter `dead-letter-queue/src/index.ts` non-port-bound dup of `BullMQDeadLetterQueueAdapter` (+ canon violations: raw pino + env reads) — DELETE-NOW.
- **FN-006** AccountMapper zero callers — DELETE-NOW.
- **FN-009** `optimizedPostsRoutes.ts` never registered — DELETE-NOW (**NEEDS_EDWARD:** active experiment?).
- **FN-013** `saga/sagaManagerTypes.ts` missing `@layer` header — fitness #10 hard-zero violation — **FIX-NOW (30s).**

### 3E. F5 orphan queues — P2, DELETE-NOW + reconcile with product

> **Provenance:** F5 §4. **Confidence:** `pending-review`. All in
> `packages/adapters/queue-bullmq/src/constants.ts` — declared, no producer/processor.

- **FN-017** `recurring-posts` · **FN-018** `detect-repurpose` · **FN-019** `triage-inbox` · **FN-020** `trend-radar` (+ `trendAnalysisService.ts` returns mock viralDNA — **NEEDS_EDWARD** on the mock service) · **FN-021** `report-generation` (client has an honest "cron not wired" banner).

> ⚠️ **CAUTION:** these queue names overlap Fase 0/Fase 2 product features. Fase 0
> moved the autonomous-function consumers **in-process into `apps/api`**, so these
> package-level queue constants may be genuinely orphan — but **confirm they are
> truly orphan vs the in-process consumers** before deleting.

### 3F. F5 architectural-violation / canon — P1/P2

> **Provenance:** F5 §9-11. **Confidence:** `pending-review`.

- **FN-045** — 29 `packages/` files missing `@layer` — **FIX-NOW** (fitness #10 hard-zero). P1.
- **FN-040** SemanticLockPort impl in apps/api, not packages — DECIDE. P2.
- **FN-041** PaymentAdapter impls in `apps/api/billing`, not packages (FN-004 blocker resolved) — DECIDE. P2.
- **FN-044** — 15 `packages/` files raw `import pino` — DEFER. P2.
- **FN-046** template env reads — NO-ACTION (intentional scaffolding; confirm). P2.

### 3G. F5 §12 UNKNOWN — VERIFY-class (open verification work)

> **Provenance:** F5 §12. **Confidence:** `pending-review`. These need a VERIFY pass
> before they can be classified as dead, forgotten, or live — do NOT silently drop.

- **FN-026** EngagementPredictor — VERIFY (maps to predictive-analytics surface).
- **FN-047** CRM HubSpot/Salesforce adapters — VERIFY (matrix lists CRM as Nivel-2 built; confirm).
- **FN-048** Storage azure/cloudinary/gcs adapters — VERIFY.

---

## 4. FORGOTTEN-FEATURES — backend-ready, UI-missing (fast product wins)

> Cheap value: backend exists, only wiring/UI needed. Several map directly onto open
> product items. **NEEDS_EDWARD product decisions flagged.**
> **Provenance:** F5 §5/§6 + SMELL backlog + WF2. **Confidence:** F5 `pending-review`, SMELL `pending`, WF2 `UNVERIFIED-prelim`.

### 4A. Backend ready, UI/wiring absent — P1/P2

- **WEBHOOK-INGEST** — 11/13 files form a complete HMAC-verifying inbound pipeline (≈600 tests), no construction site, no inbound route, SSE broadcaster `undefined`. **[security-adjacent]** Close via workstream WEBHOOK-INGEST. = SMELL-38 + WF2 `api-dead-01`. P1. **Maps to inbox/reviews product surface (Fase 2).** **Blueprint preserved on the kept branch `webhook-wiring`** (merge campaign 2026-07-21); the inbound pipeline remains **deliberately unwired on `main`** until the workstream lands.
- **FN-024 Scheduled Reports cron** — service+use-case exist, no scheduler trigger. WIRE-BACKEND (~2-4h, unblocked now FN-015 resolved). P1. (Related orphan queue: FN-021.)
- **SMELL-3 Repurpose variant approve/reject** — use-cases in DI, no route consumes them, UI removed. Needs API + UI. P1. **Maps to Fase 0 repurpose track gap.**
- **SMELL-13/14 Inbox quality** — no `priority` filter (the principal triage output, needs `priority?` through `GetInboxQuery`+repo) + no `isOurReply`/`direction` flag (`MessageBubble` renders all as inbound). P1. **Maps to inbox product quality (Fase 1-3).**
- **SMELL-30 Admin SSE proxy** — admin Next proxy buffers SSE (`await upstream.text()`) → realtime broken. Same fix as the client B3 proxy. P1.
- **FN-029 Admin webhook subscription selector** — calls `/api/backend/projects` (nonexistent), always empty. FIX-NOW (**NEEDS_EDWARD:** permissions). P1.
- **FN-022 Video pipeline** — `apps/api/src/video/` (7 files tested), no UI consumer. DECIDE. **NEEDS_EDWARD.** **Maps to Fase 3 F3-WRK-1/F3-CLI-1.** P2.
- **FN-023 PredictiveAnalytics ML UI** — calls endpoints returning `501`. WIRE-BACKEND or disable UI. **NEEDS_EDWARD.** P2.
- **FN-025 AI quality fields** — `estimatedEngagement`, `readabilityScore` backend returns null. DECIDE. **NEEDS_EDWARD.** P2.
- **FN-010/FN-027 rateLimitingDashboard** — plugin tested, never registered, no admin UI. DECIDE wire-or-delete. **Distinct from RATELIMIT-DEAD (§2C)** — this is the observability dashboard plugin, not the core middleware. P2.
- **SMELL-45 threading UI** — `packages/core/threading` complete (5/5) but the threads dashboard UI is absent (client+admin). **NO DELETE.** + absorption-into-`@core/domain` decision. P2.
- **SMELL-46 saga UI** — 2 TanStack saga hooks (`useSagaStatus`, `useStartPostPublishingSaga`) + `<SagaProgress>` never created. **NO DELETE.** P2.
- **SMELL-41 unwired use-cases** — `EnableReportSharingUseCase` (token, no binding) + `SendEmailNotificationService` (no token). Wire or WONT_FIX. P2.
- **SMELL-9 InboxEventHandlers** — registered in DI, never subscribed to `EventDispatcher`; notification side of inbox dormant. Classify dead vs forgotten. P2.
- **SMELL-27 Admin platform-operator analytics** — never activated/reviewed (verify wired, real data not mocked). P2.
- **SMELL-51 admin hooks** — `useAuditLogs` + `useContentLibrary` (backends+tests exist, pages missing). **Product decision — never auto-delete. NEEDS_EDWARD.** P2.
- **WF2 dead DI** — `PublishFirstCommentUseCase` registered never invoked (`api-dead-02`); OptimizeContent/GenerateContentCalendar/SagaManager `new`-bypass; orphan tokens (PaymentAdapter, Enable/DisableReportSharing, Approve/RejectRepurposeVariant). Classify. P2.

### 4B. UI ready, backend pending — P1/P2 (NEEDS_EDWARD)

- **FN-028** `settings/referral/page.tsx` fetches a nonexistent referral-stats endpoint. DECIDE + wire if real. **NEEDS_EDWARD.** P2.
- **FN-030** 4 orphan admin hooks → `/api/backend/*` nonexistent (`useContentLibrary`, `useUniversalAnalytics`, `useMultiPlatformScheduling`, `usePerformanceInsights`). ⚠️ **Resolved-via-side-effect of FN-012, but its own entry still says `Status: PENDING`** — confirm before deleting the residue. DELETE-NOW residue. P2.

---

## 5. FORGOTTEN-FEATURES — duplication to consolidate (F5 §7)

> **Provenance:** F5 §7. **Confidence:** `pending-review`. P2.

- **FN-031** `sessionCookie.ts` dup admin+client → CONSOLIDATE-TO-PACKAGE.
- **FN-032** `LoadingSpinner.tsx` dup (~15min) → CONSOLIDATE-TO-PACKAGE.
- **FN-033** `notificationStore.ts` (Zustand) dup → CONSOLIDATE (diff first).
- **FN-034** `useMultiPlatformScheduling.ts` hook dup → ⚠️ **admin-side resolved-via-side-effect of FN-012.11 but own entry still `PENDING`** — consolidate client residue only.
- **FN-035** `multi-platform-scheduling.ts` types dup → ⚠️ **admin-side resolved-via-side-effect of FN-012.19 but own entry still `PENDING`** — CONSOLIDATE residue.

### 5.1. F5 tracking-inconsistency note (act-on-with-care)

> The F5 dashboard counts **38 PENDING**, but **FN-030, FN-034, FN-035, FN-038** are
> resolved-via-side-effect of FN-012 yet still carry `Status: PENDING` in their own
> entries (real open count ≈ **34**). **FN-038** (§8 MISMATCH, dup of FN-030) — note
> as resolved/dup. **FN-039** (§8 MISMATCH) — resolved-in-fact (FN-014 was executed),
> still `PENDING` → **done-pending-confirmation**. Treat all of these as done, but
> confirm the status-vs-fact split before deleting any residue.

---

## 6. DOCS / ENGRAM HYGIENE — WF1 verdicts (complete, persist needed)

> **Provenance:** WF1 (COMPLETE, 21 agents — 179 docs + 107 memories audited).
> Verdicts produced but **NOT persisted.** **Confidence:** `verified` (WF1 ran to completion).

### Docs — P2 cleanup, except the broken canon pointer (P1)

- **14 DELETE:** `docs/api/cqrs.md` + `integration-examples.md` (document a non-existent CQRS Bus API), 8 `docs/audits/_raw/graph-*`/`madge-*` (stale `edc8ab61`), `T5_T6_PARALLELIZATION_DECISION.md`, `docs/admin/dashboard.md` (false "auth disabled"/"React 18"), 2 stale reports. **75 ACTUALIZAR · 36 ARCHIVE · 1 RECLASIFICAR.**
- **Dominant ACTUALIZAR driver:** `application-services-to-core` (S1'-S5) moved every `@layer application` use case to `packages/core/*/src` → broke paths across nearly all of `docs/api/`.
- **P1 — BROKEN CANON POINTER:** `docs/frontend/REACT_STANDARDS.md` is referenced by `CODING_STANDARDS.md:263` + `CLAUDE.md:134` (both auto-loaded) but **does not exist**. **Create it.** Other ALTA missing docs: `docs/technical/README.md` (ADR index 0001-0016), `PROVIDER_OAUTH_FLOW.md`, `WORKERS.md`, `onboarding.md` (homelab day-1). 15 missing docs proposed total (5 ALTA / 7 MEDIA / 3 BAJA).
- **Product staleness (WF1 group `product`):** matrix (05-17, pre-Fase-0) vs plan (05-27) conflict — the single biggest cross-doc staleness. Investor/marketing metrics rotted. P2. See §6.1 confidence note.

### Engram — P2, persist verdicts

- **26 KEEP · 8 UPDATE · 72 ARCHIVE · 1 MERGE.** 8 UPDATE: `sdd-init/omni-post` + `testing-capabilities` (turbo 2.8.21→2.9.16, vitest 4.0.18→4.1.8, "24"→"25" fitness), #48/#50/#73/#80/#91 (now DONE/merged). 1 MERGE: #12→#18. Persist for Edward to confirm.

### 6.1. Stale-metric reconciliation (do NOT present as settled)

> The rotted product/investor counts conflict across docs. Present as
> WF1-asserted-vs-INVESTOR, not as fact:
>
> - **Providers:** WF1 says **11** (INVESTOR says 10). 11 is the canonical count (Prisma `Provider` enum).
> - **Prisma models:** WF1 asserts **124**; INVESTOR says **98**; canon references "56 mutating use cases". 3-way discrepancy — present 124 as WF1-asserted-conflicts-with-INVESTOR-98, NOT settled.
> - **LLM providers:** WF1 says **4** (INVESTOR says 3).
> - **Image model:** INVESTOR still says "DALL-E 3"; matrix/canon reference GPT Image 1.5 routing — stale model name.
>
> Fix investor/marketing copy to the reconciled numbers as a P2 docs task.

---

## 7. STANDING SMALL BACKLOG — discrete, mostly small

> **Provenance:** engram-standing (verified vs upstream where time-sensitive). P2 unless noted.

### Closed-by-removal (dep-baseline Step 5)

- **CONCURRENTLY-BUMP** — CLOSED 2026-06-23 by removal. `concurrently` is no longer a dependency (Turbo replaced the concurrent dev orchestration — `pnpm dev` = `turbo run dev`). Verified: 0 presence in any manifest, the catalog, `pnpm.overrides`, or even transitively in `pnpm-lock.yaml`. The 9.2.1→10.0.3 bump is moot. (dep-baseline T5.5.)

### Dated-debt overrides — remove-when gates (dep-baseline Step 5, dated 2026-06-23)

> Each surviving `overrides` literal that is a temporary hold (not a permanent CVE floor) carries a documented remove-when so the audit grep has a removal trigger. **As of ADR-0019 the `overrides` block (and `auditConfig.ignoreGhsas`) live in `pnpm-workspace.yaml`, not root `package.json`** (pnpm 11 stopped reading the `package.json` `pnpm` field). The CVE-floor catalog pins (axios/form-data/validator/ws + tough-cookie + @hono/node-server) are recorded in `docs/security/SECURITY_CANON.md §Audited audit-ignores`.

- **ESBUILD-OVERRIDE** — `esbuild:0.28.1` override (`pnpm-workspace.yaml` `overrides`; relocated from root `package.json` per ADR-0019). **Remove-when:** vite's bundled esbuild peer allows `>=0.28.1` AND the 2 JSX frontends move off vite 7.3.5. Still blocked 2026-06-23: vite held at 7.3.5 for the JSX frontends (vite 8 rolldown breaks JSX in vitest SSR — vitejs/vite#21505), so the esbuild pin stays. `verified`.
- **SHELL-QUOTE-OVERRIDE** — `shell-quote:1.8.4` override (CVE pin, transitive). **Remove-when:** every consumer pulling `shell-quote` declares a range that already resolves `>=1.8.4` on its own (i.e. the override becomes a no-op de-dup) — verify empirically by removing it, `pnpm install`, `pnpm audit`; if no advisory surfaces it was de-dup-only and can be dropped. Kept 2026-06-23 (CVE floor still load-bearing). `verified`.
- **VITE-HELD-7.3.5** — `vite:7.3.5` override held below latest (8.x). **Remove-when:** vite 8's rolldown parser handles JSX in vitest's SSR transform (tracking vitejs/vite#21505) OR the frontend test stack migrates such that the JSX-in-SSR path is no longer exercised. The ~83 plain-TS backend packages already auto-install vite 8 fine; only the 2 JSX frontends (admin+client) and the `catalog` block force-hold 7.3.5. New 2026-06-23. `verified`.
- **ESLINT-HELD-9.36.0** — `eslint:9.36.0` (root literal, NOT cataloged) held below eslint 10. **Remove-when:** `eslint-plugin-react` + `eslint-plugin-jsx-a11y` publish an eslint-10 peer range (both currently declare no eslint-10 peer). Bumping eslint to 10 ahead of the plugins crashes `pnpm lint`. New 2026-06-23. **Re-confirmed 2026-07-21 (PR #138):** the code-quality catalog slice bumped ts-eslint 8.65 + prettier 3.9.5 but **held eslint at 9** for exactly this reason; the boundaries v6→v7 config migration this unblocks is tracked as **SMELL-66**. `verified`.
- **MINIMATCH+BRACE-EXPANSION-NOT-FORCE-PINNED** — deliberately NOT force-pinned to their latest majors (minimatch 10 / brace-expansion 5). **Reason (drift-hydra, ADR-0018):** those majors dropped the callable-default export that the eslint toolchain (`eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5`, both declaring `minimatch ^3.1.2`) still uses; forcing the major crashed `pnpm lint` while build/test/typecheck passed. Left consumer-governed (multiple versions coexist). **Re-pin-when:** a real CVE floor surfaces under a consumer's range (`pnpm audit`), then pin to the minimal patched version, never the latest major. New 2026-06-23. `verified`.
- **STORYBOOK-HELD-10.4.6** — Storybook kept at 10.4.6 paired with vite 7. **Remove-when:** Storybook's vite plugin (`@storybook/csf-plugin`) accepts vite 8 AND vite is unheld (see VITE-HELD-7.3.5). New 2026-06-23. `verified`.

### Dated-debt GHSA ignores — remove-when gates (dep-baseline Step 5, dated 2026-06-19)

> `auditConfig.ignoreGhsas` keeps its 3 entries — **now in `pnpm-workspace.yaml`, not root `package.json`**. The prior note ("moving `auditConfig` to YAML is OUT OF SCOPE per the change") is **REVERSED by ADR-0019**: the pnpm 10.16.0 → 11.13.0 migration made the `package.json` `pnpm` field non-functional (pnpm 11 no longer reads it), so the block moved verbatim to `pnpm-workspace.yaml`. Each entry still carries a dated-debt remove-when; mirrored in `docs/security/SECURITY_CANON.md §Audited audit-ignores`. (dep-baseline T5.7; relocation ADR-0019.)

- **GHSA-q7cg-457f-vx79** (`JOI-GHSA-IGNORE`) — `request` transitive via `wait-on` (`jest-process-manager` chain). Dated 2026-06-19. **Remove-when:** `jest-process-manager` ships `wait-on ^8` (latest still declares `^7.0.0`). `verified`.
- **GHSA-p8p7-x288-28g6** — `request` SSRF (medium), transitive; **ties to §2E SSRF-WEBHOOK** — no direct exploit surface confirmed. Dated 2026-06-19. **Remove-when:** the `request`-bearing dep is replaced or upstream patches. `verified`.
- **GHSA-848j-6mx2-7j84** — `elliptic` risky-crypto (low), transitive (crypto chain); no signing path uses the affected curve. Dated 2026-06-19. **Remove-when:** the consuming dep bumps `elliptic`. `verified`.

### Stale — re-audit before acting (> 2wk)

- **CLIENT-DECIMAL-FIX** — `project_backlog_decimal_fix.md` (32d). ~50 unwrapped `.toFixed`/`.toLocaleString` in apps/client, **MOST false positives** (dates, byte sizes, already-numeric percentages). Real audit needed to isolate Decimal-from-API cases. `stale-verify`. DO NOT act on the raw count.
- **CACHING-STUDY** — `AdaptiveTTLManager` + `CacheWarmer`, gated "do NOT build until cache hit < 80% sustained." Watch-item, not actionable. `stale-verify`.
- **DOCS-RELEVANCE-AUDIT** — ~217 md files un-graphed; `docs/reports/` (110 files) highest staleness. Pre-prod cleanup. `stale-verify`.
- **STORAGE-PROVIDERS-DI** — 5 S3 self-construction DI violations (instagram apiClient/mediaProcessor + healthRoutes); dedicated workstream, deliberately out of Item C scope. **Genuinely queued, not stale.** `verified`.

### Other queued — verify ownership first

- Docker Hub pull-flake hardening (mirror/retries) · `storybook:test` → CI · ADRs overdue for accumulated `sensitive-edit` token uses (5-day window — audit `.claude/heuristic-overrides.log`) · opaque codes D/E/F · W2/S1 (need context recovery).

### DROP — already closed/false (verified)

- **Item C** (`queue-bullmq-redis-di` PR2/PR3) — CLOSED 2026-06-13, obs #113.
- **pgvector drift** — RESOLVED (`docker-compose.yml:6` now `pgvector/pgvector:pg16`).
- **"main has ZERO required checks"** — STALE (now 19 required checks + `enforce_admins`). Re-confirm with Edward, then drop.

---

## 8. FINISH THE PAUSED ASSESSMENT — what remains (P1, unblocks confidence on §2)

> The assessment is what converts §2's `UNVERIFIED-prelim` leads into confirmed
> defects. **Until WF2-Verify runs, every P0 in §2 is a lead, not a confirmed bug.**
> Hard constraint: LXC ~9GB, strictly sequential, read-only, no
> builds/tests/graphify/pnpm/node/tsc; heap < 4-5GB.

1. **WF2 remaining finders** — 11 of 20 never ran: admin×2, client×3, packages×5, infra:prisma.
2. **WF2 Verify phase** — adversarial pass to confirm/reject the 65 prelim findings. **NEVER RAN — this is the gate for §2.**
3. **WF3 transversal** — cross-cutting analysis.
4. **Synthesis** — dedupe vs the 46-SMELL backlog + NORMALIZATION_ROADMAP + IMPLEMENTATION_PLAN; propose new SMELLs. (16 WF2 findings already tagged `known_smell`.)
5. **Final report** — write `docs/audits/FULL_REPO_ASSESSMENT_2026-06-12.md` (the only NEW file authorized).
6. **Persist engram verdicts** (§6) for Edward's decision.

- **Resume:** `Workflow({ scriptPath: ".../wf2-code-review-by-target-wf_918cb8ea-923.js", resumeFromRunId: "wf_918cb8ea-923" })` — the 9 completed finders return from the journal cache.
- **Artifacts:** `/root/.claude/projects/-root-omni-post/assessment-work/{wf1-result.json, wf2-partial.json, wf1-raw.txt}`.

---

## 9. RECOMMENDED SEQUENCING

1. **Confirm the P0 security cluster — don't fix blind.** Run **WF2-Verify (§8.2)** on the 13 CRIT / 22 HIGH leads. Prioritize verifying the **multi-tenant IDOR cluster (§2A)**, **cache cross-tenant (§2B)**, and **AUTH-REGISTER-PRIVESC (§2C)** — corroborated by `known_smell` tags + SMELL-31/32, so confidence is already elevated.

2. **Fix confirmed P0 security immediately** — IDOR cluster + cache cross-tenant + register priv-esc + SSE-DoS-cap (SMELL-32) + rate-limit-dead. These BLOCK every per-client/multi-tenant product feature (white-label, reviews inbox, per-client dashboards) the spine depends on.

3. **Close the CI test-execution gaps (§2G) alongside the P0 fixes** — wire the 16 dead integration files + the RLS isolation test into CI BEFORE/WITH the IDOR fixes, so the fixes have a regression net. Without this, the §2A fixes can silently regress.

4. **Fix the write-path data-loss class (§2F)** — WRK-DOUBLE-POST + OAUTH-REFRESH-UNWIRED + SAGA-ACCOUNTID-AS-USERID — before resuming Fase 1. OAuth-refresh-unwired directly undermines F1-API-4 (Canva OAuth); double-post and the saga-tenant-id bug undermine core publishing trust.

5. **Resume the SPINE at Fase 1 (§1)** — but FIRST resolve the **bulk-schedule targeting concept error** (engram) blocking F1-CLI-4, and land F1-API-4/CLI-5 (Canva) on a verified OAuth-refresh substrate. Do F1-DEC-1 (mobile ADR) in parallel — it's a decision, not code. Reconcile the B4 default-locale conflict (§1.2) as part of multi-idioma follow-up.

6. **Land cheap forgotten-feature wins (§4)** that map onto the spine — WEBHOOK-INGEST, Scheduled-Reports cron, SMELL-3 repurpose approve/reject, inbox priority/direction flags (SMELL-13/14) — high value, backend already built.

7. **Pay down the §3 debt that gates Fase 2-3** — OpenAPI Zod (§3.1.b) and provider contract tests (§3.2.b) before building Reviews/new-provider adapters; ARCH-WORKERS-PRISMA (§3B) before recycling/moderation workers.

8. **Fix §6 P1 doc breakage now** (create `REACT_STANDARDS.md` — broken canon pointer in 2 auto-loaded files) and persist WF1 verdicts. Defer bulk doc ACTUALIZAR + §7 small backlog + §3D/3E dead-code deletes + §3C AI-quality smells as background cleanup.

> **§8.5 gates Fase 3 until Fase 1 is fully closed — non-negotiable.**
