# Archive Report — `cross-tenant-criticals` (Cluster A of the Nivelación)

Cluster A is closed. All three confirmed CRITICALs are resolved, adversarially
re-verified twice, and the living specs now hold the acceptance criteria as
permanent regression guards.

## Quick path

1. Read `openspec/specs/circuit-breaker-isolation/spec.md` for the C1 (N-SEC-1 +
   N-SEC-1b) tenant-isolation contract.
2. Read `openspec/specs/client-ip-rate-limit/spec.md` for the C2 (N-SEC-2) client-IP
   forwarding contract.
3. Verification: both slices are **PASS** with 0 unresolved CRITICALs (see
   `verify-report.md`, retained in this archived folder).

---

## Delivered

| Item         | What closed                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **N-SEC-1**  | Cross-tenant secret/PII disclosure via the shared circuit-breaker L1 in-process cache. Fixed with a fail-safe cache default (no discriminant ⇒ skip, never share) plus a credential-derived `cacheKeyDiscriminant` on all 60 `cacheEnabled:true` sites. |
| **N-SEC-1b** | Cross-tenant availability coupling via shared circuit STATE (one tenant's failures tripping another tenant's breaker). Fixed by partitioning STATE per `service:operation:<discriminant>`, including write ops.                                         |
| **N-SEC-2**  | Portal-wide AUTH DoS from the Next proxy layer dropping `X-Forwarded-For`/`X-Real-IP`, collapsing every client onto one rate-limit bucket. Fixed with a per-app relay helper forwarding the real inbound IP across all 4 egress points.                 |

## Key discovery — three cross-tenant disclosure vectors, not one

