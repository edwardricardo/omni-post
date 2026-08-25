# Gate adjudication — `auth-rate-limit-integrity`

Mode: read-only. Every fact I assert below was re-verified against the tree at `workstream/auth-rate-limit-integrity` (= main `8e89b21f`). Where I refuse a finding I give the evidence; where I amend, the amendment is in the design that follows and is marked **AMENDED AT GATE**.

---

## Part I — Adjudication of the blocking findings

### L1-C1 — The named owner requires `config: { rateLimit }`, which R4 abolishes → **AMEND**

**Verified.** `openspec/changes/principal-derived-authority/proposal.md:155`: _"`pre-identity-auth` requires a `config.rateLimit`"_, and `:147` cites `authRoutes.ts:334,346,358` + `customerAuthRoutes.ts:501` — four of the seven blocks C9 deletes — as its precedent. R4.1/R4.2 are MERGE-BLOCKING here and fitness #33 locks the class shut. The collision is real and neither document knew.

I refuse one implicit premise: this change does **not** owe accommodation to an un-landed draft. `principal-derived-authority` has zero commits and is untracked; R4 is a ratified merge-blocking requirement of the change actually in flight. The draft adapts, not the spec.

**Amendment.** §3 now states the interface this change publishes _for exactly that consumer_: `rateLimitPolicy.ts` exports `resolvePolicy(pattern, method): RateLimitConfig | undefined` and the boot inventory collector. Any future boot-time assertion of the form _"this public route must be rate-limited"_ consumes `resolvePolicy` — which asserts **enforcement**, not the presence of an inert marker, and is therefore strictly stronger than the `config.rateLimit` probe the draft planned. C3 exports it; C13 documents it; §9 records the handoff obligation by name so the other change's design phase cannot miss it.

---

### L1-C2 — The owner is untracked prose on a zero-commit branch, and its gate reaches ~3 routes → **AMEND**

