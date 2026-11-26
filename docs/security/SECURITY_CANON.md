# Security Canon — Secrets · Multi-Tenant Isolation · Client IP · Literal Parameters · Dependency Audit

**Owner:** Maintainers
**Reference:** [SECURITY_CANON_REFERENCE.md](SECURITY_CANON_REFERENCE.md), read as a file: the rationale, the examples and how to extend these rules.

---

## Secrets and Environment

**All env access goes through a typed `env` constant: never `process.env.X` directly, never `process.env.X || "fallback"`.**

| Deployable     | Env module                       | Library              |
| -------------- | -------------------------------- | -------------------- |
| `apps/api`     | `apps/api/src/config/env.ts`     | `@t3-oss/env-core`   |
| `apps/workers` | `apps/workers/src/config/env.ts` | `@t3-oss/env-core`   |
| `apps/admin`   | `apps/admin/lib/env.ts`          | `@t3-oss/env-nextjs` |
| `apps/client`  | `apps/client/lib/env.ts`         | `@t3-oss/env-nextjs` |

Each module validates `process.env` with Zod once, at module load, and the app refuses to boot on a missing or malformed key. There is no warn-and-continue.

- **Read a value:** `import { env } from ".../env.js"`, then `env.MY_VAR`.
- **Add a variable (api, workers):** the server schema of the module (`serverSchema` in the api, the `server` block in the workers), plus `.env.example` and `.env.test.example`.
- **Add a variable (Next.js):** server-only in `server`, browser-exposed in `client` (the key starts with `NEXT_PUBLIC_`), and every key in `runtimeEnv`.
- **No fallback for a secret** (CWE-798), in either form: `process.env.X || "dev"`, or `env.X ?? ""` on a secret the schema marks optional, which boots with an empty string that reads as configured. An unconfigured secret is an absent optional field, never `""`.
- **Conditional secret** (Stripe): the schema marks it optional, and the factory that needs it throws at construction.
- **Runtime-mutable allowlist (non-secret):** a factory function that takes the allowlist as a parameter (`makeMediaUrlSchema`).
- **Tests:** values come from the root `.env.test`; a test does not assign `process.env` at run time.
- **On disk:** the root `.env` for development and the root `.env.test` for tests. No per-app env file.
- **Browser bundle:** a server-only variable read from a client component throws at run time (`@t3-oss/env-nextjs`), so the leak surfaces before it reaches a user.

Held by fitness #15 (no secret fallback, in `apps/api/src`, `apps/workers/src` and `packages/providers/*/src`), #16 (no `process.env` in `apps/api/src` outside `config/env.ts`), #17 (the same in the Next.js apps, outside `lib/env.ts`) and #19 (no env read in a provider adapter class).

Rationale and threat model: [docs/architecture/secrets-and-env.md](../architecture/secrets-and-env.md). Where every secret lives and how to rotate it: [docs/security/SECRETS.md](SECRETS.md).

---

## Multi-Tenant Isolation

**Three layers hold it.**

1. **Guard** (`infra/prisma/src/extensions/tenantGuard.ts`): on a model of `TENANT_SCOPED_MODELS` it injects `where.accountId` from the bound `TenantContext`, throws on an `accountId` that differs from it, and throws `TenantContextMissingError` when no context is bound.
2. **Row Level Security:** the `tenant_isolation` policy of each table compares `accountId` with the `app.account_id` GUC, which `tenantGucBinding.ts` binds for every model operation and a unit of work binds for its transaction.
3. **Fitness #23:** no raw query (`$queryRaw`, `$executeRaw` and their `Unsafe` forms) outside the listed exceptions. Raw SQL bypasses layer 1.

- **Cross-tenant work** runs inside `withSystemContext(reason, fn)` (`apps/api/src/security/tenantContext.ts`), never around the guard.
- **A worker** runs the raw client, with no guard: every query carries an explicit `accountId` predicate and binds the GUC with `setTenantGuc` in the same transaction.

**A new model that carries `accountId`:**

1. Add its lowerCamel name to `TENANT_SCOPED_MODELS`.
2. Add a forward migration `add_rls_<model>` that enables row security and creates the `tenant_isolation` policy. The base migration is never edited.
3. Record it in [MULTI_TENANT_GUARDS.md](MULTI_TENANT_GUARDS.md). A model that is global by design (`AuditLog`, `DeletionRecord`) is recorded there as global and stays out of the set.