The original proposal and the first-pass audit modeled only the **L1 in-process
cache** as the leak surface (the confirmed anchor: Facebook `validate-credentials`
serving one tenant's Page `access_token` to another). Two further vectors surfaced
during design and adversarial re-verification, and all three had to close before the
cluster could be called done:

1. **L1 in-process cache** (`Map` in `circuitBreaker.ts`) — the original finding.
   Closed by the fail-safe default (D1b) + `hashCallScope` discriminant (D1).
2. **L2 Redis fallback store** (`FallbackManager`, `ANALYTICS_CB_OPTIONS` /
   `METADATA_CB_OPTIONS`) — a second, independent cache layer keyed
   `fallback:service:operation` with no tenant scoping at all, serving tenant A's
   cached PII response to tenant B on a provider failure. Caught during design
   (D1c) and closed with the same discriminant, threaded into both the fallback
   write and read paths, with the same fail-safe symmetry as L1.
3. **The circuit breaker's bound closure** — the deepest vector, caught only by
   the full adversarial re-verify (not the original 61-site cache-grep audit,
   which is structurally blind to `apps/` and to files that call the breaker
   without literally containing `cacheEnabled:true`). `getOrCreateBreaker` bound
   the **first** caller's `apiCall` closure to the breaker instance and reused
   that instance — and that bound closure — for every later caller of the same
   key. Because the real params live inside the closure (not in `args`), any
   shared breaker key re-ran the first tenant's closure for every subsequent
   tenant, independent of `cacheEnabled` and independent of both cache layers.
   Found live at 10 discriminant-less call sites across three files
   (`instagram/schedulingService.ts`, `instagram/mediaProcessor.ts`,
   `apps/api/src/trends/trendAnalysisService.ts`). **Closed structurally** (design
   D8): the breaker's action became a generic, caller-independent dispatcher
   (`(fn, ...args) => fn(...args)`), and `call()` now fires
   `breaker.fire(apiCall, ...args)` — passing THIS invocation's own closure every
   time. Disclosure is now closed for every call regardless of discriminant; a
   missing/blank discriminant degrades only to shared circuit STATE (availability
   nuance) and cache-skip, never to running another tenant's closure.

This is the load-bearing lesson for future breaker/cache audits: a grep-based
enumeration of `cacheEnabled:true` sites is necessary but not sufficient — it
misses non-cached call sites entirely and is blind to `apps/`. The dispatcher fix
(D8) removes the class of bug structurally rather than depending on 100%
call-site coverage.

## Commits

| Commit     | Scope                                                                                                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `98627f8c` | C1a — breaker mechanism: `cacheKeyDiscriminant` option, `hashCallScope`, L1 fail-safe default (D1b), L2 tenant-scoping (D1c) + S-3 removal (D1c/D7), LRU caps, STATE partition (D2), S-2 blank guard (D6), W-2 prefix-aware admin controls (D5), Facebook `validate-credentials` secret-flip, MERGE-BLOCKING anchor tests. |
| `c1688d23` | C1b + Fix B/D8 — the ~59 per-site `cacheKeyDiscriminant` migrations (all 60 `cacheEnabled:true` sites), write-STATE partition (W-1/D2b), the generic-dispatcher refactor (D8) closing the bound-closure vector at all 10 previously-missed sites + `_template`, and the full 60-site audit table.                          |
| `95b4ec66` | C2 — client-IP relay helper (`forwardedForHeaders`) wired into all 4 Next egress points, `TRUSTED_PROXY_HOP_COUNT` doc clarification, and `W-C2-1` (admin `/admin/auth/login` + `/admin/auth/refresh` added to `AUTH_ROUTE_RULES`, closing a 20x-weaker brute-force cap gap).                                              |

## Verification

Final re-verify (full re-certification after the D8 fix): **PASS**.

- **Cross-tenant disclosure**: CLOSED across all 3 vectors (L1, L2, breaker-closure).
- **Within-tenant cross-resource**: SAFE (resource-scoped reads spot-checked; the
  W-A media-upload byteLength collision is a benign shared-STATE nuance under D8,
  never wrong-media).
- **C2 AUTH DoS**: closed and spoof-resistant; real inbound IP forwarded from all
  4 egress points; session-refresh path confirmed per-user.
- **Tests**: 237/237 GREEN (C1 regression battery — breaker, fallback-strategies,
  facebook, youtube, tiktok, telegram, instagram, apps/api trend service) + 31/31
  GREEN (C2 — 21 backend unit + 5 client + 5 admin helper tests). Zero failed,
  zero cancelled.
- **Fitness (0-defect gates)**: #25 Part A/B (write-path fail-fast) = 0, #26
  (no `.js`-on-`.ts` in Next dirs) = 0, #28 (no dead `config:{rateLimit}`) = 0,
  #11 (no raw `setInterval`) = 0, #9 (`@file` header coverage) = 0, #8
  (no sprint/phase refs) = 0. Zero `any`/`@ts-ignore` in changed source.
- **Note on scope**: the full monorepo test suite and all 24 fitness checks run
  in CI at push (the LXC dev environment cannot run the full suite locally,
  per the standing memory constraint); per-area verification above was
  comprehensive (package-level + cross-provider regression battery) and green.

## Residuals / follow-ups carried forward

| Item                                    | Status                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C2-6**                                | Deferred, non-blocking      | One `node:test` cross-egress + per-user-refresh integration test needs live DB + Redis (LXC-heavy) and was not run. Low risk: the assertion it would make (per-IP bucketing, one user's exhaustion does not de-authenticate another) is already proven at unit level through the REAL production preHandler (`authRateLimit.test.ts`, 21/21 GREEN including spoof-rotation); the refresh path uses the identical relay + trusted-hop mechanism. Track for the next LXC-provisioned verify pass.                                                                                                                                                                                                                 |
| **dist-coherence (ADR-0017)**           | Tracked, not a C1/C2 defect | `apps/client/tsconfig.json` `paths` does not map `@adapters/external-apis` (or `@adapters/fallback-strategies`); a Next app's tsconfig `paths` block fully replaces (not merges) `tsconfig.base` paths, so those imports fall through to the package's gitignored `dist` via Node `exports`. C1 added `hashCallScope` to `src` but the stale dist lacked it, breaking `@apps/client` tsc until the dist was rebuilt manually. Recommendation: either map the two adapters into the Next apps' tsconfig `paths`, or ensure CI always builds adapter dist (`turbo run build` with `^build`) before app typecheck. Track under N-CI-1 / ADR-0017.                                                                  |
| **W-C2-1**                              | CLOSED (in this change)     | Admin `/admin/auth/login` + `/admin/auth/refresh` were falling through to `RateLimitConfigs.STANDARD` (100/min) instead of `AUTH` (5/15min) — a 20x-weaker brute-force cap. Fixed by adding the two literal credential prefixes to `AUTH_ROUTE_RULES` (not a broad `/admin/auth` prefix, which would have wrongly capped the SPA-polled `/admin/auth/me`, `/mfa/status`, `/sessions` reads).                                                                                                                                                                                                                                                                                                                    |
| **S-C2-1**                              | Suggestion, not a defect    | The two bearer-authenticated admin egress calls (`verifyAccessToken` → `/admin/auth/me`, `logoutFromBackend` → `/admin/auth/logout`) do not relay the inbound IP. Low brute-force value (bearer-authenticated) and outside the spec's 4 enumerated egress points — completeness only, consider relaying if these routes ever gain stricter caps.                                                                                                                                                                                                                                                                                                                                                                |
| **S-C2-2**                              | Suggestion, spec wording    | The client-ip-rate-limit spec's forwarding scenario says the proxy "appends" the client IP; the chosen design (D3) is RELAY (copy, no hop added, `TRUSTED_PROXY_HOP_COUNT` unchanged). Behavior-equivalent — the acceptance bar (key at `len - hops`, never the Next socket) holds either way — but the wording should be reconciled on a future spec touch-up. The archived living spec above already uses "relay" language to avoid re-propagating the stale wording.                                                                                                                                                                                                                                         |
| **S-C2-3**                              | Recorded, deliberate        | `apps/client/lib/http/forwardedFor.ts` and `apps/admin/lib/http/forwardedFor.ts` are byte-identical by design (per D3) — avoids reopening the `exports→dist` / `.js`-on-`.ts` resolution wound (ADR-0017). Do NOT DRY this into a shared `packages/*` helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **WARNING-1 (C-4 trend discriminants)** | Documented, non-blocking    | `apps/api/src/trends/trendAnalysisService.ts`'s 4 breaker sites fold a request scope (region/timeframe/contentId/category), not a per-tenant credential — benign today because the closures are empty stubs, and D8 closes the closure vector regardless. If these are wired to real per-tenant data WITHOUT extending the discriminant with tenant scope, an L1/L2 cache disclosure (not closure disclosure) would reopen. Recorded via WHY-comments at each site and in `audit-cache-sites.md`; recommended follow-up is an `apps/`-scoped completeness guard ("no discriminant-less breaker call in `apps/`", design D8's "Fitness #29 idea") — feed to cluster G / N-CI-1, not shipped in this remediation. |
| **Deployment precondition**             | Operational, not code       | Internet-facing deployments MUST place at least one trusted proxy in front of Next; set `TRUSTED_PROXY_HOP_COUNT` to the real ingress hop count. A dev-direct or misconfigured (no-trusted-edge) deployment leaves the leftmost XFF forgeable one tier up.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Checklist

- [x] proposal.md ✅
- [x] specs/circuit-breaker-isolation/spec.md ✅ (delta merged into `openspec/specs/circuit-breaker-isolation/spec.md`)
- [x] specs/client-ip-rate-limit/spec.md ✅ (delta merged into `openspec/specs/client-ip-rate-limit/spec.md`)
- [x] design.md ✅ (D1–D8, retained in the archived folder as the architecture record)
- [x] tasks.md ✅ (all implementation tasks `[x]` except C2-6, explicitly deferred non-MERGE-BLOCKING with proof — see Residuals)
- [x] audit-cache-sites.md ✅ (60-site classification table, retained in the archived folder)
- [x] verify-report.md ✅ (two PASS certifications: full C1b re-cert post-D8, and C2 cert)
- [x] No unresolved CRITICAL in either verify pass

## Source of truth updated

- `openspec/specs/circuit-breaker-isolation/spec.md` — new living spec (no prior main
  spec existed for this capability; the delta spec IS the full spec, folded to
  present tense per the archive convention).
- `openspec/specs/client-ip-rate-limit/spec.md` — new living spec (same).

## Next step (orchestrator actions — NOT performed by this agent)

This agent has **no Bash access** and does **not** touch git. The orchestrator must:

1. `git mv openspec/changes/cross-tenant-criticals openspec/changes/archive/cross-tenant-criticals`
   (`openspec/changes/archive/` does not exist yet in this repo — this is the
   first archived change — so create it fresh with this move. Confirmed via
   `Glob` before writing this report; no prior naming convention to reconcile
   against. If the orchestrator prefers the skill's `YYYY-MM-DD-{change-name}`
   date-prefixed convention, use `openspec/changes/archive/2026-07-08-cross-tenant-criticals/`
   instead — either is consistent since no precedent exists yet.).
2. Commit the archive move + the two new `openspec/specs/*/spec.md` files with a
   conventional commit message (no AI attribution).
3. Mark N-SEC-1, N-SEC-1b, and N-SEC-2 as done in `docs/product/MASTER_PLAN_ES.md §1`.