**Verified.** `git log --oneline -2 workstream/principal-derived-authority` → `57374636` (main's parent) + `b724646d`; the change directory is untracked (`?? openspec/changes/principal-derived-authority/`); it has `explore.md` + `proposal.md` only. Its own §2 enrols only the plugins it rewrites. Every route this design leaves IP-keyed (`POST /api-keys`, `/api-keys/:id/rotate`, `POST /team/invite`, `/auth/mfa/*`, `/admin/auth/password/change`, both force-disables) is outside that set.

R10's `**Owner:**` line is therefore a guarantee with no backing sitting in a spec field — the exact defect class this change exists to remove, relocated into an OpenSpec artifact. Binding rule 3 applies to specs as much as to canon docs.

**Amendment.** §5 and §9 no longer name `principal-derived-authority` as the owner of per-principal keying. Per-principal keying is stated as **intent with no owning change in the tree**, and this design _specifies its shape_ so the handoff is real rather than nominal: a second, principal-keyed charge placed inside the two shared auth preHandlers (§5.4), whose precondition is an amendment to R2 admitting exactly two named layers. **Required spec amendment SA-4** (§10) carries the wording change to R10.

---

### L1-C3 — C11 cannot mitigate the cross-tenant bucket collapse → **AMEND**, with one sub-claim **REFUSED**

**What is true, and it kills C11 as written.** `apps/{admin,client}/lib/http/forwardedFor.ts` relays inbound XFF **verbatim, appending no portal hop** (stated in the file header); the client portal proxies all browser API traffic server-side. `resolveClientIp.ts:112` returns the socket at `hops <= 0`. So at the fail-closed default of `0`, every portal-borne caller resolves to the portal's address and shares one bucket. C11 as designed only forces the value to be _set_; it cannot make a wrong topology right, and it is not a mitigation.

**What I refuse.** The universal form — _"in this project's real topology no value of `TRUSTED_PROXY_HOP_COUNT` separates two tenants"_ — is false. `resolveClientIp.ts:118` returns the socket only when `entries.length < trustedHops`. With the trusted edge in front of the portal doing what `SECURITY_CANON §Topology invariant` **already mandates** (strip/overwrite inbound XFF, i.e. set it to the client), the portal's inbound XFF is `[clientIp]`, the verbatim relay forwards `[clientIp]`, `entries.length (1) < 1` is false, and `@fastify/proxy-addr` at numeric `trustProxy: 1` selects `xff[len-1]` = the client. Per-caller buckets work. The collapse is a **configuration state** (`hops = 0`, edge-less), not a structural property of the relay.

I also refuse _"stage 1 introduces it on the credential surface"_. Today's key for a portal-borne `POST /auth/customer/login` is already `${portalIp}:/auth/customer/login` — no query, no path param, nothing to shard on. That bucket is product-wide **today**. Stage 1 changes nothing there. And R1.7 has already ratified the parameterised collapse as intended.

**What genuinely survives, and is amended.** Stage 1 _does_ create the collapse on parameterised routes, where per-`:id` sharding accidentally masked it — and it _amplifies_ the credential-surface consequence by tightening caps 20–45× on a bucket that may be product-wide. Amendments: (i) C0 replaces C11 and stops claiming to mitigate anything — it makes enforcement mandatory outside tests and makes the effective hop count part of the boot report; (ii) **C5 re-sizes the non-credential expensive presets for the collapse** (permitted: R3.5's no-loosening rule is scoped to the credential surface) with the sizing visible in the generated snapshot; (iii) the credential-surface residual at `hops = 0` is named in §9 with its owner and a merge-blocking deployment precondition; (iv) §5 records that this is now the **strongest argument for stage 2** — per-principal keying is the only fix that is topology-independent.

---

### L2-BLOCKER — C9's fail-closed credential surface contradicts R6 [MERGE-BLOCKING] and R12.3 → **AMEND** (the design yields)

**Verified on both spec layers.** Delta spec R6 header: _"The limiter fails open when its backing store is unavailable"_ [MERGE-BLOCKING]; R6.1 requires the request to reach its handler; R6.4 extends it to every internal failure; R12.3 requires the posture _"has not been flipped to fail-closed"_. The ratified living spec agrees: `openspec/specs/client-ip-rate-limit/spec.md:119` (_"MUST remain fail-open with loud telemetry"_) and `:135` (_"the posture is not changed to fail-closed"_).

The design planned to amend the _living_ spec in C9. That is the wrong document and, worse, it is not the binding one: the delta spec for this change re-ratifies fail-open and marks it merge-blocking. A design cannot contradict its own merge blocker by amending a different file.

**On the merits, the design's own evidence argues against it.** §7 puts `/auth/refresh`, `/auth/customer/refresh`, `/admin/auth/refresh` on AUTH; those are credential surface. `deny` therefore converts a Redis outage into a **total authentication outage** — login _and_ session refresh, on both portals, while the rest of the system runs fine on Postgres (`authServiceCore.ts:74-75` and every `hasRedis` guard). The explore names a Redis memory-amplification vector driven by attacker input (§D1). Failing closed on a store an attacker can pressure hands them an authentication kill switch. Fail-closed also does not restore the account layer, which fails open independently (`RedisBruteForceAdapter.ts:165,179`).

**Amendment.** `onStoreFailure` is deleted from the rule type — not defaulted to `allow`, deleted. A dimension with one legal value is dead weight, and R10's corollary (do not ship a knob you cannot honour) applies by analogy. What survives from C9 is the honest, provable half: `degraded` on `RateLimitDecision`, `threat_type: "http_rate_limit_failopen"` on an HTTP-scoped logger without `key`, and the Prometheus counter. The residual (a Redis outage removes every credential control at once) is named in §9 with its owner: a durable, Postgres-backed account lockout, which is the only fix that does not trade a bypass for an outage.

---

### L2-C1 — C2 loosens `/auth/customer/login/mfa` 20×, and holds it loose for all of PR1 → **AMEND**

**Verified.** `httpRateLimitPreHandler.ts:91-93` documents it in the source: _"The MFA step-2 route `/auth/customer/login/mfa` is covered by the `/auth/customer/login` rule via `startsWith` prefix matching — do not add a separate (redundant) rule for it."_ `customerAuthRoutes.ts:526` registers it with no rate-limit config of its own. Exact matching without an explicit row drops it AUTH 5/15min → STANDARD 100/min. C2's stated outcome ("policy per pattern is provably unchanged") is false as scheduled, and the only way the equivalence test stays green is a `DELIBERATE_CHANGES` entry that _loosens_ — precisely what W4 and R3.5 forbid.

The same class, verified, on health: `healthRoutes.ts` registers `/health`, `/health/detailed`, `/health/live`, `/health/ready`, `/health/dependency/:name`; only `/health` is a rule literal. Four children fall from HEALTH 120/min to STANDARD 100/min under exact matching.

**Amendment.** C2 carries **preservation rows** for every pattern whose current policy comes from prefix inheritance — `/auth/customer/login/mfa`, the four `/health/*` children, and `/r/:shortCode` (REDIRECT, which also removes the transient header incoherence the same reviewer flagged as a SUGGESTION). The equivalence test's deliberate-change list is **constrained to tightenings only**; a loosening entry fails the test by construction, not by review.

---

### L2-C2 / L3-C2 — C5/C6 make live protections conditional on `ENABLE_RATE_LIMITING` three PRs before C11 → **AMEND**

**Verified.** M1 is inside `if (env.ENABLE_RATE_LIMITING)` (`index.ts:430`). M2 (`linkRoutes.ts:295`) and M3 (`adminAuthRoutes.ts:563,580,590`) are route-level preHandlers and run unconditionally. `scripts/ci-setup-test-env.sh:37` writes `ENABLE_RATE_LIMITING=false` for every job; the only re-enable is the push-only API boot at `ci.yml:339`. So deleting M2/M3 before the flag invariant exists converts "protected everywhere" into "protected where a boolean happens to be true". `ADMIN_CUSTOMER_PARITY.md:400` raised exactly this.

**Amendment, stronger than the reviewers asked for.** The old C11 becomes **C0 and lands first**, and its rule is narrowed from "production requires the flag" to: **`ENABLE_RATE_LIMITING=false` is legal only when `NODE_ENV === "test"`; every other configuration fails to boot.** That closes the hole in staging, in a developer's environment, and in an operator's hands — not only in production — and it answers F5 with a real answer instead of a preference. C0 also emits the boot report R9 requires. No deletion commit precedes it.

---

### L2-C3 — R7 [MERGE-BLOCKING] and R8.5 have no commit → **AMEND**

**Verified.** The design's commit table assigns R7 to nothing; §8 mentions it advisorily and closes _"or do not claim it"_ — not an option for a merge blocker. R8.5 is likewise unaddressed: `LOGIN_ATTEMPTS_PREFIX` appears twice repo-wide (`redisSessionHelpers.ts:14` declaration, `:122` writer), written from `authServiceCore.ts:156,297`, with **zero readers** — a record written under a docstring claiming _"auditing and rate limiting"_ that can deny nothing. C14 deletes a route, not the writer.

Compounding, verified: `apps/api/tests/unit/authRateLimit.test.ts:145-156` registers `@fastify/rate-limit` and then the **real** `authRoutes` plugin, so it is today the only _executing_ test that drives a real 429 on a credential route — and C9 deletes it.

**Amendment.** Two commits added: **C4** (the end-to-end enforcement proof, landing _before_ any deletion, against the AUTH cap that already exists) and **C12** (delete the write-only attempt record and its writer calls; add the account-layer enumeration test R8.5 demands).

---

### L2-C4 — R8.1's only remedy is a conditional commit → **AMEND**, and the fork is closed

**Verified, and the evidence is stronger than either document knew.** `/auth/login` authenticates the same `adminUser` rows as `/admin/auth/login` (`authServiceCore.ts:19,58,165` → `setupServices.ts:209`) with no account-keyed gate, while `AdminAuthService.ts:67` gates the other door. R8.1 is a MUST. C14 was marked _"(conditional, own review)"_ and _"the design does not depend on it"_ — so the design's endorsed path to a MUST was optional.

I closed the fork with two verifications the design did not have:

1. **The sweep is done and the door is cold.** `rg --fixed-strings "security.login" apps/admin apps/client` → **zero hits**. The only `/auth/login` occurrences in the portals are the Next **page** route (`apps/admin/app/[locale]/(auth)/login/page.tsx`, e2e specs asserting `page.url()`), not the backend endpoint. Deletion costs `authRoutes.ts:330-340` + `authClient.login` + the `apiClient.security.login` re-export + a test tail.
2. **The proposal's fallback option (a) is not merely inferior — it is broken.** `oidcRoutes.ts:410` and `samlRoutes.ts:333` call `authService.login({ email, password: "__oidc_sso__" | "__saml_sso__" }, …)` and provision on failure. Injecting `BruteForceProtectionPort` into `AuthServiceCore` would record **one failed password attempt per SSO login**, locking out every SSO user after five. Service-level gating is off the table on evidence, not on taste.

**Amendment.** C12 is unconditional and merge-blocking for R8.1. `AuthServiceCore.login` survives (SSO depends on it); only the HTTP door and its dead client die. C12 additionally carries the enumeration test that names every remaining credential-verifying endpoint and asserts each is account-gated.

_Correction to the design, mine not a reviewer's:_ §5 calls `POST /admin/auth/password/validate` _"the password oracle"_ and uses it as one of three pillars of the all-CRITICALs-are-pre-auth argument. It is not an oracle: `adminAuthRoutes.ts:597` → `handler.validatePassword` → `AdminAuthService.ts:340` → `PasswordService.ts:49` → `validatePasswordStrength` — a pure strength function that verifies nothing against a stored credential. It stays on the credential surface (it accepts a plaintext password unauthenticated) and keeps STRICT, but it is struck from the pre-auth CRITICAL argument, which stands on the other two pillars.

---

### L3-C1 — The credential predicate misses at least 8 registered credential routes → **AMEND**

**Verified, every one.** `zapierRoutes.ts:102/123/155` (`GET|POST /zapier/keys`, `DELETE /zapier/keys/:id`), `makeRoutes.ts:105/128/160` (same shape), `adminUserRoutes.ts:497` (`/admin/users/:id/password-reset`), `accountLifecycleRoutes.ts:763` (`/admin/accounts/:accountId/reset-password`), `:793` (`/admin/accounts/:accountId/revoke-sessions`), `oidcAdminRoutes.ts:95` (`/admin/oidc/configurations/:accountId/replace-client-secret`). API-key issuance and invitation issuance are inside the specs' own definition of the credential surface. §3.3 framed the predicate risk as a hypothetical future `/session/renew`; it is a present miss, and a gate that ships green while its own R3.1 is false is the baseline-nobody-measured failure.

**Amendment, structural rather than a longer list.** Two moves: (i) the classifier is broadened now to cover every verified miss; (ii) **the gate stops using the classifier as its scope selector**. See L3-C5.

---

### L3-C3 — Fitness #34's baseline is 10 sites, not 3 → **AMEND**

**Measured.** `rg "request\.ip"` over `apps/api/src/{auth,admin/auth,security}` minus `resolveClientIp.ts` returns **10**: `admin/auth/adminAuthMiddleware.ts:145`, `admin/auth/adminAuthRoutes.ts:69`, `auth/oidcRoutes.ts:413`, `auth/samlRoutes.ts:335`, `auth/rbacMiddleware.ts:241`, `auth/authRoutes.ts:61`, `auth/authRoutes.ts:156`, `auth/mfaRoutes.ts:351`, `auth/mfaRoutes.ts:420`, `security/securityHeaders.ts:341`. C11's claim ("three sites, all fixed in this commit — #34 lands green") is false; the commit as scoped lands a red CI, and narrowing the check to its own three lines would make it ceremony.

Two of the unlisted sites are load-bearing: `oidcRoutes.ts:413` and `samlRoutes.ts:335` feed raw `request.ip` into the same `authService.login(credentials, ipAddress, userAgent)` signature the commit fixes at `authRoutes.ts:61/156`. `rbacMiddleware.ts:241` is inside `auditMiddleware`, not inside the deleted `roleBasedRateLimit`, so C8 does not remove it — and R13.2 names auditing explicitly.

**Amendment.** The renumbered C11 fixes all ten and lands #34 green over the full measured baseline.

---

### L3-C4 — R7 [MERGE-BLOCKING] structurally cannot execute on a pull request → **AMEND**

**Verified.** `ci.yml:328` — `Start API in background` is `if: github.event_name == 'push'`; `run-tests.sh:59-61` — `run_live_api_batches()` requires `TIER` empty or `full-integration`. A merge blocker that first runs after the merge is incoherent.

**Amendment.** R7 is proven in **two tiers**:

- **PR tier (the merge blocker).** A `node:test` integration suite that boots the composed application through `createApp()` against the real Redis and Postgres services the PR-tier job already provides (`run_integration_batches` admits `pr-integration`), and drives the burst through `app.inject()` — the complete Fastify lifecycle, the real store, the real composition root, only the socket elided (`inject` supplies `remoteAddress`). It consults the C0 boot report and **fails** when enforcement is inactive (R7.3). The job gets `ENABLE_RATE_LIMITING: "true"` the way `ci.yml:339` already does for the API boot.
- **Full tier.** The live-socket burst against `http://localhost:3000`, hand-added to a named `run-tests.sh` batch (R7.4), covering the one thing `inject` cannot: the socket path and `trustProxy` resolution.

---

### L3-C5 — R3.3 is false of the mechanism the design chose → **AMEND**

**Verified in the design's own words.** The route _inventory_ is derived from `onRoute`; the _scope selector_ is a hand-written predicate, and narrowing it directly reduces what the check evaluates — exactly what R3.3 forbids. §3.3 concedes it as "the residual drift" while R3.3 asserts the opposite as a property.

**Amendment — the gate stops having a scope selector.** The policy table loses its implicit fall-through: **every registered route must resolve to an explicitly declared policy**, or the boot fails. Non-credential surfaces are covered by explicitly declared prefix _families_ (~45 top-level segments over 435 registered patterns — measured), bootstrapped once from the boot inventory so the resolved policy is unchanged. The classifier survives only as a **severity** assertion ("this pattern must be stricter than the general default"), never as a scope filter. Consequences:

- R3.3 becomes true as written for the inventory: removing a row from the table makes the boot **fail**, it does not shrink what is evaluated.
- R3.2 is satisfied by the strongest layer: any new route with no explicit allowance fails the boot.
- The classifier residual degrades from _"a credential route silently inherits 100/min, invisible"_ to _"a credential route carries an explicitly declared STANDARD, printed as a new line in a generated snapshot diff"_. That residual is stated as intent in §9 with its compensating control, per binding rule 3, and **SA-3** carries the spec wording.

---

**Does anything kill the stage-1/stage-2 split?** No. Two lenses affirm it; the third does not contest it. What dies is the _owner statement_ (L1-C2), the _rationale_ ("sixth mechanism" — replaced by the three reasons that carry it), and the _claim of impossibility scope_ (impossible **at the perimeter**, not system-wide — L1-W). The split itself is load-bearing and survives on the reason the design under-sold: every CRITICAL in this change is pre-auth, where no principal exists by definition.

---

# `auth-rate-limit-integrity` — AMENDED DESIGN

**Mode:** read-only. Verified against `workstream/auth-rate-limit-integrity` (= main `8e89b21f`) and `node_modules/.pnpm/fastify@5.10.0`.

---

## 0 · Verification first: findings that change the design

### N1 — The rule table is fiction in the direction nobody looked

The explore found two **shadowed** rows (`:66`, `:76`). The other direction — rules whose `path` prefix matches **no registered route pattern**:

| Rule              | Path                                      | What actually exists                                                         |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `:58`             | `/analytics/roi/calculate`                | `/analytics/roi` (`analyticsRoutes.ts:1116`)                                 |
| `:59`             | `/analytics/engagement/predictions`       | `/engagement/trends` (`:1053`), `/trends/predictions` (`trendRoutes.ts:388`) |
| `:62 :63 :64 :80` | `/ml/*` ×4                                | **no `/ml` route exists**                                                    |
| `:65`             | `/posts/search`                           | no such route                                                                |
| `:67`             | `/analytics/realtime/dashboard`           | `/admin/rate-limiting/realtime` (`rateLimitingDashboard.ts:148`)             |
| `:68`             | `/analytics/geo/heatmap`                  | `/engagement/geographic` (`analyticsRoutes.ts:1073`)                         |
| `:70`             | `/analytics/threads/`                     | registered **without** the `/analytics` prefix                               |
| `:75`             | `/webhooks/events/search`                 | `/webhooks/dashboard/events`                                                 |
| `:77 :78`         | `/analytics/post/`, `/analytics/channel/` | no such routes                                                               |
| `:79`             | `/admin/dashboard/metrics`                | `/webhooks/dashboard/metrics`                                                |
| `:81`             | `/webhooks/logs`                          | `/webhooks/dashboard/*` only                                                 |
| `:82`             | `/audit/logs/search`                      | `/admin/audit/logs`                                                          |
| `:104`            | `/publish/` (STRICT 10/min)               | no `/publish/*` route                                                        |
| `:105`            | `/media/` (UPLOAD 20/5min)                | no `/media/*` route                                                          |

**17 of 23 expensive rows and 2 of 7 standard rows bind to nothing.** The drift is **bidirectional**: routes with no rule (D2/D4) _and_ rules with no route.

### N2 — Redis down removes every credential control at once

`RedisTokenBucketRateLimiter.tryConsume` swallows all Redis errors and returns `{allowed:true}` (`:123-127`). `RedisBruteForceAdapter` fails open identically (`:165`, `:179`). `AuthServiceCore` keeps working without Redis (`:74-75, 155, 235, 296, 387`). A Redis outage yields unlimited credential guessing against a fully functional login, with no signal but a `warn` bound to `module:"ai"`. This decides §6 — in the direction of loud fail-open, not fail-closed (see §6 AMENDED).

### N3 — Two request classes never reach the limiter, today and after

- **OPTIONS preflight.** `@fastify/cors@11.1.0` defaults `hook:'onRequest'` / `preflightContinue:false` (`index.js:12-13`, replies at `:201-208`), so `preHandler` never runs.
- **Malformed URLs.** `four-oh-four.js:36-38` wires `onBadUrl`/`onMaxParamLength` to a handler invoked **without the lifecycle** (`:64-73`). `GET /%` is unlimited.

Neither is a regression. Both are named gaps in §9.

### N4 — Fitness-number collision

`principal-derived-authority/proposal.md` already claims #30, #31, #31b, #32 in un-landed prose. Highest live number is #29 (`fitness.yml:596`). This design uses **#33** (inert declaration), **#34** (raw `request.ip`), **#35** (in-process limiter binding). Rule adopted: _a fitness number is allocated when the check lands in `.github/workflows/fitness.yml` on `main`, not when a proposal names it._

### N5 — **AMENDED AT GATE** — the credential classifier's baseline was never measured _(drove: L3-C1)_

Verified registered credential-surface routes that the design's predicate (`/auth`, `/admin/auth`, `/api-keys`, `/team/invite`, `/mfa`) does **not** match:

`zapierRoutes.ts:102,123,155` · `makeRoutes.ts:105,128,160` · `adminUserRoutes.ts:497` · `accountLifecycleRoutes.ts:763,793` · `oidcAdminRoutes.ts:95`.

Ten routes, five of them key/credential **issuance**. This is why §3 no longer uses the classifier as a scope selector.

### N6 — **AMENDED AT GATE** — `/admin/auth/password/validate` is not an oracle _(my own correction)_

`adminAuthRoutes.ts:597` → `AdminAuthService.ts:340` → `PasswordService.ts:49` → `validatePasswordStrength` — a pure strength function. It verifies nothing against a stored credential. It keeps STRICT (it accepts a plaintext password unauthenticated) but is struck from the pre-auth CRITICAL argument in §5 and from R8.1's scope.

### N7 — **AMENDED AT GATE** — SSO logs in through `AuthServiceCore.login` with a sentinel password _(drove: L2-C4)_

`oidcRoutes.ts:410` and `samlRoutes.ts:333` call `authService.login({ email, password: "__oidc_sso__" | "__saml_sso__" }, request.ip, …)` and provision on failure. Two consequences: `AuthServiceCore.login` survives C12's route deletion, and **injecting `BruteForceProtectionPort` into `AuthServiceCore` would lock out every SSO user after five SSO logins**. Proposal option (a) for F1 is dead on evidence.

### N8 — **AMENDED AT GATE** — the caller-IP topology is a configuration state, not a structural collapse _(drove: L1-C3)_

`forwardedFor.ts` relays inbound XFF verbatim with **no portal hop appended**; `resolveClientIp.ts:112` returns the socket at `hops <= 0`, `:118` at a short chain. Therefore:

- **Edge-less (homelab, `hops = 0`):** every portal-borne caller shares one bucket. True today for every parameterless route — `POST /auth/customer/login` is already one product-wide bucket at `${portalIp}:/auth/customer/login`.
- **Edge in front of the portal (the topology `SECURITY_CANON §Topology invariant` already mandates), `hops = 1`:** inbound XFF is `[clientIp]`, `entries.length (1) < 1` is false, proxy-addr selects `xff[len-1]` — the real client. Per-caller buckets work through the verbatim relay unchanged.

What stage 1 genuinely changes is the **parameterised** surface, where per-`:id` sharding masked the collapse. §4 and C5 size for it; §9 names the residual.

---

## 1 · The single key derivation

### 1.1 The property, verified against Fastify's source

| Step                       | Source                              | Result                                                         |
| -------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `request.routeOptions.url` | `fastify/lib/request.js:183, 190`   | returns `context.config?.url`                                  |
| `context.config`           | `fastify/lib/route.js:329-333`      | `{ ...opts.config, url, method: opts.method }`                 |
| `url`                      | `fastify/lib/route.js:276-279`      | `prefix + path` — the full registered pattern                  |
| `onRoute` payload          | `fastify/lib/route.js:278, 293-297` | hooks receive the same `opts` **after** `opts.url` is assigned |

The third row is load-bearing for §3: the string a boot-time `onRoute` collector sees is **byte-identical** to the string the runtime key uses. Query strings and path parameters are absent by construction — `config.url` is built from the registration literal, never from `raw.url`.

### 1.2 The shape

```ts
const UNROUTED = "!unrouted";

function bucketKey(req: FastifyRequest): string {
  const ip = resolveClientIp(req); // untouched, (A)-grade
  const pattern = req.routeOptions.url; // === context.config?.url
  if (pattern === undefined) return `${ip}:${UNROUTED}`;
  const method = req.method === "HEAD" ? "GET" : req.method;
  return `${ip}:${method}:${pattern}`;
}
```

Read `routeOptions` **once** into a local: the getter allocates a fresh 13-field object per access (`request.js:182-203`).

### 1.3 Edge cases

**404 / no route matched.** `fastify.js:435` calls `setNotFoundHandler()` unconditionally; `four-oh-four.js:136` creates that context with `config: opts.config || {}` (no `url`), and `:145-150` copies instance hooks onto it at `preReady` — so instance `preHandler` hooks **do** run on 404s and the `undefined` branch is live code.

I disagree with the proposal's framing that `ip:GET:undefined` is _"one global bucket, a self-inflicted DoS"_ — the key still carries the IP, so it is one bucket per IP. The real defects are an unnamed magic value that cannot carry a policy, and the method component multiplying the scan budget by the method space. Both are fixed above.

**The fallback must be a constant.** `req.url` would be catastrophic (404s are the cheapest thing to vary). `UNROUTED = "!unrouted"` cannot collide: every pattern is `prefix + path` and begins with `/`.

**No method on the UNROUTED key.** The method is the only attacker-selectable component left there (llhttp admits ~34 token methods); multiplying a scan budget by 34 defeats the bucket's purpose.

**Plugin prefixes.** `routeOptions.url` is post-prefix. Only `aiRoutes` uses one (`index.ts:532`), so `/ai/generate` keys and matches as `/ai/generate`.

**Wildcards.** `@fastify/cors` registers `options('*')` (`index.js:79`). It never reaches the limiter (N3); the policy audit excludes it with that citation.

**HEAD.** `exposeHeadRoute` defaults true; `route.js:449-452` re-enters `prepareRoute` with `method:'HEAD'`, same pattern, same handler, full cost.

**OPTIONS.** Never arrives (N3).

### 1.4 Does the METHOD belong in the key? — Yes, with HEAD folded into GET · **AMENDED AT GATE** _(drove: L2-W HEAD vs R1.4)_

**For.** `apiKeyRoutes.ts:270` `GET /api-keys` and `:278` `POST /api-keys` share one bucket today; listing keys is the volume operation, minting one is the credential operation. Same collision at `accountLifecycleRoutes.ts:673/683`.

**Against.** A raw method component hands an attacker a free second bucket on every GET route via the auto-exposed HEAD twin.

**Resolution: fold `HEAD → GET`.** One line, both properties held; Fastify's own semantics agree.

**Amendment.** R1.4's Given ("a route pattern registered for more than one HTTP method") is satisfied by GET+HEAD on every GET route under `exposeHeadRoute`, so a test author picking GET/HEAD would write a test this design deliberately fails. **SA-1** (§10) carries the HEAD-twin carve-out into R1.4 with its rationale. The unit suite asserts both halves explicitly: `GET ≠ POST` and `GET == HEAD`.

---

## 2 · Collapsing five mechanisms into one, without a window · **AMENDED AT GATE**

_(Changed: every disposition now carries a conditionality precondition — C0 must land first — because M2/M3 are unconditional and M1 is flag-gated. Drove: L2-C2, L3-C2.)_

| #                                                                                                                    | Disposition                                              | What must be true **before** it is removed                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** `createHttpRateLimitPreHandler` `:190`                                                                        | **Kept, redone** — key (§1), matching (§4), posture (§6) | —                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **M2** `createNamespacedRateLimitPreHandler` `:155-188`, wired `linkRoutes.ts:294-305`                               | **Deleted**                                              | **C0 has landed** (enforcement can no longer be off outside `NODE_ENV=test`). C1 already gives `/r/:shortCode` one bucket per IP across all shortCodes — M2's entire stated purpose (`linkRoutes.ts:287-293`). C2 lands the `REDIRECT` row so the _policy_ survives the deletion; between C2 and C6 both charge — stronger, never weaker. C6's test asserts two distinct shortCodes yield one key.                                           |
| **M3** `rateLimit()` `adminAuthMiddleware.ts:222-251`, attached `adminAuthRoutes.ts:563, 580, 590`                   | **Deleted**                                              | **C0 has landed.** C5 lands rows for the three patterns at ≥ M3's strictness, compared **as rates**: login 15/60 s = 0.250/s vs AUTH 5/900 s = 0.0056/s (**45× stricter**); reset 3/300 s vs `RECOVERY_REQUEST` 3/300 s (**equal**); reset/confirm 5/900 s vs AUTH 5/900 s (**equal**). M3's namespace is `admin:` so buckets are disjoint — both charge during C5→C7.                                                                       |
| **M4** seven `config:{rateLimit}` blocks (`authRoutes.ts:334, 346, 358`; `customerAuthRoutes.ts:501, 553, 568, 580`) | **Deleted**, intent absorbed into rows first (C5)        | Nothing consumes them in production: `@fastify/rate-limit` is registered **only** in `tests/unit/authRateLimit.test.ts:145`. **The deletion is atomic and must stay atomic** — that test registers the real `authRoutes` plugin and its 429 assertions (`:368`, `:405`) depend on these blocks, so blocks + test + dependency + `package.json:23` `test:ratelimit` + fitness #33 land in **one** commit or CI goes red for the wrong reason. |
| **M5** `roleBasedRateLimit()` `rbacMiddleware.ts:201-222`                                                            | **Deleted**                                              | Zero production call sites (re-verified: source + its own unit test + a stryker artifact). Note `rbacMiddleware.ts:241` is a **different** function (`auditMiddleware`) and is _not_ removed here — it is fixed in C11.                                                                                                                                                                                                                      |

### The header contract — **AMENDED AT GATE** _(drove: L2-W header sweep)_

M5 (`rbacMiddleware.ts:217-219`) is the repo's only writer of `X-RateLimit-Limit` **and** `X-RateLimit-Window`; the limiter sets only `Remaining` and `Reset` (`:204-205`).

**The emitted set is fixed at:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, plus `Retry-After` on 429. `Limit` is emitted from M1 in **C2** — before C8 deletes its current writer — because the value (`config.maxRequests`) is already in hand at the line where the other two are written, and `Remaining` without `Limit` is uninterpretable.

`X-RateLimit-Window` is **not** emitted and is deleted from the documentation. Verified documented sets, all of which C13 normalises: `docs/architecture/API.md:669-672` (four headers, including `Window`), `docs/api/README.md:383-385` (three), `docs/security/AUTH.md:324-326` (three), `docs/security/OVERVIEW.md:131` (two + `Retry-After`), `docs/architecture/SECURITY.md:207` (_"Per-IP + per-URL bucket"_ — false after C1, and absent from the design's original W8 list). No live consumer breaks: `performance/k6/utils/assertions.js:72-88` has no caller and `tests/integration/security-endpoints.test.ts:151-154` computes a check then asserts `assert.ok(true)`.

---

## 3 · The coverage gate — the structural close · **AMENDED AT GATE**

_(Changed: the credential predicate is no longer the scope selector; the gate covers every registered route; the CI step is dedicated rather than piggy-backed; the boot audit throws on facts and logs on judgments. Drove: L3-C1, L3-C5, L3-W-CI-coupling, L2-W-boot-throw.)_

### 3.1 Options weighed

| Option                                                     | Catches                                   | Fails on                                                                           |
| ---------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| (a) Fitness grep                                           | Syntax no runtime consumes                | Blind to the route table as a value                                                |
| (b) Startup assertion                                      | Everything, against the real composed app | Late for a PR; a false positive is a production outage                             |
| (c) Typed route-registration wrapper                       | Everything, at compile time               | Touches every registration (`requireClientAuth` alone: 351 occurrences). Ruled out |
| (d) Exhaustive test over a re-registered route table (T10) | The plugins the test names                | Its plugin list is itself hand-maintained — the same drift class one level up      |

### 3.2 The pick: full-inventory coverage, generated, on rails that already exist

**The general default stops existing as an implicit fall-through.** `resolvePolicy(pattern, method)` returns `RateLimitConfig | undefined`; **`undefined` for a registered route is a boot failure**. Non-credential surfaces are covered by _explicitly declared_ prefix families (45 top-level segments over 435 registered patterns — measured), bootstrapped once in C3 from the boot inventory so the resolved policy does not move. The preHandler retains STANDARD as a runtime safety net for the unreachable case and emits `unclassified_route` telemetry when it fires.

**Four layers, each doing a job no other can:**

1. **Boot-time audit — throws on facts, logs on judgments.** An `onRoute` collector installs immediately after `withTypeProvider` (`index.ts:198`), before any `register`, so it sees 100% of routes (verified ordering constraint: `onRoute` is not propagated to _existing_ children and is not deferred through `after` — `fastify.js:598-600` vs `:611-615`; children created after the hook inherit it). After the last registration, `auditPolicy(collected, POLICY)` runs.
   - **Throws** (structural, no false positive possible): a registered route with no explicit policy; a rule binding zero registered patterns; a duplicate exact pattern+method.
   - **Structured ERROR, no throw** (classifier-dependent, hand-maintained input): a credential-classified pattern that is not stricter than the general default; a prefix family covering a credential-classified pattern. These fail in CI (layer 3), where a false positive costs a red build, not an outage. This resolves the design's own §3.1 objection to option (b) instead of walking past it.
2. **Generated snapshot — the review artifact.** `apps/api/scripts/dump-rate-limit-policy.ts` boots the same app and writes a deterministic, sorted artifact: `METHOD · pattern · preset · max/window · classification`, plus the `UNROUTED` line. **Committed.** Its CI step is **its own step** — not appended to the OpenAPI drift gate — because a gate that rides on another gate's `if:` condition disappears silently when that condition moves (verified: `ci.yml:150-176`, `if: matrix.shard == 1`, whose stated purpose is OpenAPI drift). The step sets `ENABLE_RATE_LIMITING=true` explicitly rather than relying on `.env.test.example` omitting the key (verified: it does omit it, and `config/env.ts:241` defaults true — an accident the gate must not depend on).
3. **Unit-tier coverage test — reads the committed snapshot, boots nothing.** `tests/unit/security/rateLimitCoverage.test.ts` asserts over the full generated inventory: every credential-classified pattern resolves stricter than the general default; no prefix family covers one; the admin↔customer parity table (R3.4); the documented-figure table (R11). Freshness of the snapshot is guaranteed by layer 2's drift gate and layer 1's boot audit — so the inventory is **derived, never transcribed**, and R3.3 holds: removing a row from the policy table makes the boot fail, it does not shrink what is evaluated.
4. **Fitness #33** — the biconditional (`config:{rateLimit}` count is 0 **unless** `@fastify/rate-limit` is registered in `apps/api/src`, plus the dep absent from `apps/api/package.json`). Total over the tree — the one thing a runtime gate structurally cannot see. **Its regex anchors on `\brateLimit\s*:\s*\{` with a path exclusion list, not on `config:\s*\{\s*rateLimit`**: verified, the tight form requires `rateLimit` to be the _first_ key in the object literal and is defeated by `config: { description: "…", rateLimit: {…} }`. Measured baselines: tight form = 7 (the seven blocks); loose form = 12, the extra 5 being unrelated config objects at `adminAuthTypes.ts:484`, `adminAuthConfig.ts:49`, `ai/orchestrator.ts:122,141,159` — excluded by path.
5. **Fitness #35** — **AMENDED AT GATE** _(drove: L3-W R2.3)_: no in-process limiter (`InMemoryTokenBucketRateLimiter`, `@fastify/rate-limit`, or an equivalent) is bound to `TOKENS.HttpRateLimiter` outside tests. R2.3 ("no allowance private to a single instance") otherwise has no backing check, which binding rule 3 forbids.

**The interface this change publishes.** `rateLimitPolicy.ts` exports `resolvePolicy(pattern, method)` and the inventory collector. Any future boot-time assertion of the form _"this public route must be rate-limited"_ — including the one `principal-derived-authority` currently plans against `config.rateLimit` — consumes `resolvePolicy`. That asserts enforcement rather than the presence of an inert marker, and it does not trip fitness #33.

### 3.3 What the gate CANNOT catch

- **That the number is right.** No mechanism decides policy; the snapshot diff puts it in front of a human.
- **That a credential route was classified.** The classifier is hand-maintained; a credential route it misses now carries an _explicitly declared_ STANDARD and appears as a line in the snapshot diff, rather than silently inheriting 100/min. Stated as intent in §9, with the diff as the compensating control, per binding rule 3.
- **The two bypass classes of N3** — OPTIONS preflight and malformed URLs never reach the limiter.
- **Anything about the response.** The gate proves a bucket is charged; R7's end-to-end proof (C4) proves the 429.
- **The Next.js portal surface** — **AMENDED AT GATE** _(drove: L3-S portal blind spot)_: `apps/admin/app/api/auth/refresh/route.ts` is a credential endpoint the Fastify collector structurally cannot see, and the `[...path]` proxies are unlimited amplification paths into the backend credential surface. Named in §9 with an owner.

---

## 4 · The rule table's shape · **AMENDED AT GATE**

_(Changed: `undefined` replaces the implicit default; `onStoreFailure` is deleted; families are explicit; expensive presets are re-sized for the collapse. Drove: L3-C5, L2-BLOCKER, L1-C3.)_

```ts
type RuleKind =
  | { readonly kind: "exact"; readonly pattern: string; readonly methods?: readonly string[] }
  | { readonly kind: "family"; readonly prefix: string }; // explicitly declared, never implicit

interface RateLimitRule {
  readonly match: RuleKind;
  readonly preset: RateLimitConfig;
}
```

- Exact is the default and the **only** kind permitted to cover a credential-classified pattern (layer 3).
- `contains` (`:27-29`) is deleted.
- First-match-wins ordering disappears for exact rows (duplicates are a boot failure). Ordering survives among families, where it is explicit.
- **No implicit fall-through.** `resolvePolicy` returns `undefined` when nothing matches; the boot audit throws.

Exact matching converts a rule from _a guess that silently produces a wrong answer_ into _a falsifiable claim about the route table_, which is what makes "every rule binds ≥1 registered pattern" decidable. Full-inventory coverage is what closes the drift; the matching mode buys decidability, the gate buys closure. Claiming otherwise would be a guarantee without backing.

**Presets.** Keep `STANDARD`, `HEALTH`, `STRICT`, `AUTH`, `REDIRECT`. Add `REGISTRATION` 10/h, `RECOVERY_REQUEST` 3/5 min, `SENSITIVE_AUTHED` 20/15 min, `UNROUTED` **30/min** (generous for incidental 404s, capping path-scanning at ~43 k/day/IP). `UPLOAD` loses its only row when dead `/media/` goes — **delete any preset with no row**.

**Expensive presets are re-sized for the bucket collapse.** `CRITICAL_EXPENSIVE`, `HEAVY_EXPENSIVE`, `MODERATE_EXPENSIVE` were sized against a per-resource-instance bucket; after C1 they are per-pattern, and at `hops = 0` per-product. C5 re-sizes them to their per-pattern equivalent, with the multiplier and its basis (the C5 sweep's observed worst-case distinct-id count per window) recorded in the snapshot and in the commit message. This is permitted: R3.5's no-loosening rule is scoped to the **credential surface**, and no credential route is re-sized upward.

**Families justified today:** `/health` (5 patterns), `/admin/accounts/` (~10 patterns, minus the two credential routes at `accountLifecycleRoutes.ts:763,793`, which take exact rows), plus the bootstrapped non-credential surfaces. Families are opt-in, named, forbidden over credential-classified patterns, and still subject to "must bind ≥1 pattern".

---

## 5 · Adjudicating the stage-1 / stage-2 split · **AMENDED AT GATE**

_(Changed: the rationale is replaced, the owner is withdrawn, and the impossibility is scoped to the perimeter. Drove: L1-C1, L1-C2, L1-W×2.)_

**Verdict: the split stands. Per-principal keying does not land here.**

### 5.1 The reason that carries it

**Every CRITICAL in this change is on the pre-auth surface, where a principal does not exist by definition.** `POST /auth/login` (`authRoutes.ts:330`, no auth preHandler); customer register / request-password-reset / reset-password (`customerAuthRoutes.ts:497, 561, 576`). Per-principal keying buys **nothing** for any of them. Stage 2 is orthogonal to this change's severity, not a deferred part of it.

_(Struck at gate: `POST /admin/auth/password/validate` is not a credential verifier — N6. The argument stands on the routes above.)_

Two supporting reasons, in order:

2. **Folding it in requires amending R2 mid-change.** R2 is MERGE-BLOCKING and forbids any request being _"evaluated against two independent allowances"_. A principal-keyed charge on top of the perimeter charge is exactly two. A merge blocker is not amended as a side effect of an implementation choice.
3. **The numbers do not exist.** Per-principal capacities are not the per-IP capacities re-labelled; nobody has decided them.

**Retired at gate: the "sixth mechanism" argument.** It is inaccurate and was the weakest reason available. What made M1–M5 a defect was five _authorities_ — five key derivations, four policy sources, three 429 shapes. A post-auth charge that resolves the same `TOKENS.HttpRateLimiter` singleton and the same policy module keyed by the same `routeOptions.url` would be one mechanism invoked at a second lifecycle point. R8 already blesses that relationship for the account layer. The argument could not carry the fork and is withdrawn.

### 5.2 The impossibility is real **at the perimeter**, and only there

`route.js:389-393`: `context[hook] = this[kHooks][hook].concat(opts[hook] || []).map(h => h.bind(this))`. Instance hooks are always concatenated ahead of route hooks in the same phase, and `requireClientAuth` is a route-level `preHandler` (351 occurrences in `apps/api/src`). No lifecycle phase exists between "route preHandler" and "handler" that an instance hook can occupy.

**Correction at gate:** the design previously generalised this to "per-principal keying is impossible". It is impossible _at the perimeter_. A cheaper path exists and must be stated honestly, because R10.1 forbids the declaration on the ground that it _"could not be honoured"_: `requireClientAuth` is a **single** function (`customerAuthMiddleware.ts:40`, principal materialised at `:59-70`) reached from 351 sites, and `requireAdminAuth` a single function reached from 179. Both run with the verified principal _and_ full `FastifyRequest` in hand — so `routeOptions.url` and `request.method` are available at the same instant `payload.accountId` is. A principal charge placed inside those two functions covers every authenticated route in the app from **two files**, with no authority declaration and no enrolment list. It is not impossible; it is out of scope for reasons 5.1(1)–(3). **SA-2** (§10) scopes R10.1's justification to the perimeter declaration surface.

### 5.3 What is left exposed, exactly

Every **authenticated** route stays IP-keyed. Two faces:

1. **Availability (shared bucket).** At `hops = 0` behind an uncounted edge, every portal-borne caller collapses into one bucket. Per N8 this is a configuration state, not a structural property, and it is **not created here** for parameterless routes (they already share one bucket today). It _is_ created for parameterised routes, where per-`:id` sharding masked it — mitigated by the C5 re-sizing (§4) and named in §9. A shared bucket is stricter, never looser: an availability risk, never a bypass.
2. **Rate multiplication by a legitimate principal.** An authenticated abuser with an IP pool multiplies their budget on `POST /api-keys`, `/api-keys/:id/rotate`, `POST /team/invite`, `/auth/mfa/*`, `/admin/auth/password/change`, both force-disables. They already hold a valid session and the sensitive ones carry MFA / current-password checks — a resource-abuse class, not a privilege boundary.

**And stage 1 strictly tightens every one of those routes.** Verified: `apiKeyRoutes.ts:286`, `mfaRoutes.ts:503-504`, `:513-514` and `teamRoutes.ts:287` carry caller-supplied path params and match no rule today, so each victim id mints its own STANDARD 100/min bucket via `${ip}:${req.url}`; after C1+C5 all ids share one `SENSITIVE_AUTHED` 20/15 min bucket. **The residual after stage 1 is smaller than the residual before it** — which is the fact that makes accepting the gap defensible, and it belongs in the spec (**SA-5**).

### 5.4 The owner — withdrawn and respecified

**`principal-derived-authority` is not the owner.** Verified: zero commits, untracked, and its own §2 enrols only the plugins it rewrites — none of which contains a route left exposed here. Naming it would be a guarantee with no backing in a spec's Owner field.

Per-principal keying is **intent, with no owning change in the tree today**. Its shape is specified here so the handoff is real: a second, principal-keyed charge inside `requireClientAuth` and `requireAdminAuth` (§5.2), consuming the same policy module and store, whose **precondition is an amendment to R2** admitting exactly two named layers, and whose second precondition is a decided set of per-principal capacities. `SECURITY_CANON §Rate Limiting`'s sentence _"Prefer an authenticated principal over IP when one exists"_ is reworded in C13 as intent naming that shape — leaving it standing while shipping stage 1 would be this change's own defect relocated into a canon document.

### 5.5 F1 — the login door: deleted, unconditionally

The proposal framed `/auth/login` as a redundant door lacking defense-in-depth. It is worse than that: it authenticates the **same** `adminUser` rows as `/admin/auth/login` (`authServiceCore.ts:19,58,165`; `setupServices.ts:209`) with **no** account-keyed counter, while `AdminAuthService.ts:67` gates the other door — **an active bypass of an enforced account-lockout control.**

Two gate verifications close the fork:

- **The caller sweep is done.** `rg --fixed-strings "security.login" apps/{admin,client}` → **zero hits**. Every `/auth/login` reference in the portals is the Next **page** route (`apps/admin/app/[locale]/(auth)/login/page.tsx`, e2e URL assertions), not the backend endpoint. `apps/client` never references it.
- **The fallback is broken, not merely inferior** (N7). Injecting `BruteForceProtectionPort` into `AuthServiceCore` would count every SSO login as a failed password attempt (`oidcRoutes.ts:410`, `samlRoutes.ts:333` pass a sentinel password and provision on failure), locking out SSO users after five logins.

**C12 deletes the door unconditionally** — `authRoutes.ts:330-340`, `authClient.login`, the `apiClient.security.login` re-export, and the test tail (`tests/unit/authRoutes.test.ts` ×7, `tests/unit/auditMiddleware.test.ts` ×6). `AuthServiceCore.login` **survives**: SSO depends on it. It is no longer "conditional, own review"; R8.1 is a MUST and this is its only sound remedy.

---

## 6 · Fail-open — preserved, and made observable · **AMENDED AT GATE**

_(Changed: `onStoreFailure: "deny"` is deleted entirely. Drove: L2-BLOCKER.)_

### What happens today

`tryConsume` catches every Redis error and returns `{allowed:true, remaining:capacity}` (`:123-127`), logging `warn({err, key})` on a logger bound to `module:"ai"` (`:20`) — for an HTTP limiter — with `key` carrying the client IP **plus the full URL with query string**, which is not in `REDACT_PATHS`. The preHandler's own `try/catch` (`:218-222`) covers `resolveClientIp` and both `reply.*` calls; the store outage never reaches it.

### The decision: **fail-open everywhere, loudly**

The design previously declared posture per rule and denied on the credential surface. That contradicts R6 [MERGE-BLOCKING], R6.1, R6.4 and R12.3 in this change's own delta spec, and `client-ip-rate-limit/spec.md:119,135` besides. It is withdrawn.

It is also wrong on the merits. Because `/auth/refresh`, `/auth/customer/refresh` and `/admin/auth/refresh` are credential surface (§7), `deny` turns a Redis outage into a **complete authentication outage** on both portals while the rest of the product runs on Postgres — and the design's own justification (_"login does not need Redis to work"_, `authServiceCore.ts:74-75`) is the proof of that cost, not a mitigation of it. An attacker who can pressure Redis would hold an authentication kill switch. Fail-closed does not restore the account layer either; it fails open independently (`RedisBruteForceAdapter.ts:165,179`).

**The rule type therefore carries no posture dimension** — a dimension with one legal value is dead weight, and R10's corollary (do not ship a knob you cannot honour) applies by analogy.

### Making it honourable

The preHandler cannot currently distinguish "allowed" from "the store is gone". Add one truthful field:

```ts
interface RateLimitDecision {
  // …existing
  /** True when this decision was made WITHOUT the store (fail-open). */
  readonly degraded?: boolean;
}
```

The adapter sets it in its catch, **stops logging `key`**, and stops owning the security narrative (it keeps a `debug` line without `key`, so the AI-throttle consumer is not silenced). The preHandler owns the decision and the telemetry, where the route pattern is in hand. Letting the adapter throw was rejected: the preHandler's catch also wraps `resolveClientIp` and both `reply.*` calls, and conflating a store outage with a serialization bug is how "fail-open is dead code" got believed.

### Making it observable

1. `threat_type: "http_rate_limit_failopen"` (required by `client-ip-rate-limit/spec.md:135`, present nowhere in `apps/api/src`), on an HTTP-scoped logger, with `{ pattern, classification }` and **without** `key` (R6.3).
2. A Prometheus counter alongside the existing ones (`apiMetrics.ts:12-34` shape): `http_rate_limit_degraded_total`.
3. `unclassified_route` telemetry if the runtime STANDARD safety net ever fires (§3.2).

**Why the counter is not optional:** `index.ts:389-399` registers `auditMiddleware` and `metricsMiddleware` inside plain (non-`fastify-plugin`) child registrations owning zero routes, so their hooks never run. That is out of scope (§9) — but it means this limiter's 429s produce no audit row and no HTTP metric, so C10's telemetry is the subsystem's **only** signal.

`httpRateLimitPreHandler.ts:218-222` is **not touched** (explore killed claim #2).

---

## 7 · Parity

**Customer side:** rows for `/auth/customer/register` (`REGISTRATION`), `/auth/customer/request-password-reset` (`RECOVERY_REQUEST`), `/auth/customer/reset-password` (AUTH), an **explicit** row for `/auth/customer/login/mfa` (**landed in C2 as a preservation row, not C5** — see §8), and `/auth/mfa/{status,setup,verify-setup,disable,regenerate-backup-codes}`. Four inert blocks deleted.

**Admin side:** rows for `/admin/auth/refresh` (`adminAuthRoutes.ts:570`, today 100/min with no preHandler — customer is _ahead_ of admin here), `/admin/auth/password/validate` (`STRICT`), `/admin/auth/password/change` (AUTH), all four `/admin/auth/mfa/*`, both force-disables (`SENSITIVE_AUTHED`). M3 folded in. `resolveClientIp` on the brute-force key. Three inert blocks deleted.

**Credential surface additions — AMENDED AT GATE** _(drove: L3-C1)_: exact rows for `POST|DELETE /zapier/keys[/:id]`, `POST|DELETE /make/keys[/:id]` (`SENSITIVE_AUTHED`), `/admin/users/:id/password-reset` (`RECOVERY_REQUEST`), `/admin/accounts/:accountId/reset-password` (`RECOVERY_REQUEST`), `/admin/accounts/:accountId/revoke-sessions` (`SENSITIVE_AUTHED`), `/admin/oidc/configurations/:accountId/replace-client-secret` (`SENSITIVE_AUTHED`). The last two lift those patterns out of the `/admin/accounts/` family, which layer 3 forbids over credential-classified patterns — resolving the contradiction the third reviewer flagged.

### Retiring M3 must not regress admin — the proof

1. **The key is preserved.** After C1, M1's key is `${ip}:${method}:${pattern}` — the same parameter-free, query-free identity M3 used (`adminAuthMiddleware.ts:227`), plus method separation. `adminRateLimit.test.ts:47`'s assertion migrates into the M1 suite as an executable spec.
2. **The policy is preserved or tightened**, compared as rates (§2): 45× stricter on login, equal on both reset routes.
3. **Conditionality is preserved — AMENDED AT GATE.** M3 runs unconditionally; M1 is flag-gated. C0 lands first and makes `ENABLE_RATE_LIMITING=false` legal only under `NODE_ENV === "test"`, so retiring M3 cannot convert an unconditional control into a conditional one in any deployable environment.

**Corrected proposal risk #3.** The proposal warns that deleting M3 removes the `NODE_ENV === "test" ? 100 : 15` escape hatch and breaks admin-login-looping tests. The opposite: after C7, admin login is unlimited **in tests** (where `ci-setup-test-env.sh:37` writes `ENABLE_RATE_LIMITING=false`) and strictly capped everywhere else. Proposal risk #3 is void; proposal risk #7 (an enforcement test must set the flag true) stands and is handled in C4.

**`/admin/auth/login` — F3:** AUTH, for parity with `/auth/customer/login` (R3.4) and because the account-keyed gate at `AdminAuthService.ts:67` is the real guess budget. **With a stated dependency:** at `hops = 0` behind an uncounted edge, five attempts per fifteen minutes is shared by every admin. That dependency is now carried by the deployment precondition in §9 and reported at boot by C0 — **not** by a claim that C0 mitigates it, which it does not (N8).

**Justified asymmetries** (re-verified): `/auth/customer/register` has no admin twin — `POST /auth/register` was removed for CWE-269 and admins are provisioned via `AuthService.registerAdmin` on the seed path.

---

## 8 · Commit sequence · **AMENDED AT GATE**

_(Changed: C0 added and moved to the front; the R7 proof added before any deletion; two commits added for R8.1/R8.5; C10's baseline corrected to ten sites; C11→C0; C13 unconditional. Drove: L2-C2/C3/C4, L3-C2/C3/C4, L1-C3.)_

Each commit leaves lint (`--max-warnings 0`), `tsc`, the fitness suite and the test suites at zero, and leaves the perimeter **no weaker than the commit before**. RED-before-GREEN is the authoring discipline inside each commit.

| #       | Commit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What is true at the end of it                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **C0**  | `fix(config): enforcement is mandatory outside tests, and its state is reported` — `ENABLE_RATE_LIMITING=false` is legal **only** when `NODE_ENV === "test"`; every other configuration fails to boot. Production additionally requires `TRUSTED_PROXY_HOP_COUNT` to be explicitly set. Boot emits a structured `rate_limit_enforcement` report: `{ enabled, trustedProxyHopCount, ruleCount, defaultPolicy }`.                                                                                                                                                                                                                               | **Answers F5 and R9.** No later deletion can convert an unconditional control into a conditional one. The report is what C4's proof consults to fail when enforcement is off (R7.3).                                           |
| **C1**  | `feat(rate-limit): key the bucket by route identity` — `bucketKey()` (§1.2), `findConfig(pattern, …)`, `fakeReq` gains `method` + `routeOptions` (all ~10 cases in this commit — proposal risk 4). Tests: query-invariance, param-invariance, `GET ≠ POST`, `GET == HEAD`, 404 → `UNROUTED`, plus the co-located preset assertions (T2).                                                                                                                                                                                                                                                                                                      | Every currently-live rule still matches. Per-query and per-param multipliers gone. M2/M3 now double-charge — stronger.                                                                                                         |
| **C2**  | `feat(rate-limit): extract the policy module, match by exact route pattern` — new `src/security/rateLimitPolicy.ts` (presets + typed table + `resolvePolicy` + `auditPolicy`, Fastify-free); N1's 19 dead rows deleted; `contains` deleted; `X-RateLimit-Limit` emitted. **Preservation rows land here, not later:** `/auth/customer/login/mfa` (AUTH), `/health/{detailed,live,ready,dependency/:name}` (HEALTH), `/r/:shortCode` (REDIRECT). **Equivalence test:** for every registered pattern, old resolution === new resolution, with a deliberate-change list **constrained to tightenings** — a loosening entry fails by construction. | Policy per pattern is provably unchanged **and no cap is loosened for a single commit**. The `/r/` row also removes the C2→C6 header incoherence (M1 would otherwise advertise STANDARD's 100 while M2 charged REDIRECT's 60). |
| **C3**  | `feat(rate-limit): full-inventory policy audit + generated snapshot` — `onRoute` collector at `index.ts:198`; `auditPolicy` throws on the structural class and ERROR-logs the classifier class; families bootstrapped from the boot inventory so resolution does not move; `scripts/dump-rate-limit-policy.ts`; snapshot committed; **its own CI step** with an explicit `ENABLE_RATE_LIMITING=true`; unit-tier coverage test reading the snapshot; fitness **#35**.                                                                                                                                                                          | The N1 class and the implicit-default class can never recur. Snapshot shows the truth — including the credential routes still at STANDARD. `resolvePolicy` is exported as the public consumer surface (§3.2).                  |
| **C4**  | `test(rate-limit): prove enforcement end-to-end` — **PR tier:** `node:test` integration suite booting the composed app via `createApp()` against the job's real Redis + Postgres, driving the burst through `app.inject()` (full lifecycle, real store), asserting the (N+1)-th is 429 on `/auth/customer/login` (AUTH, already live), with query-string and path-param variants; consults C0's boot report and fails when enforcement is inactive. CI job gains `ENABLE_RATE_LIMITING: "true"`. **Full tier:** the live-socket burst, hand-added to a named `run-tests.sh` batch.                                                            | **R7 is proven before any mechanism is deleted**, and it is proven on a pull request rather than after the merge it was meant to block.                                                                                        |
| **C5**  | `feat(rate-limit): cap the credential surface` — all §4/§7 rows including the N5 additions, the three new presets + `UNROUTED`, the expensive-preset re-sizing for bucket collapse (with its basis recorded), credential-classification assertions enabled. **Preceded by the sweep as a task with a named output** (which suites loop over ids or logins; each one's new budget).                                                                                                                                                                                                                                                            | The snapshot diff _is_ the review, line by line. M2 and M3 are now provably redundant.                                                                                                                                         |
| **C6**  | `refactor(rate-limit): delete the namespaced limiter (M2)` — `httpRateLimitPreHandler.ts:139-188` + `linkRoutes.ts:288-307`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Snapshot unchanged. Test: two shortCodes → one key. C0 guarantees no conditionality regression.                                                                                                                                |
| **C7**  | `refactor(rate-limit): delete the admin rate-limit middleware (M3)` — `adminAuthMiddleware.ts:206-251`, attachments at `adminAuthRoutes.ts:563, 580, 590`, `loginRateMax` `:559`; `adminRateLimit.test.ts:47`'s assertion migrated; one 429 shape asserted (R2.2).                                                                                                                                                                                                                                                                                                                                                                            | Snapshot unchanged. Policy equal-or-stricter on all three (§2).                                                                                                                                                                |
| **C8**  | `refactor(rate-limit): delete the dead role-based limiter (M5)` — `rbacMiddleware.ts:196-222` + `rbacMiddleware.test.ts:449, 459, 472, 484`. `rbacMiddleware.ts:241` is untouched here (C11 owns it).                                                                                                                                                                                                                                                                                                                                                                                                                                         | `X-RateLimit-Limit` still emitted (since C2); `X-RateLimit-Window` stops existing and C13 removes its documentation.                                                                                                           |
| **C9**  | `refactor(rate-limit): delete the seven inert declarations (M4)` — **atomic, and the atomicity is a stated constraint:** the 7 blocks + `@fastify/rate-limit` dropped from `apps/api/package.json:183` + `tests/unit/authRateLimit.test.ts` deleted + `package.json:23` `test:ratelimit` rewritten (`security-testing.yml:155` invokes it) + fitness **#33** (loose-anchor regex with path exclusions). Splitting this commit turns `authRateLimit.test.ts:368,405` red, because that suite registers the real `authRoutes` and depends on these blocks.                                                                                      | Behaviourally inert by construction; the class is un-recreatable. C4 already carries the executed 429 proof this file used to be the only holder of.                                                                           |
| **C10** | `feat(rate-limit): observable fail-open` — `degraded` on `RateLimitDecision`; adapter sets it, stops logging `key`, drops the `module:"ai"` binding for the HTTP instance; preHandler emits `threat_type:"http_rate_limit_failopen"` + the counter. **Posture unchanged: fail-open, everywhere.** `:218-222` untouched.                                                                                                                                                                                                                                                                                                                       | Fail-open is observable for the first time; R6.1–R6.4 and R12.3 hold.                                                                                                                                                          |
| **C11** | `feat(security): canonical client IP on every security decision` — **all ten measured sites**: `adminAuthMiddleware.ts:145`, `adminAuthRoutes.ts:69`, `oidcRoutes.ts:413`, `samlRoutes.ts:335`, `rbacMiddleware.ts:241`, `authRoutes.ts:61`, `:156`, `mfaRoutes.ts:351`, `:420`, `securityHeaders.ts:341`; fitness **#34** over the full baseline.                                                                                                                                                                                                                                                                                            | #34 lands green over what is actually there, not over three lines chosen to match it. R13.2/R13.3 hold, brute-force throttling and auditing included.                                                                          |
| **C12** | `refactor(auth): close the account layer` — delete the `/auth/login` door (`authRoutes.ts:330-340`, `authClient.login`, the `apiClient.security.login` re-export, the test tail); `AuthServiceCore.login` **kept** (SSO depends on it, N7). Delete the write-only `recordLoginAttempt` + `LOGIN_ATTEMPTS_PREFIX` and its two call sites (`authServiceCore.ts:156,297`) — a record with zero readers is not protection (R8.5). Add the enumeration test naming every remaining credential-verifying endpoint and asserting each is account-gated (R8.1), plus the assertion that a perimeter denial records no failed attempt (R8.3).          | **Unconditional.** R8.1, R8.3 and R8.5 close here; the lockout bypass on admin credentials is gone.                                                                                                                            |
| **C13** | `docs(security): the documentation is the enforced policy` — W8 items **plus** `docs/architecture/API.md:669-672` (drop `X-RateLimit-Window`), `docs/api/README.md:383-385`, `docs/security/AUTH.md:322,324-326`, `docs/architecture/SECURITY.md:207` (_"per-IP + per-URL"_ → per-IP + route pattern + method). The rate-limit tables in `docs/api/auth.md` are **generated from the snapshot** by the dumper, so R11.1's comparison is a build step and not a transcription. `SECURITY_CANON §Rate Limiting`'s principal sentence reworded as intent per §5.4.                                                                               | Docs cannot drift silently because the figures are generated, not cited. R5, R10.2, R10.3, R11 close.                                                                                                                          |

**PR boundaries:** **PR1** C0–C4 (mechanism, gate, proof; zero policy change — the generated snapshot is annotated as generated for the review budget) · **PR2** C5 (the caps; one snapshot diff) · **PR3** C6–C9 (four deletions) · **PR4** C10–C12 (telemetry, IP parity, account layer) · **PR5** C13.

---

## 9 · What this design cannot do · **AMENDED AT GATE**

| Gap                                                                                                                                                                                                                                                                | Owner                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Per-principal keying.** Impossible **at the perimeter** (`route.js:389-393`); available in two files inside the shared auth preHandlers, but blocked here by R2 (MERGE-BLOCKING, forbids two allowances) and by the absence of decided per-principal capacities. | **Intent. No owning change exists in the tree today.** Shape and preconditions specified in §5.4; C13 rewords the canon claim so nothing promises it meanwhile.                                                                                                                                                                                                 |
| **Credential caps are product-wide when `TRUSTED_PROXY_HOP_COUNT = 0`** and the portals sit behind no XFF-setting edge. Not created by this change for parameterless routes (they already share one bucket), but amplified by the tightened caps.                  | **Deployment precondition, merge-blocking as documentation:** before more than one user is served, the edge in front of each portal must set `X-Forwarded-For` and the API must run `hops ≥ 1` (`SECURITY_CANON §Topology invariant`, already mandatory). C0 reports the effective value at boot. The topology-independent fix is per-principal keying (row 1). |
| **Parameterised expensive routes collapse to one bucket per pattern.** Ratified by R1.7; sized for in C5; still product-wide at `hops = 0`.                                                                                                                        | This change (C5 re-sizing) + the row above.                                                                                                                                                                                                                                                                                                                     |
| **The credential classifier is hand-maintained.** A credential route it misses now carries an _explicitly declared_ STANDARD and appears in the snapshot diff, rather than silently inheriting 100/min.                                                            | This change; documented beside the table; the snapshot diff is the compensating control. **SA-3** words it as intent in the spec.                                                                                                                                                                                                                               |
| **OPTIONS preflight is never rate-limited** (`@fastify/cors@11.1.0` `index.js:12-13, 201-208`).                                                                                                                                                                    | Own item: closing it means `preflightContinue: true` + a CORS-aware row — a change to CORS semantics.                                                                                                                                                                                                                                                           |
| **Malformed URLs bypass every hook** (`four-oh-four.js:36-38, 64-73`).                                                                                                                                                                                             | Own item; the real mitigation is at the trusted edge.                                                                                                                                                                                                                                                                                                           |
| **The Next portal surface is invisible to the collector** — `apps/admin/app/api/auth/refresh/route.ts` is a credential endpoint; the two `[...path]` proxies are unlimited amplification paths into the backend credential surface.                                | Own item. The specs' credential surface is read here as _routes the API registers_; the portal surface needs its own change.                                                                                                                                                                                                                                    |
| **The gate proves a rule exists, never that the number is right.**                                                                                                                                                                                                 | Human review of the snapshot diff. No mechanism substitutes.                                                                                                                                                                                                                                                                                                    |
| **429s produce no audit row and no HTTP metric** — `index.ts:389-399` adds `auditMiddleware`/`metricsMiddleware` hooks inside plain child registrations owning zero routes.                                                                                        | Its own CRITICAL, out of scope. Consequence absorbed: C10's counter + structured log are the subsystem's only telemetry.                                                                                                                                                                                                                                        |
| **A Redis outage still disables the account-keyed brute-force gate** (`RedisBruteForceAdapter.ts:165,179`) and, with fail-open preserved, the HTTP limiter too.                                                                                                    | Follow-up: a **durable, Postgres-backed account lockout**. That is the only fix that does not trade a bypass for an authentication outage — which is why C10 keeps fail-open (§6).                                                                                                                                                                              |
| **`principal-derived-authority` currently plans a boot assertion on `config.rateLimit`**, which fitness #33 forbids from the moment C9 lands.                                                                                                                      | Handoff obligation of **this** change: §3.2 publishes `resolvePolicy` as the replacement, which asserts enforcement rather than an inert marker. The other change's design phase consumes it.                                                                                                                                                                   |

---

## 10 · Spec amendments this design requires · **AMENDED AT GATE**

Each is a wording change the tasks phase must land in `openspec/changes/auth-rate-limit-integrity/specs/` **before** the requirement it touches is implemented. Every one exists because a spec currently promises something the tree contradicts — the defect class this change exists to remove.

| #        | Requirement        | Change                                                                                                                                                                                                                                                                           | Driven by                 |
| -------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **SA-1** | R1.4               | Carve out the auto-exposed HEAD twin: HEAD is folded into GET and does not receive an independent allowance; independence is asserted for genuinely distinct methods (GET vs POST).                                                                                              | L2-W (HEAD fold)          |
| **SA-2** | R10.1              | Scope the justification to the **perimeter declaration surface**. Per-principal keying is unhonourable _there_, not system-wide (§5.2).                                                                                                                                          | L1-W (cheap intermediate) |
| **SA-3** | R3.1, R3.3         | R3.3's derivation claim binds the route **inventory** (true under full coverage: removing a row fails the boot). The credential **classifier** is stated as intent with the snapshot diff as its compensating control. R3.1's coverage set is the classifier as broadened in N5. | L3-C1, L3-C5              |
| **SA-4** | R10 `Owner:`       | Replace `principal-derived-authority` with: intent, no owning change exists; shape and preconditions per §5.4.                                                                                                                                                                   | L1-C2                     |
| **SA-5** | R10 (new scenario) | Add: every authenticated parameterised route's post-change allowance is stricter than its pre-change allowance — the fact that makes accepting the gap defensible. R3.5's machinery proves it for free.                                                                          | L1-S                      |
| **SA-6** | R11.1 (falsifier)  | The documented figures are **generated** from the snapshot by the dumper; the comparison is a build step, not a transcription check.                                                                                                                                             | L3-W (R11.1)              |
| **SA-7** | R1.5               | Scope the independence claim to the **derivation**, with the topology precondition stated (`hops ≥ 1` and an XFF-setting edge). At `hops = 0` distinct portal-borne callers share a bucket — a pre-existing configuration state (N8), not a property of the derivation.          | L3-W (R1.5), L1-C3        |

**No amendment to R6, R12.3, or `client-ip-rate-limit/spec.md:119,135`.** The design yields on fail-open.

---

## Gate disposition table

| #           | Finding                                                                  | Severity   | Disposition                         | Resolution                                                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------ | ---------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L2-1        | C9 fail-closed contradicts R6 [MB] and R12.3                             | BLOCKER    | **AMENDED**                         | `onStoreFailure` deleted; fail-open preserved everywhere; only `degraded` + telemetry + counter survive (§6, C10). Residual owned by a durable Postgres-backed lockout.                                                                                                                                                        |
| L1-1        | Named owner requires `config:{rateLimit}` that R4 abolishes              | CRITICAL   | **AMENDED**                         | `resolvePolicy` published as the consumer surface (§3.2); handoff obligation recorded in §9; the un-landed draft adapts, not the merge-blocking spec.                                                                                                                                                                          |
| L1-2        | Owner is untracked prose; its gate reaches ~3 routes                     | CRITICAL   | **AMENDED**                         | Owner withdrawn; per-principal keying stated as intent with a specified shape and R2 precondition (§5.4); SA-4.                                                                                                                                                                                                                |
| L1-3        | C11 cannot mitigate the cross-tenant collapse                            | CRITICAL   | **AMENDED** (sub-claim **REFUSED**) | C11 → C0 and stops claiming mitigation; C5 re-sizes expensive presets; residual + deployment precondition in §9. **Refused:** "no hop count separates two tenants" (false at `hops=1` behind an XFF-setting edge — `resolveClientIp.ts:118`) and "stage 1 introduces it on the credential surface" (already one bucket today). |
| L2-2        | C2 loosens `/auth/customer/login/mfa` 20× for all of PR1                 | CRITICAL   | **AMENDED**                         | Preservation rows (MFA step-2, four `/health/*`, `/r/`) land **in C2**; the equivalence test's deliberate-change list admits tightenings only.                                                                                                                                                                                 |
| L2-3 / L3-2 | C5/C6 make live protections flag-conditional before C11                  | CRITICAL   | **AMENDED**                         | C0 lands first and narrows the flag: `false` legal only under `NODE_ENV === "test"`; no environment loses an unconditional control.                                                                                                                                                                                            |
| L2-4        | R7 [MB] and R8.5 have no commit                                          | CRITICAL   | **AMENDED**                         | C4 (proof, before any deletion) and C12 (delete the reader-less attempt record + enumeration test) added.                                                                                                                                                                                                                      |
| L2-5        | R8.1's only remedy is optional (C13)                                     | CRITICAL   | **AMENDED**                         | C12 is unconditional; sweep verified (`security.login` zero callers) and the fallback disproved (SSO sentinel-password lockout, N7).                                                                                                                                                                                           |
| L3-1        | Classifier misses ≥8 registered credential routes                        | CRITICAL   | **AMENDED**                         | Ten verified misses added (N5, §7) **and** the classifier demoted from scope selector to severity assertion (§3.2).                                                                                                                                                                                                            |
| L3-3        | Fitness #34's baseline is 10 sites, not 3                                | CRITICAL   | **AMENDED**                         | C11 fixes all ten measured sites; #34 lands green over the real baseline.                                                                                                                                                                                                                                                      |
| L3-4        | R7 [MB] cannot execute on a PR                                           | CRITICAL   | **AMENDED**                         | Two tiers: PR-tier composed-app + real-store burst via `inject` (the merge blocker), full-tier live-socket burst in a named batch.                                                                                                                                                                                             |
| L3-5        | R3.3 is false of the chosen mechanism                                    | CRITICAL   | **AMENDED**                         | Full-inventory coverage — no implicit default; removing a row fails the boot. Classifier residual worded as intent (SA-3).                                                                                                                                                                                                     |
| L1-4        | "Sixth mechanism" is a rationalisation                                   | WARNING    | **AMENDED**                         | Argument retired; replaced by pre-auth severity + the R2 merge-blocker + undecided numbers (§5.1).                                                                                                                                                                                                                             |
| L1-5        | A cheap intermediate exists; R10.1 over-generalises                      | WARNING    | **AMENDED**                         | §5.2 names it and states why it does not land; SA-2 scopes R10.1 to the perimeter.                                                                                                                                                                                                                                             |
| L1-6        | R10 omits the tightening that justifies the deferral                     | SUGGESTION | **AMENDED**                         | SA-5 adds it as a scenario; §5.3 carries the verified evidence.                                                                                                                                                                                                                                                                |
| L2-6        | Header contract closed in one doc of five; `X-RateLimit-Window` orphaned | WARNING    | **AMENDED**                         | Emitted set fixed at four; five documents normalised in C13 (§2).                                                                                                                                                                                                                                                              |
| L2-7        | HEAD→GET fold contradicts R1.4 as worded                                 | WARNING    | **AMENDED**                         | Fold kept; SA-1 carries the carve-out; both halves asserted in C1.                                                                                                                                                                                                                                                             |
| L2-8        | C8's safety depends on unstated atomicity                                | WARNING    | **AMENDED**                         | C9's atomicity is a stated constraint with the failing lines named.                                                                                                                                                                                                                                                            |
| L2-9        | §3.1 rejects the boot throw, then adopts it                              | WARNING    | **AMENDED**                         | Boot throws on the structural class only; classifier judgments ERROR-log at boot and fail in CI (§3.2).                                                                                                                                                                                                                        |
| L2-10       | Transient header incoherence C2→C5 on `/r/`                              | SUGGESTION | **AMENDED**                         | The REDIRECT row lands in C2 with the other preservation rows.                                                                                                                                                                                                                                                                 |
| L3-6        | The gate rides on the OpenAPI drift step                                 | WARNING    | **AMENDED**                         | Dedicated CI step with an explicit `ENABLE_RATE_LIMITING=true`; fitness #35 backs R2.3.                                                                                                                                                                                                                                        |
| L3-7        | Fitness #33's regex defeated by key order                                | WARNING    | **AMENDED**                         | Loose anchor `\brateLimit\s*:\s*\{` + path exclusions; both baselines measured (7 / 12−5).                                                                                                                                                                                                                                     |
| L3-8        | R1.5 false in the documented topology                                    | WARNING    | **AMENDED**                         | SA-7 scopes it to the derivation with the topology precondition.                                                                                                                                                                                                                                                               |
| L3-9        | `/admin/accounts/` family contradicts layer 3                            | WARNING    | **AMENDED**                         | The two credential routes under it take exact rows (§7).                                                                                                                                                                                                                                                                       |
| L3-10       | R11.1's falsifier is not built                                           | WARNING    | **AMENDED**                         | Doc tables generated from the snapshot in C13; SA-6.                                                                                                                                                                                                                                                                           |
| L3-11       | R2.3 has no planned proof                                                | WARNING    | **AMENDED**                         | Fitness #35 (§3.2, layer 5).                                                                                                                                                                                                                                                                                                   |
| L3-12       | Portal surface missing from the blind-spot list                          | SUGGESTION | **AMENDED**                         | Added to §3.3 and §9 with an owner.                                                                                                                                                                                                                                                                                            |
| L3-13       | The pre-C1 sweep is an instruction, not a task                           | SUGGESTION | **AMENDED**                         | C5 carries it as a task with a named output.                                                                                                                                                                                                                                                                                   |
| L3-14       | Fastify mechanism verified correct                                       | SUGGESTION | **Accepted**                        | Recorded in §1.1 and §3.2 so tasks do not re-litigate.                                                                                                                                                                                                                                                                         |

---

## Residual risks accepted

| Risk                                                                               | Why it is acceptable                                                                                                                                                                                                          | Owning item                                                   |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A Redis outage removes both the HTTP limiter and the account layer at once.        | Fail-closed trades a bounded guessing window for a total authentication outage an attacker can induce, and does not restore the account layer either. R6/R12.3 forbid it. C10 makes the window observable for the first time. | Follow-up: durable Postgres-backed account lockout (§9).      |
| Credential allowances are product-wide at `TRUSTED_PROXY_HOP_COUNT = 0`.           | Pre-exists for parameterless routes; correctable by the topology the canon already mandates (`hops ≥ 1` behind an XFF-setting edge); reported at boot by C0; the app has never been used.                                     | Deployment precondition (§9) + per-principal keying (intent). |
| A credential route the classifier misses lands on an explicitly declared STANDARD. | Degraded from silent 100/min to a visible line in a generated snapshot diff; ten current misses closed (N5); the inventory half is fully derived.                                                                             | This change (SA-3) + snapshot review.                         |
| Authenticated routes stay IP-keyed.                                                | Every CRITICAL is pre-auth; folding stage 2 in requires amending a merge blocker (R2) and inventing capacities nobody has decided; stage 1 strictly tightens every affected route.                                            | Intent, shape specified (§5.4).                               |
| OPTIONS preflight and malformed URLs bypass the limiter.                           | Both pre-exist, neither is a regression, and both are closed at the CORS layer or the trusted edge — not in the limiter.                                                                                                      | Own items (§9).                                               |
| 429s emit no audit row and no HTTP metric.                                         | An encapsulation defect in bootstrap, not in the limiter; absorbed by C10's counter and structured log being the subsystem's only telemetry.                                                                                  | Its own CRITICAL, filed (§9).                                 |
| The Next portal credential surface is outside the gate.                            | The specs' credential surface is read as routes the API registers; the portal surface needs its own change to be gated at all.                                                                                                | Own item (§9).                                                |
| The gate cannot judge whether a number is right.                                   | No mechanism can; the generated snapshot diff puts every number in front of a reviewer.                                                                                                                                       | Human review.                                                 |

---

## Verdict

**The design is ready for tasks, amended.**

The central decision — the stage-1/stage-2 split — survives all three reviews and is now argued on the reason that carries it (every CRITICAL is pre-auth) rather than on the one that did not (a sixth mechanism). What died at this gate is the split's _owner_ (withdrawn to honest intent with a specified shape), the fail-closed credential posture (withdrawn as a contradiction of its own merge blocker), the classifier-as-scope-selector (replaced by full-inventory coverage), the conditional treatment of R8.1 (C12 is unconditional on verified evidence), and three commit-ordering hazards (C0 first, the R7 proof before any deletion, preservation rows in C2).

Two gates on the tasks phase, both merge-blocking:

1. **The seven spec amendments in §10 land before the requirements they touch are implemented.** Five of them exist because a spec currently asserts a property the tree contradicts; shipping around them would be this change's own defect, relocated.
2. **C0 lands before C6, and C4 lands before C6.** No mechanism is retired before enforcement is unconditional outside tests and before an executed end-to-end proof exists. The commit table is not a suggested order.
