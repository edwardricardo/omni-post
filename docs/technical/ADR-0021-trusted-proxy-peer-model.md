# ADR-0021: Trusted-proxy peer model — replace hop counting with an interlocked IP/CIDR allowlist

- **Status**: Accepted
- **Date**: 2026-09-04
- **Deciders**: Edward Velasquez, Platform engineering

## Context

`fastify@5.12.1` patches two moderate advisories: GHSA-w2qp-rph6-63g4 (schema
validation bypass) and GHSA-3m5p-2c4r-xxw2 (`X-Forwarded-*` spoofing under a
hop-count `trustProxy`). The second patch does not harden hop counting — it
**deletes** it. Verified against the published tarball rather than the release
notes:

<!-- prettier-ignore -->
```text
// fastify@5.12.1 lib/request.js  (verbatim — do not reformat)
  if (typeof tp === 'number') {
    // Hop-count-only trust cannot validate the immediate peer. Fail closed so
    // direct clients cannot spoof X-Forwarded-* values by supplying enough hops.
    return function () { return false }
  }
```

`number` was dropped from the `trustProxy` type in the same release
(`trustProxy?: boolean | string | string[] | TrustProxyFunction`).

This repo passed `trustProxy: env.TRUSTED_PROXY_HOP_COUNT` and read the
proxy-addr-resolved `request.ip` in `resolveClientIp`. Measured impact of a
straight bump, before any code change:

