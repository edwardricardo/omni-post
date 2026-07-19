# Archive Report — cross-tenant-criticals

> Closure record for the `cross-tenant-criticals` SDD change (Cluster A of the Nivelación).
> Archived 2026-07-19. Store: openspec (files). Cluster tracker: #107.
> Both slices are now merged to `main`, so the change is complete and closed.

## Outcome

The two confirmed CRITICAL defects of Cluster A (Nivelación §1) are closed in `main`:

- **C1 — cross-tenant circuit-breaker disclosure (N-SEC-1 + N-SEC-1b), CWE-639 class.** The
  shared, process-singleton external-API circuit breaker leaked one tenant's data to another
  across THREE vectors: (1) the in-process **L1 cache** keyed by a constant
  `service:operation:W10=` (all 64 call sites invoked with `args = []`), (2) the Redis **L2
  fallback store** keyed `fallback:service:operation` with no tenant discriminant, and (3) the
  breaker's **bound closure** — `getOrCreateBreaker` bound the FIRST caller's `apiCall` and
  re-ran it for every later caller of a shared key. The confirmed anchor leak was `facebook
validate-credentials` serving account A's Page `access_token` to account B within the 5-minute
  TTL. It also shared circuit STATE, so one tenant's failures opened the circuit for all.
- **C2 — portal-wide authentication DoS (N-SEC-2).** The Next portals rebuilt request headers and
  dropped `X-Forwarded-For` / `X-Real-IP`, so the backend's `resolveClientIp` fell back to the
  Next server's `socket.remoteAddress` for every request; the AUTH limiter (5 req / 15 min per IP)
  bucketed the whole portal under one key — 5 login attempts locked out every user, and refresh
  churn de-authenticated concurrent users.

Both were fixed and merged as two stacked slices to `main`, each independently verified.

## Design decisions (final)

