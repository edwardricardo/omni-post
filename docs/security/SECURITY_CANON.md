# Security Canon — Secrets & Environment

> Authoritative security rules for omni-post. Auto-loaded via
> `@docs/security/SECURITY_CANON.md` in CLAUDE.md.

**Owner:** Maintainers
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Secrets and Environment

**All env access MUST go through a typed `env` constant — never `process.env.X` directly, never a `process.env.X || "fallback"` pattern.**

Three apps, three env modules — same shape:

| App / package     | Env module                   | Library                    | Notes                                                   |
| ----------------- | ---------------------------- | -------------------------- | ------------------------------------------------------- |
| `apps/api/src/**` | `apps/api/src/config/env.ts` | `@t3-oss/env-core` + Zod   | Server-only env; consumed by Fastify + workers.         |
| `apps/admin/**`   | `apps/admin/lib/env.ts`      | `@t3-oss/env-nextjs` + Zod | Server/client split via `clientPrefix: "NEXT_PUBLIC_"`. |
| `apps/client/**`  | `apps/client/lib/env.ts`     | `@t3-oss/env-nextjs` + Zod | Same pattern as admin.                                  |

Every module parses `process.env` once at module load. If any required key is missing or malformed, the app refuses to boot with a precise error. There is no warn-and-continue.

| Scope                                  | Pattern                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Read a value                           | `import { env } from ".../env.js"; env.MY_VAR`                                                                                         |
| Add a new var (api)                    | Add to `server: {...}` block in `apps/api/src/config/env.ts`; update `.env.example`                                                    |
| Add a new var (Next.js)                | Server-only → `server: {...}`. Browser-exposed → `client: {...}` (key MUST start with `NEXT_PUBLIC_`); also add to `runtimeEnv: {...}` |
| Conditional secret (e.g. Stripe)       | Schema marks optional; factory throws at construction if the toggle requires it                                                        |
| Test fixture                           | Set in `.env.test` at root; tests should not mutate `process.env` at runtime                                                           |
| Runtime-mutable allowlist (non-secret) | Extract to a factory function that takes the allowlist as a parameter (cf. `makeMediaUrlSchema`)                                       |

- **Fail-fast required, no fallbacks for secrets** (CWE-798). CI fitness greps #15 + #16 + #17 enforce this in `apps/api/src`, `apps/workers/src`, and the Next.js apps respectively. The typed form is forbidden too: `env.X ?? ""` on a secret the schema marks optional boots with an empty string that reads as configured, so an unconfigured secret is an absent optional field, never `""`; fitness #15 matches `env.X` as well as `process.env.X`.
- **Single source of truth on disk**: root `.env` for dev, root `.env.test` for tests. Per-app `.env`s were removed.
- **Browser bundle leak prevention**: Next.js `clientPrefix: "NEXT_PUBLIC_"` enforced — referencing a server-only env var (e.g. `env.SENTRY_DSN`) from a client component throws at runtime via `onInvalidAccess`, surfacing the leak before it reaches users.

Full secrets architecture rationale: [docs/architecture/secrets-and-env.md](../architecture/secrets-and-env.md).
Operational reference (where every secret lives + how to rotate it): [docs/security/SECRETS.md](SECRETS.md).

---

## Multi-Tenant Isolation