Fitness #39 holds step 1 to the schema: every model that carries `accountId` is in the set or in the table of global models of MULTI_TENANT_GUARDS.md. `rls-tenant-isolation.integration.test.ts` holds steps 1 and 2 to each other: every model of the set has its policy.

Strategy, the table lists and the runbooks: [docs/security/MULTI_TENANT_GUARDS.md](MULTI_TENANT_GUARDS.md).

---

## Rate Limiting — Client-IP Derivation Behind Proxies

**A rate-limit or IP-allowlist key is derived from a trusted segment of the proxy chain, never from a value the client controls.** The leftmost `X-Forwarded-For` entry is the client's own claim.

### The rule

- **One resolver.** Every client IP used for a security decision (rate limit, IP allowlist, brute-force throttle) comes from `resolveClientIp(request)` (`apps/api/src/security/resolveClientIp.ts`). No route, middleware or pre-handler reads `x-forwarded-for` or `x-real-ip` (fitness #29), and none takes `entries[0]`.
- **Trust follows the immediate peer's address, never a hop count.** Two models exist, `socket-only` and `trusted-ranges`, and nothing else.
- **Fail toward the socket peer.** When the peer is not a configured proxy, or the selected token is not a valid IP, the answer is `request.socket.remoteAddress`.
- **`trustProxy` is `FASTIFY_TRUST_PROXY` and nothing else** (fitness #28, an allowlist): never `true`, which trusts the leftmost entry; never a number, which fastify reads as "trust nothing" since 5.12.1; never a hand-written `TrustProxyFunction` that counts hops. No exception and no marker (ADR-0021).
- **A standalone `X-Real-IP` is not trusted:** it has no chain to validate against the peer.
- **Prefer an authenticated principal to the IP.** On an authenticated endpoint, key by the user or the account id; an IP key is for unauthenticated traffic.
- **The rule and the bucket key come from the matched route, never from `request.url`.** `createHttpRateLimitPreHandler` selects the rule by `request.routeOptions.url` and keys by client IP plus that pattern with the parsed parameter values; a request no route matched shares one per-IP `!unrouted` bucket.
- **Every rule governs a registered route.** A rule's `path` is a prefix of a route pattern, not of a URL. `httpRateLimitRuleCoverage.test.ts` fails on a rule that matches no registered route or whose every route an earlier rule takes.

### The two trust models

`TRUSTED_PROXY_MODE` selects one; there is no third option and no implicit fallback between them.

- **`socket-only`** (the default; `trustProxy` is `false`): the key is the socket peer and every forwarding header is ignored. Always spoof-safe. Behind a proxy every caller shares one bucket: an availability risk, never a bypass.
- **`trusted-ranges`** (`trustProxy` is the range list): the key is the address a trusted proxy vouched for. Per-client buckets, correct only while the ranges list real proxies and only real proxies.

**The interlock.** `trusted-ranges` with an absent, empty or malformed `TRUSTED_PROXY_RANGES` refuses to boot, and so does `socket-only` with ranges set: neither degrades quietly to the other. The env schema rejects both pairs (`createFinalSchema` in `apps/api/src/config/env.ts`), and `TrustedProxyPolicy` carries the ranges as a non-empty tuple, so the first pair is not a value the program can hold.

**Range breadth is the whole security boundary.** Every address inside `TRUSTED_PROXY_RANGES` may assert any client identity in `X-Forwarded-For`. List individual proxy addresses or the tightest CIDR that covers them, never a tenant or workload subnet.

**The list lives in env, never in a runtime-mutable table** such as `SecuritySettings.ipAllowlist`: an entry added there could assert any client identity and defeat the limiter and the allowlist together. The reasons are in ADR-0021 §Rationale.

### `resolveClientIp` contract

`resolveClientIp(request)` returns one normalized, stable bucket key. It is the socket peer under `socket-only`, and under `trusted-ranges` when the peer is not a trusted proxy or the address it reported (`request.ip`) is not a valid IP; otherwise it is that reported address. With no socket address the key is `"unknown"`. `resolveClientAddress` is the same decision returning `{ ip, source }`: `forwarded` when a trusted proxy reported an address other than its own, `peer` in every other branch.

- **Normalization is load-bearing.** `normalizeIp` (through `ipaddr.js`) strips a port suffix and an IPv6 zone, collapses an IPv4-mapped address and returns one representation. Without it a caller varies the port or the IPv6 spelling to mint a fresh bucket.
- **The resolver reads no forwarding header under either model:** `ClientIpRequest` carries no `headers`.

### `@fastify/proxy-addr` divergence

- **The resolver's `isTrustedPeer` check stays, although it is redundant today.** Under `trusted-ranges` proxy-addr walks the chain right to left and stops at the first address outside the ranges, so it already agrees with the check. The resolver states the invariant itself instead of inheriting it from a dependency, and a test holds it against an adversarial `request.ip`. Do not delete it as redundant.
- **One divergence is real and deliberately unguarded.** When every address behind the leftmost entry is inside the trusted ranges, proxy-addr returns the leftmost, client-controlled value. That request cannot be told from the legitimate single hop (`XFF=[client]` behind a trusted edge), so no sound per-request guard exists: the defence is range breadth and the topology invariant. The parity test pins both behaviours.

### `TRUSTED_PROXY_MODE` / `TRUSTED_PROXY_RANGES` env convention

- **The default assumes no topology.** `TRUSTED_PROXY_MODE` defaults to `socket-only`; never ship a default that assumes a proxy exists.
- **`TRUSTED_PROXY_RANGES`** is a comma-separated list of IPs, CIDRs or the proxy-addr presets `loopback`, `linklocal` and `uniquelocal`. A hostname is rejected: it would be resolved at request time, and whoever controls that resolution would control who is trusted.
- **`TRUSTED_PROXY_HOP_COUNT` is refused at boot while it is set** (ADR-0021): fastify ignores a hop count, so a deployment that still carries the variable misstates its own trust. The refusal message names the replacement.

### Frontend client-IP relay

The portals (`apps/admin`, `apps/client`) call the backend server-side, so the backend's socket peer is the portal, not the user.

- **Every server-side call to the backend relays the inbound client-IP header verbatim** through `forwardedForHeaders(inbound)` (`apps/{admin,client}/lib/http/forwardedFor.ts`); a Server Action reads the inbound headers with `headers()` from `next/headers`. The relay never appends the portal's own hop and never fabricates a value: the backend's trust decision is the sole authority.
- **Under `trusted-ranges` the portal's address is the one listed in `TRUSTED_PROXY_RANGES`**, and the topology invariant holds at each portal's own ingress too: its front edge strips or overwrites inbound `X-Forwarded-For` before the portal relays it. A portal that is directly reachable hands the backend a forged chain from a trusted peer.

### Topology invariant (network precondition — mandatory)

`trusted-ranges` is sound only while **the socket peer is always a trusted proxy**. Three conditions hold together, not any one of them:

1. **Single ingress.** The app is reachable only through the trusted edge, enforced at the network layer (private bind, security groups), with no alternate path.
2. **Narrow ranges.** The ranges are as narrow as the real proxy set: whoever occupies an address inside `TRUSTED_PROXY_RANGES` can assert any identity.
3. **A stripping edge.** The trusted edge strips or overwrites inbound `X-Forwarded-For`, `X-Real-IP` and `Forwarded`.

Under `socket-only` the invariant is not needed for correctness: that model is spoof-safe on any topology.

---

## Literal security parameters

**A literal security value is written with the primary source that justifies it.** The value is an Argon2 cost, a JWT algorithm, an OAuth scope list, a CSP directive, a CORS origin, a cookie flag or a rate-limit threshold. The source (an RFC, a specification, the maintainers' documentation, OWASP) is cited in the JSDoc beside the value, as `apps/api/src/auth/passwordHashing.ts` does, or in the ADR that decided it.

- Never a library default taken as it comes, and never a copy from another file.
- With no source, the Maintainer decides.

---

## Dependency audit record

Before a dependency is added or updated, or a catalog value, an override, an ignored advisory, a patch, a hold or a base image changes, read [dependency-audit-policy.md](dependency-audit-policy.md) and that package's entry in [DEPENDENCY_AUDIT_RECORD.md](DEPENDENCY_AUDIT_RECORD.md), which holds the sections cited as `SECURITY_CANON.md §"<title>"`.