| Claim                                    | Method                                                | Result                                                                                                                                                                        |
| ---------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request.ip` degrades to the socket peer | `resolveClientIp.parity.test.ts` against real Fastify | **5 of 6** assertions red; every `native` value became the socket `10.0.0.1`                                                                                                  |
| Build breaks                             | `tsc -b apps/api --force`                             | **9 errors**, all in `index.ts`, all cascading from the one `Fastify({ trustProxy: number })` call poisoning the instance's generic inference                                 |
| Severity                                 | reasoning + tests                                     | Fails **closed**: availability (every caller collapses into the proxy's shared rate-limit bucket at hop >= 1), never a bypass. A **no-op** at the fail-closed default of `0`. |

So the floor was reachable but not free: taking it required choosing a
replacement trust model. It was parked in `SECURITY_CANON.md §"Blocked floors"`
rather than silently ignored or `ignoreGhsas`-suppressed.

The forbidden shortcut, named explicitly so it stays forbidden: re-implementing
`(address, hop) => hop < N` as a `TrustProxyFunction` would type-check, keep
every test green, and **deliberately restore the exact vulnerability the
advisory patched**. Security canon allows no `canon-exception` marker for it.

## Decision

Implement **both** viable models behind one switch, with the second gated on its
precondition.

- **`socket-only`** (default) — `trustProxy: false`. Every forwarding header is
  ignored; the bucket key is the socket peer. Always spoof-safe; behind a proxy
  every caller shares one bucket.
- **`trusted-ranges`** — `trustProxy: string[]`. `proxy-addr` compiles the list
  and validates the **immediate peer**, which is the capability the advisory
  says hop counting lacks. Per-client buckets survive.

**The interlock.** `trusted-ranges` is selectable ONLY when at least one valid
range is configured. Enforced twice, at two different kinds of boundary:

1. **Boundary rejection** — `createFinalSchema`'s `superRefine` in
   `apps/api/src/config/env.ts` refuses to boot on either inconsistent pair:
   `trusted-ranges` without usable ranges, and `socket-only` **with** ranges
   (a list that is believed but never consulted).
2. **Unrepresentable state** — `TrustedProxyPolicy`'s `trusted-ranges` variant
   carries `readonly [string, ...string[]]`, a non-empty tuple. `{ mode:
"trusted-ranges", ranges: [] }` is not a value the program can hold; the
   compiler rejects it. This is the substantive half: a runtime check can be
   skipped by a new caller, a type cannot.

Configuration lives in **env** (`TRUSTED_PROXY_MODE`, `TRUSTED_PROXY_RANGES`),
Zod-validated, fail-fast.

`TRUSTED_PROXY_HOP_COUNT` is **removed**, and its continued presence is a **boot
refusal**, not a silent ignore.

## Rationale

**Why B and not A.** A (socket-only everywhere) is cheapest and strictly
spoof-safe, but it permanently discards per-client rate limiting for any
deployment with a trusted edge — converting a security fix into an availability
regression. B is the model the advisory itself steers toward, and A remains
available as the default and as an incident fallback, so B costs nothing that A
offers.

**Why the interlock, rather than defaulting.** If `trusted-ranges` fell back to
`socket-only` when ranges were missing, a typo would silently produce a
permanent, invisible loss of per-client buckets — indistinguishable from correct
operation until someone measured limiter behaviour. Refusing to boot converts an
invisible degradation into a loud, immediate failure.

**Why the reverse pair is also refused.** `socket-only` with ranges set reads to
an operator as though the list is consulted. It fails toward safety, but it
misrepresents the deployment, which is the same class of defect as the removed
variable.

**Why env and NOT the existing `SecuritySettings.ipAllowlist` DB pattern.** This
was considered and rejected; the reasoning is recorded here and in
`SECURITY_CANON.md` so nobody later "fixes" the inconsistency. The two lists have
the same shape and the **opposite risk direction**:

|               | `ipAllowlist`    | trusted-proxy ranges                              |
| ------------- | ---------------- | ------------------------------------------------- |
| Declares      | who may enter    | whom to believe about **someone else's** identity |
| A wrong entry | locks people out | believes a liar                                   |
| Fails toward  | denial           | **impersonation**                                 |

A hostile address added to a runtime-mutable trusted-proxy table could then
assert any `X-Forwarded-For` value — defeating the rate limiter **and** the
`ipAllowlist` stored in that same table, in one move. Proxy topology is also a
deployment fact, not a tenant preference: it changes with infrastructure, not
with customer settings.

**Why removing `TRUSTED_PROXY_HOP_COUNT` loudly.** t3-env ignores undeclared
keys, so simply deleting it would leave every existing deployment booting fine
with the variable still set — an operator reading that config would conclude
hop-count trust is in force when fastify ignores it entirely. The env schema
therefore refuses to boot while it is present (including at its old safe value
`0`), with a message naming the replacement. A stale security variable that
silently does nothing is its own trap.

## Alternatives Considered

- **(A) Socket-only, fail-closed everywhere.** Rejected as the _only_ model: it
  discards per-client rate limiting for every proxied deployment. **Retained as
  the default and the incident fallback**, so nothing is lost.
- **Hop counting via a hand-rolled `TrustProxyFunction`.** Rejected outright —
  restores the patched vulnerability behind a green build. Explicitly forbidden
  in canon and now blocked by fitness #28.
- **Casting the number past the type.** Rejected — hides a live runtime
  behaviour change behind a compiling build.
- **Staying on 5.10.0.** Rejected — leaves two reachable moderates open on a
  live production dependency.
- **Ranges in `SecuritySettings` (DB).** Rejected — see the risk-direction table
  above.
- **A per-request guard against the "fully trusted chain" case.** Rejected as
  unsound; see Consequences.

## Consequences

- Two moderates closed; `fastify` floor raised to `5.12.1`; §"Blocked floors" is
  now empty.
- `tsc -b apps/api`: 9 errors -> 0.
- `resolveClientIp`'s second parameter changes from `trustedHops: number` to
  `policy: TrustedProxyPolicy`. One call site passed it explicitly
  (`customerAuthRoutes.ts`) and now relies on the default, so a route cannot
  drift from the deployment's model.
- `ClientIpRequest` drops `headers`: under both models the resolver parses no
  forwarding header itself.
- **The parity test was rewritten, not repaired.** It locked
  `request.ip === xff[len - hops]` — a contract deleted upstream, not broken by
  this change. It now pins the trusted-peer behaviour AND pins numeric
  `trustProxy` as socket-resolving, so nobody restores hop counting believing it
  works.
- Fitness **#28** is inverted: its old premise ("`trustProxy` MUST be the numeric
  `TRUSTED_PROXY_HOP_COUNT`") is now exactly backwards. It becomes an allowlist —
  every `trustProxy:` in scope must be the derived `FASTIFY_TRUST_PROXY`. Proven
  red both ways: the old check **passes** `trustProxy: 2` while the new one fails
  it.
- **An honest residual.** Under `trusted-ranges`, when every address behind the
  leftmost entry is inside the ranges, proxy-addr returns the leftmost,
  client-controlled value. This is indistinguishable per-request from the
  legitimate single-hop case (`XFF=[client]` behind a trusted edge also returns
  the leftmost entry), so no sound per-request guard exists. Its defence is
  **range breadth** plus the topology invariant, stated plainly in canon rather
  than papered over with a check that cannot actually decide. Peer validation is
  still strictly stronger than the hop counting it replaced.

## Revisit if

- fastify changes `proxy-addr`'s trusted-peer walk (the resolver's own peer check
  exists for exactly this).
- A deployment needs per-tenant proxy topology — which would be the first real
  argument for moving ranges out of env, and would need its own ADR addressing
  the impersonation risk direction.
- Rate limiting moves to per-principal keying for authenticated routes, which
  would shrink IP keying to unauthenticated traffic and reduce the blast radius
  of `socket-only`'s shared bucket.

## Risks and Mitigations

| Risk                                                                        | Mitigation                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Over-broad ranges hand impersonation power to everything inside them        | Canon rule: list individual proxies or the tightest covering CIDR, never a tenant/workload subnet. Called out at the range definition and in §Rate Limiting. |
| Operator upgrades with `TRUSTED_PROXY_HOP_COUNT` still set                  | Boot refusal naming the replacement, tested at both `2` and the old safe `0`.                                                                                |
| `socket-only` default surprises a proxied deployment with one shared bucket | Documented as the accepted cost of the fail-closed default; the follow-up topology display below makes it visible.                                           |
| Someone "simplifies" the resolver by deleting the now-redundant peer check  | The redundancy is documented as deliberate in-file and in canon, and is covered by tests that feed an adversarial `request.ip`.                              |

## Follow-up (not in this change)

- Read-only display of the effective topology (mode + ranges) on an operator
  surface, so a misconfigured deployment is visible without reading env.
- `openspec/specs/client-ip-rate-limit/spec.md` still describes the hop-count
  selection and needs re-specification against this model.

## References

- fastify 5.12.1 `lib/request.js` `getTrustProxyFn` (verified from the published tarball)
- GHSA-3m5p-2c4r-xxw2, GHSA-w2qp-rph6-63g4
- `@fastify/proxy-addr` 5.1.0 `alladdrs` / `compile`
- `docs/security/SECURITY_CANON.md` §"Rate Limiting", §"Blocked floors"
- ADR-0018 (dependency-freshness canon; minimal patched version rule)
- `apps/api/src/security/trustedProxy.ts`, `apps/api/src/security/resolveClientIp.ts`, `apps/api/src/config/env.ts`
- CWE-807 / CWE-290 / CWE-348