Closed via §2.1 of the normalization roadmap ([its last version](https://github.com/edwardricardo/omni-post/blob/3758be3ee3d4274bcc01582b437080732f50d11d/docs/architecture/NORMALIZATION_ROADMAP.md)). Layer 1 (Prisma `$extends` guard) auto-injects `accountId` on tenant-scoped queries; layer 2 (PostgreSQL RLS) gates rows by `app.account_id` GUC bound at tx start by `PrismaUnitOfWork`; layer 3 (fitness #23) blocks raw queries outside the guard. Full strategy + 50-table list + runbooks in [docs/security/MULTI_TENANT_GUARDS.md](MULTI_TENANT_GUARDS.md). The recurring audit cadence lives in `MULTI_TENANT_AUDIT_<date>.md`.

When adding a new `accountId`-bearing model:

1. Append the lowerCamel model name to the `TENANT_SCOPED_MODELS` Set in `infra/prisma/src/extensions/tenantGuard.ts`.
2. Append the PascalCase table name to the migration array in any forthcoming RLS migration (or extend `20260527000000_add_rls_tenant_isolation` if pre-deploy).
3. Document in MULTI_TENANT_GUARDS.md.

---

## Rate Limiting — Client-IP Derivation Behind Proxies

**The rate-limit / IP-allowlist bucket key MUST be derived from a TRUSTED
segment of the proxy chain — never from a client-controlled header value.**
`X-Forwarded-For` (XFF) is appended left-to-right: the **leftmost** entry is
the originating client and is **attacker-controlled**; each proxy appends the
address it saw on the **right**. Taking the leftmost entry (or `trust proxy:
true`, or a standalone `X-Real-IP`) lets any client spoof its identity, rotate
buckets per request, and defeat the limiter — a recognized, exploited threat
class (CVE-2025-59152 Litestar, CVE-2023-49952 Mastodon, CVE-2026-55501
9router; CWE-807 / CWE-290 / CWE-348).

### The rule

- **All client-IP derivation for security decisions (rate limiting, IP
  allowlist, brute-force throttle) goes through ONE canonical resolver:
  `resolveClientIp(request)` (`apps/api/src/security/resolveClientIp.ts`).** No
  route, middleware, or pre-handler reads `x-forwarded-for` / `x-real-ip`
  directly. Mirrors the env / logger / cache single-chokepoint pattern.
- **Trust is decided by the IMMEDIATE PEER's address, never by counting hops.**
  Two models are selectable, and nothing else is: `socket-only` and
  `trusted-ranges` (see §"The two trust models" below).
- **Fail toward the socket peer, never toward a client entry.** When the peer is
  not a configured proxy, or the selected token is not a valid IP, resolve to
  `request.socket.remoteAddress` — never `entries[0]`.
- **Never `trust proxy: true` / Fastify `trustProxy: true`,** which trusts the
  leftmost, client-controlled entry. **And never a NUMBER:** since fastify
  5.12.1 `getTrustProxyFn` returns `() => false` for a numeric `trustProxy`
  ("Hop-count-only trust cannot validate the immediate peer" —
  GHSA-3m5p-2c4r-xxw2), so a hop count trusts _nothing_ while still reading like
  configuration. `trustProxy` MUST be the single derived constant
  `FASTIFY_TRUST_PROXY` (`apps/api/src/security/resolveClientIp.ts`), which is
  `false` or the range list. Enforced by fitness **#28** as an allowlist.
- **Never re-implement hop counting as a `TrustProxyFunction`.** `(addr, hop) =>
hop < N` type-checks, keeps every test green, and deliberately restores the
  exact vulnerability the advisory patched. Security canon: **no** exception,
  no marker (ADR-0021).
- **Standalone `X-Real-IP` is NOT trusted** on the backend. It is a single
  value with no chain, so it cannot be validated against the peer; a
  directly-connected client can forge it. Ignore it unless the trusted edge is
  known to overwrite it, and even then prefer the XFF chain.
- **Prefer an authenticated principal over IP when one exists.** For
  authenticated endpoints, key by user / account id; reserve IP-based keys for
  unauthenticated traffic (OWASP).
- **The bucket key and the rule derive from the matched route, never from the
  raw URL.** `createHttpRateLimitPreHandler`
  (`apps/api/src/security/httpRateLimitPreHandler.ts`) selects the rule from the
  route pattern the router matched (`request.routeOptions.url`) and keys by
  client IP + that pattern with the parameter values Fastify parsed (the
  resource path); a request no route matched shares one per-IP `!unrouted`
  bucket. `request.url` keeps the query string, a fragment, percent-encoding
  and an absolute-form target, all of which reach the same handler, so a key or
  rule read from it lets each variant mint a fresh bucket or fall to the
  default rule.
- **Every rule governs a registered route.** A rule's `path` is a prefix of the
  route pattern (`/threads/:threadId/performance`), not of a URL, so a rule
  named after an endpoint that does not exist, or whose every route an earlier
  rule takes, caps nothing while it reads as protection.
  `apps/api/tests/unit/security/httpRateLimitRuleCoverage.test.ts` holds
  `STANDARD_ROUTE_RULES` and `EXPENSIVE_ENDPOINT_RULES` to the registered route
  table (the committed OpenAPI projection of `createApp()` that the CI API-types
  drift gate keeps current) and fails on either case.

### The two trust models

Selected by `TRUSTED_PROXY_MODE`; there is no third option and no implicit
fallback between them.

| Model            | `trustProxy` | Bucket key                                   | Cost / risk                                                                                                                           |
| ---------------- | ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `socket-only`    | `false`      | socket peer; every forwarding header ignored | Always spoof-safe. Behind a proxy **every caller shares one bucket** — an availability risk, never a bypass. The fail-closed default. |
| `trusted-ranges` | `string[]`   | the address a TRUSTED proxy vouched for      | Preserves per-client buckets. Correct only while the ranges list real proxies and only real proxies.                                  |

**The interlock.** `trusted-ranges` is selectable ONLY with at least one valid
range. `TRUSTED_PROXY_MODE=trusted-ranges` with an absent, empty, or malformed
`TRUSTED_PROXY_RANGES` **refuses to boot** — it never degrades quietly to
`socket-only`, because that would convert a typo into a permanent, invisible
loss of per-client rate limiting. The reverse pair is refused too:
`socket-only` **with** ranges set would leave an operator believing a list is
consulted when it never is. Enforcement is two-layered: the env schema rejects
the inconsistent pair at the boundary (`createFinalSchema` superRefine in
`apps/api/src/config/env.ts`), and the `TrustedProxyPolicy` type carries the
ranges as a **non-empty tuple**, so "mode B with no ranges" is not a value the
program can hold at all — unrepresentable, not merely rejected.

**Range breadth is the whole security boundary.** Every address inside
`TRUSTED_PROXY_RANGES` may assert any client identity in `X-Forwarded-For`. List
individual proxy addresses or the tightest CIDR that covers them — never a
tenant or workload subnet, which would hand that power to everything inside it.

**Why ENV and not the `SecuritySettings.ipAllowlist` DB pattern.** The two lists
have the same shape and the **opposite risk direction**, so reusing the pattern
would be a real mistake, not a shortcut. `ipAllowlist` declares _who may enter_:
an error there locks people out — it fails toward denial. A trusted-proxy list
declares _whom to believe about someone else's identity_: an error there means
believing a liar — it fails toward impersonation. A hostile entry added to a
runtime-mutable trusted-proxy table could then assert any `X-Forwarded-For`,
defeating the rate limiter **and** the `ipAllowlist` living in that same table.
Proxy topology is also a deployment fact, not a tenant preference. It therefore
lives in env, Zod-validated, fail-fast (ADR-0021).

### `resolveClientIp` contract

```
resolveClientIp(request, policy = configured) -> string  // normalized, stable bucket key
  socket = normalize(request.socket.remoteAddress) ?? "unknown"   // fail-closed target
  if policy.mode == "socket-only"            -> return socket
  if not isTrustedPeer(socket, policy.ranges) -> return socket    // peer may not speak for others
  return normalize(request.ip) ?? socket                          // proxy-addr's trusted-peer walk
```

`resolveClientAddress` is the same decision returning `{ ip, source }`:
`forwarded` when a trusted proxy reported an address other than its own, `peer`
in every other branch. `resolveClientIp` returns its `ip`.

`normalize` MUST, via `ipaddr.js`: strip a port suffix (bracket-aware for
`[2001:db8::1]:443`; also plain `1.2.3.4:5678` from Azure App Gateway et al.),
canonicalize IPv6 (`::ffff:` IPv4-mapped, case, drop `%zone`), and return a
single stable representation. Normalization is load-bearing: without it an
attacker varies the port or IPv6 spelling to mint a fresh bucket — the same
bypass class as the leftmost-entry bug.

The resolver reads **no** forwarding header itself under either model, which is
why `ClientIpRequest` no longer carries `headers`.

### `@fastify/proxy-addr` divergence — what it is now, and what it is not

Under the retired hop-count model the resolver's guard corrected a live
divergence: proxy-addr returned the **leftmost** entry whenever the chain was
shorter than the configured hop count. That divergence died with the model.

Under `trusted-ranges`, proxy-addr walks the chain right-to-left and stops at
the first address outside the ranges, so it **already** refuses to let an
untrusted peer speak for anyone else. The resolver's `isTrustedPeer` check
therefore _agrees_ with it rather than correcting it today. It is kept, and
tested against an adversarial `request.ip`, because an upstream change to that
walk is exactly the class of event that forced this rewrite: the resolver states
the invariant itself instead of inheriting it. Do not delete it on the grounds
that it is currently redundant — that redundancy is the point.

One divergence remains real and is **not** guarded, deliberately: when every
address behind the leftmost entry is inside the trusted ranges, proxy-addr runs
off the end of the chain and returns the leftmost, client-controlled value. That
is indistinguishable per-request from the legitimate single-hop case
(`XFF=[client]` behind a trusted edge returns the leftmost entry too), so no
sound per-request guard exists. Its defence is range breadth (above) and the
topology invariant (below) — stated plainly rather than papered over with a
check that cannot actually decide. The parity test pins both behaviours.

### `TRUSTED_PROXY_MODE` / `TRUSTED_PROXY_RANGES` env convention

- Both live in `apps/api/src/config/env.ts`, parsed once at boot, cross-validated
  by the interlock above. No silent default that assumes a topology.
- `TRUSTED_PROXY_MODE` defaults to `socket-only` — always spoof-safe. Never ship
  a default that assumes a proxy exists.
- `TRUSTED_PROXY_RANGES` is a comma-separated list of IPs, CIDRs, or the
  proxy-addr presets `loopback` / `linklocal` / `uniquelocal`. Hostnames are
  rejected: they would be resolved at request time, and whoever controls that
  resolution would control who is trusted.
- **`TRUSTED_PROXY_HOP_COUNT` was REMOVED** (ADR-0021). It is not merely unread:
  the env schema **refuses to boot** while it is still set, because an operator
  who leaves it configured believes hop-count trust is in force when fastify
  ignores it entirely. Migration: `0` becomes `TRUSTED_PROXY_MODE=socket-only`;
  any non-zero value becomes `TRUSTED_PROXY_MODE=trusted-ranges` plus the real
  proxy addresses in `TRUSTED_PROXY_RANGES`.

### Frontend client-IP relay

The Next portals (`apps/admin`, `apps/client`) proxy browser calls to the
backend server-side, so from the backend's socket the peer is the portal — not
the user. Each egress point relays the inbound client-IP header **verbatim**
via `forwardedForHeaders(inbound)` (`apps/{admin,client}/lib/http/forwardedFor.ts`):
inbound `x-forwarded-for` if present, else inbound `x-real-ip`, else nothing.
It never appends the portal's own hop and never fabricates a value — the
backend's trust decision stays the sole authority. Server Actions read the
inbound headers via `headers()` from `next/headers`.

Under `trusted-ranges` the portal's own address is what must appear in
`TRUSTED_PROXY_RANGES` (it is the backend's immediate peer). Because the relay
is **pass-through** — `forwardedForHeaders` forwards inbound `X-Forwarded-For`
VERBATIM and appends NO hop — the topology invariant below MUST ALSO hold at
each portal's own ingress: the portal's front edge has to strip/overwrite
inbound `X-Forwarded-For` before the portal relays it. Otherwise, if a portal is
directly reachable (or its front edge does not strip inbound XFF) while the
backend runs `trusted-ranges`, an attacker forges XFF at the portal, the portal
relays it verbatim, the backend sees a TRUSTED peer presenting a forged chain,
and the selected entry becomes attacker-controlled — the same leftmost-spoof
bypass the resolver exists to prevent.

### Topology invariant (network precondition — mandatory)

`trusted-ranges` is only sound if **the socket peer is ALWAYS a trusted proxy**
— i.e. the app is not directly reachable from the internet and there is no
alternate path to it. Peer validation is strictly stronger than the hop counting
it replaced (a direct client is now rejected outright rather than being able to
pad the chain), but it is not a substitute for the network control: an attacker
who can occupy an address inside `TRUSTED_PROXY_RANGES` can assert any identity.
Enforce single-ingress-through-the-trusted-edge at the network layer (bind
private / security groups), keep the ranges as narrow as the real proxy set, AND
the trusted edge MUST strip/overwrite inbound `X-Forwarded-For`, `X-Real-IP`,
`Forwarded`. All three, not any one.

Under `socket-only` the invariant is not required for correctness — that model
is spoof-safe on any topology — but without a trusted edge every caller shares
one rate-limit bucket.

---

## Dependency audit record

The record of every accepted security debt in the dependency baseline (ADR-0018) lives in [DEPENDENCY_AUDIT_RECORD.md](DEPENDENCY_AUDIT_RECORD.md), and that document is authoritative. It is read as a file and is not auto-loaded: it grows with every dependency change, and the instruction content a session loads by itself has a size budget ([ADR-0045](../technical/ADR-0045-instruction-context-budget.md)). The record is large, so search it by package name rather than reading it whole.

It holds these sections, moved from this document without a change of wording; a citation of the form `SECURITY_CANON.md §"<title>"` finds its section there:

- `Audited audit-ignores`
- `Ignored GHSAs` (`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`)
- `Ignored image CVEs` (`.trivyignore`)
- `CVE-floor pins` (catalog + override, held at or above the minimal patched version), with its `Floor history`
- `Blocked floors` (a patch we cannot take without a decision)
- `Compatibility pins`
- `Patched dependencies`
- `Override audit`
- `Build-tool version holds & dated-debt overrides`

**The obligation.** A change to a catalog value, an override, an ignored advisory, a patch, a hold or a base image first reads that package's entry in the record (its row and its floor-history note), and records itself there in the same pull request. The rules of the audit are in [dependency-audit-policy.md](dependency-audit-policy.md).

---

## How to extend

Adding new security rules:

1. **New required env var** → add to `apps/api/src/config/env.ts` (Zod schema), update `.env.example` AND `.env.test.example`, document in `docs/architecture/secrets-and-env.md`. If secret, use `z.string().min(32)`.
2. **New sensitive field for logger redaction** → extend `REDACT_PATHS` in `@observability/logger` (`packages/observability/logger/src/index.ts`), the one list the API logger and the packages' base logger apply (case variations explicit — see ADR-0013). Document the threat in `docs/architecture/logging.md`.
3. **New CWE control** → add fitness regex catalog entry in `docs/development/FITNESS_FUNCTIONS.md`; mirror in `.github/workflows/fitness.yml`.
4. **New tenant-scoped model** → see §"Multi-Tenant Isolation" above (3-step checklist).
5. **Amending a rule** → ADR required (see ADR-0001 template).
6. **New rate-limited / IP-gated surface** → derive the client IP ONLY via
   `resolveClientIp(request)`; never read `x-forwarded-for` / `x-real-ip`
   directly, never use `entries[0]`. Prefer an authenticated principal for the
   bucket key when the endpoint is authenticated.
7. **New deployment topology (extra proxy/CDN hop)** → add the new proxy's
   address to `TRUSTED_PROXY_RANGES` for that environment (the list is of
   ADDRESSES, so there is no hop count to re-count and no off-by-one to make),
   keep it as narrow as the real proxy set, and re-verify the topology invariant
   (app unreachable except through the trusted edge; edge strips inbound
   forwarding headers). Never `trust proxy: true`, never a numeric `trustProxy`,
   and never a hand-rolled hop-counting `TrustProxyFunction` (ADR-0021).
8. **Raising a range-scoped CVE floor** → move the BAND and the TARGET in the
   same edit, so the band's exclusive upper bound stays the target
   (`"pkg@<X": X`). Raising only the value leaves the tree resolved to the
   PREVIOUS target — a version the old band no longer selects — so the override
   applies to nothing while the audit record still reads as holding the floor, and
   the audit goes green because the advisory's range stopped matching. Never an
   inclusive bound (`<=W`): it names a different number from the target and
   therefore cannot move with it. A band that genuinely cannot take that shape
   (an advisory whose named patched version was never published; a compatibility pin
   scoped to one major line) is recorded in the allowlist of
   `scripts/testing/override-bands-gate.mjs` with its measured reason, and that
   allowlist may only shrink. It is empty since 2026-10-15, when its last entry,
   `find-my-way@<9.6.1`, left with its override. Enforced by the `Override bands` step of the
   `Dependency Consistency` job.
9. **Patching a dependency** → only by the Maintainer's decision, recorded in its own
   ADR (ADR-0037 is the shape): reproduce a merged upstream change and nothing
   else, key it to the exact version (`pnpm patch <pkg>@<version>`, then
   `pnpm patch-commit`), read the generated file and keep only the intended
   hunks (pnpm lists the edited package through its `files` field, so a file
   the tarball ships outside that field is recorded as deleted; then
   `pnpm install` records the new hash), add its entry to §"Patched dependencies" of the audit record, add
   its record to `scripts/testing/patched-dependencies.json` with a `resolvedBy`
   range whose first stable release ends it (fitness #48 refuses a key without
   one, and the patched-dependencies workflow then watches the registry for it
   every 6 hours until its remove-when fires), and add `COPY patches/ ./patches/`
   to the four Dockerfiles, before `pnpm install`, while any patch exists: pnpm
   reads every patch file on each install. The change that removes a patch
   deletes its file, its key and its record together; fitness #48 refuses any one
   of the three left behind. The change that removes the last one also deletes
   that `COPY` line, because a `COPY` of a missing directory fails the build.

Companion fitness checks live in `docs/development/FITNESS_FUNCTIONS.md §Inventory`:

- `#13` no direct pino · `#14` no per-class cache Maps · `#15` no insecure secret fallbacks · `#16` no `process.env.*` outside `config/env.ts` (api) · `#17` no `process.env.*` outside `lib/env.ts` (Next.js) · `#18` Argon2 only via canonical helper · `#19` no env reads inside provider Adapter classes · `#23` no raw Prisma queries outside guard exceptions · `#28` every Fastify `trustProxy` is the derived `FASTIFY_TRUST_PROXY` (allowlist — blocks `true` AND the now-inert numeric form) · `#29` no raw `x-forwarded-for` / `x-real-ip` reads outside `resolveClientIp` · `#41` single-use claim shape: a `data` consumption marker names its credential in the same call's `where` · `#45` the legal inventories under `docs/legal/` are current and every row is classified (`pnpm check:legal`) · `#48` every patched dependency has its record, its patch file and its ADR (`pnpm check:patched-deps`); the same gate's registry half runs every 6 hours in `patched-dependencies.yml` and opens a `patched-dependency` issue when the release that resolves a patch is published.