1. **C1 — three-axis breaker isolation.** (a) L1 cache keyed by an opaque, credential-derived
   `cacheKeyDiscriminant` the breaker treats as opaque (`hashCallScope` = sha256 hex, first 16;
   raw secrets never used as a key; no `apps/api` tenant context crosses the `packages/adapters`
   boundary). (b) L2 fallback store threaded with the SAME discriminant →
   `fallback:service:operation:<disc>`. (c) Circuit STATE partitioned per discriminant, bounded by
   size-capped LRU (`CACHE_MAX_ENTRIES = 5000`, `BREAKERS_MAX_ENTRIES = 2000`, no timers →
   Fitness #11 clean).
2. **Fail-safe default (D1b/D1c).** No discriminant ⇒ L1/L2 cache SKIP (miss + fetch fresh), never
   a shared constant-key entry. This closed the disclosure leak for ALL sites the instant the
   mechanism landed — un-migrated sites simply stop caching — which is what made the stacked
   C1a → C1b split SAFE (no cross-tenant window in `main`).
3. **Generic dispatcher supersedes disclosure-via-key (D8 / "Fix B").** The full C1b re-verify
   caught the bound-closure vector still OPEN at 10 discriminant-less `circuitBreaker.call` sites
   the `cacheEnabled:true` grep was structurally blind to (`instagram/schedulingService.ts`,
   `instagram/mediaProcessor.ts`, `apps/api/.../trendAnalysisService.ts`). Fix B made the breaker's
   action a static generic dispatcher `(fn, ...a) => fn(...a)` and `call()` fires
   `breaker.fire(apiCall, ...args)`, so EVERY call runs its OWN closure regardless of key.
   Disclosure is now KEY-INDEPENDENT; a missing/blank discriminant degrades only to shared
   cache-skip + shared circuit STATE (availability), never to running another tenant's closure.
4. **Admin controls prefix-aware (D5) + blank-discriminant fail-safe (D6) + dead `cacheKey`
   escape-hatch removed (D7).** `getStatus`/`forceOpen`/`forceClose` match `service:operation` AND
   `service:operation:<*>` partitions (worst-of aggregation) so provider `forceCircuitBreakerClose`
   wrappers keep reaching partitioned breakers; empty/whitespace discriminants are treated as
   absent on both layers; the dormant `FallbackConfig.cacheKey` override was deleted.
5. **C2 — RELAY, do not append (D3).** One small identical per-app helper `forwardedForHeaders`
   (`apps/{client,admin}/lib/http/forwardedFor.ts`) copies inbound `x-forwarded-for` (else
   `x-real-ip`) onto the outbound `fetch` from all four egress points, appending NO hop — so
   `TRUSTED_PROXY_HOP_COUNT` math is unchanged (relay, no `+1`) and the backend `resolveClientIp`
   selects `chain[len − hops]` unchanged. Per-app util (not a new shared package) to avoid the
   `exports→dist` / `.js`-on-`.ts` resolution wound (ADR-0017, Fitness #26/#27).
6. **Do-not-regress + write-path fail-fast preserved.** tiktok token/refresh, snapchat
   refresh-token, and facebook `upload-media`/`post-to-page` stay `cacheEnabled:false`;
   `DEFAULT_EXTERNAL_API_OPTIONS.fallbackEnabled` stays `false` and no write-verb op opts into
   fallback (Fitness #25 A/B hard-zero); no second HTTP limiter and AUTH stays 5/15min fail-open
   (Fitness #28 hard-zero).

## Capabilities / specs applied

Unlike the sibling `post-*-ownership-gate` changes (which merged into ONE pre-existing living
spec), this change establishes **two NEW living capabilities** — neither existed under
`openspec/specs/` before. Each delta's `## ADDED Requirements` became the living requirement set:

- `openspec/changes/cross-tenant-criticals/specs/circuit-breaker-isolation/spec.md` (delta) →
  **`openspec/specs/circuit-breaker-isolation/spec.md`** (living). All 10 requirements (7
  MERGE-BLOCKING) carried over verbatim as the acceptance set; `[MERGE-BLOCKING]` / `[anchor]`
  tags preserved; a living-spec header records the establishing change, PR #124, and the
  verification method.
- `openspec/changes/cross-tenant-criticals/specs/client-ip-rate-limit/spec.md` (delta) →
  **`openspec/specs/client-ip-rate-limit/spec.md`** (living). All 4 requirements (2
  MERGE-BLOCKING) carried over; header records PR #125 + the `SECURITY_CANON §Rate Limiting`
  topology invariant.

The change also updated the security canon and CI fitness suite (landed with the slices, not part
of this archive move):

- **`docs/security/SECURITY_CANON.md §Rate Limiting — Client-IP Derivation Behind Proxies`** — the
  new normative section defining the single canonical `resolveClientIp` chokepoint, rightmost-hop
  selection, fail-toward-socket rule, the `@fastify/proxy-addr` divergence guard, the
  `TRUSTED_PROXY_HOP_COUNT` convention, the frontend relay, and the topology invariant.
- **Fitness #28** (no permissive Fastify `trustProxy: true`) and **Fitness #29** (no raw
  `x-forwarded-for` / `x-real-ip` reads outside `resolveClientIp`) — added to `CLAUDE.md
§Automated Compliance Checks` and `.github/workflows/fitness.yml`.

## Verification status

Both slices were adversarially verified independently (runtime evidence re-executed, not just the
tasks checklist read).

- **C1 — PASS.** Full C1b re-certification after the Fix B / D8 remediation:
  **237 / 237 tests GREEN, 0 failed, 0 cancelled** across the adapter + multi-provider + apps/api
  regression battery (the dispatcher changed EVERY breaker call path). tsc exit 0 on
  external-apis / fallback-strategies / instagram / \_template / apps/api; eslint `--max-warnings 0`
  on the changed set; fitness #25 A/B, #11, #9, #8 all `0`; `any`/`@ts-ignore` = 0 in changed
  source. One documented non-blocking WARNING (WARNING-1: the 4 `trendAnalysisService` trend stubs
  are shipped `cacheEnabled:false`+`fallbackEnabled:false`, so nothing is cached — a tenant-scoped
  discriminant must be re-added TOGETHER with caching when they are wired to real per-tenant data).
- **C2 — PASS.** Per-IP bucketing + spoof-resistance proven at the unit level through the real
  production `resolveClientIp` / preHandler, plus the four-egress relay. `RateLimitConfigs.AUTH`
  stays 5/15min, fail-open WARN preserved, Fitness #26/#28 clean. The cross-egress integration
  test task (C2-6) was documented as a non-MERGE-BLOCKING deferred integration test — the
  MERGE-BLOCKING keying invariant is proven at unit level through the production preHandler.

## Follow-ups (tracked, NOT part of this change)

- **`apps/`-scoped completeness guard (Fitness #29-for-breaker idea).** A guard "no
  discriminant-less breaker call in `apps/`" would close the audit's `apps/` blind spot that let
  the four `trendAnalysisService` sites escape the original `packages/`-scoped enumeration. Under
  Fix B this is a hygiene/noisy-neighbor guard (availability), not a security gate — recommended as
  a follow-up (feed cluster G / N-CI-1), NOT shipped in this remediation.
- **Trend cache landmine (WARNING-1).** When `trendAnalysisService`'s stub closures are wired to
  real per-tenant data, caching MUST be re-enabled together with a tenant-scoped
  `cacheKeyDiscriminant` as a pair (never cache without the tenant scope). An in-code WHY-comment
  at each site records this contract.
- **Provider-wide outage detector (D2b tradeoff).** Per-tenant write STATE trades slightly slower
  COLLECTIVE provider-outage protection for tenant isolation; an aggregate failure signal opening a
  service-level circuit could recover the collective-protection speed without reintroducing the
  cross-tenant coupling. Out of scope, tracked as a follow-up.

## Archive actions performed

- Created the two NEW living specs `openspec/specs/circuit-breaker-isolation/spec.md` and
  `openspec/specs/client-ip-rate-limit/spec.md` by applying each delta's ADDED requirements,
  mirroring the header + requirement/scenario structure of the existing `openspec/specs/*/spec.md`
  files.
- Wrote this archive report inside the change folder so it travels with the folder move.
- **The folder move is deferred to the orchestrator.** This executor has no `git`/`mv` tool, so
  the orchestrator MUST run
  `git mv openspec/changes/cross-tenant-criticals openspec/changes/archive/cross-tenant-criticals`
  (whole-directory move — the target dir must NOT pre-exist so history is preserved and this report
  rides along), then `git add openspec/specs/circuit-breaker-isolation openspec/specs/client-ip-rate-limit`.
  `openspec/changes/archive/` already contains the sibling `post-read-ownership-gate` /
  `post-delete-ownership-gate`, so the no-date-prefix archive convention is followed.

## Merge reference

- **C1 (N-SEC-1 + N-SEC-1b):** PR **#124**, branch `workstream/cluster-a-circuit-breaker-tenant`,
  merge-commit `bb38f5e7`, merged 2026-07-18. Apply commits: `98627f8c` (C1a breaker mechanism),
  `c1688d23` (C1b per-site migration + Fix B/D8), `9bd9df70` (gate fixes), `00d6f30d` (CI fixes).
- **C2 (N-SEC-2):** PR **#125**, branch `workstream/cluster-a-client-ip-ratelimit` (apply commit
  `95b4ec66`, client-IP relay + W-C2-1), merged 2026-07-19.
- **Cluster tracker:** #107 (the superseded Cluster A mega-branch decomposed into the two slices
  above; closes with this archive).
- Date archived: **2026-07-19**.

## Traceability — Engram observations (openspec store; engram is a mirror, not the source of truth)

| Artifact                       | Engram topic_key                            | Observation ID  |
| ------------------------------ | ------------------------------------------- | --------------- |
| Proposal                       | `sdd/cross-tenant-criticals/proposal`       | #198            |
| Spec mirror (delta)            | (spec mirror)                               | #199            |
| Design mirror (delta)          | (design mirror)                             | #200            |
| Fail-safe/split decision       | (decision)                                  | #202            |
| Apply progress                 | `sdd/cross-tenant-criticals/apply-progress` | #203            |
| C1 merge to main (PR #124)     | `nivelacion/slice1-circuit-breaker-gate`    | #378            |
| Archive report (this document) | `sdd/cross-tenant-criticals/archive-report` | #210 (upserted) |

> The authoritative artifacts are the openspec files under this archived change folder; the
> Engram observations above are cross-session mirrors captured during planning/apply/verify.
