# Security Canon — Reference

**Owner:** Maintainers
**Rules:** [SECURITY_CANON.md](SECURITY_CANON.md). This file holds their rationale, their examples and how to extend them, each under the heading of the section it belongs to.

---

## Multi-Tenant Isolation

Closed via §2.1 of the normalization roadmap ([its last version](https://github.com/edwardricardo/omni-post/blob/3758be3ee3d4274bcc01582b437080732f50d11d/docs/architecture/NORMALIZATION_ROADMAP.md)). The audits are `MULTI_TENANT_AUDIT_<date>.md`; their cadence is in MULTI_TENANT_GUARDS.md §"Audit & rotation".

---

## Rate Limiting — Client-IP Derivation Behind Proxies

`X-Forwarded-For` (XFF) is appended left-to-right: the **leftmost** entry is
the originating client and is **attacker-controlled**; each proxy appends the
address it saw on the **right**. Taking the leftmost entry (or `trust proxy:
true`, or a standalone `X-Real-IP`) lets any client spoof its identity, rotate
buckets per request, and defeat the limiter — a recognized, exploited threat
class (CVE-2025-59152 Litestar, CVE-2023-49952 Mastodon, CVE-2026-55501
9router; CWE-807 / CWE-290 / CWE-348).

### The rule

**Why a number trusts nothing:** since fastify 5.12.1 `getTrustProxyFn` returns `() => false` for a numeric `trustProxy` ("Hop-count-only trust cannot validate the immediate peer" — GHSA-3m5p-2c4r-xxw2), so a hop count trusts _nothing_ while still reading like configuration.

**Why a hop-counting function restores the vulnerability:** `(addr, hop) => hop < N` type-checks, keeps every test green, and deliberately restores the exact vulnerability the advisory patched.

**Why a standalone `X-Real-IP` cannot be validated:** It is a single value with no chain, so it cannot be validated against the peer; a directly-connected client can forge it. Ignore it unless the trusted edge is known to overwrite it, and even then prefer the XFF chain.

**What `request.url` keeps:** `request.url` keeps the query string, a fragment, percent-encoding and an absolute-form target, all of which reach the same handler, so a key or rule read from it lets each variant mint a fresh bucket or fall to the default rule.

**What an ungoverned rule costs:** so a rule named after an endpoint that does not exist, or whose every route an earlier rule takes, caps nothing while it reads as protection. `apps/api/tests/unit/security/httpRateLimitRuleCoverage.test.ts` holds `STANDARD_ROUTE_RULES` and `EXPENSIVE_ENDPOINT_RULES` to the registered route table (the committed OpenAPI projection of `createApp()` that the CI API-types drift gate keeps current) and fails on either case.

### Frontend client-IP relay

**The attack through a directly reachable portal:** Otherwise, if a portal is directly reachable (or its front edge does not strip inbound XFF) while the backend runs `trusted-ranges`, an attacker forges XFF at the portal, the portal relays it verbatim, the backend sees a TRUSTED peer presenting a forged chain, and the selected entry becomes attacker-controlled — the same leftmost-spoof bypass the resolver exists to prevent.

---

## Dependency audit record

The record of every accepted security debt in the dependency baseline (ADR-0018) is [DEPENDENCY_AUDIT_RECORD.md](DEPENDENCY_AUDIT_RECORD.md), and it is authoritative. It is large: search it by package name, never read it whole.

**The obligation.** A change to a catalog value, an override, an ignored advisory, a patch, a hold or a base image first reads that package's entry in the record (its row and its floor-history note), and records itself there in the same pull request. The rules of the audit are in [dependency-audit-policy.md](dependency-audit-policy.md).

A citation of the form `SECURITY_CANON.md §"<title>"` finds its section in the record for these titles: `Audited audit-ignores`, `Ignored GHSAs`, `Ignored image CVEs`, `CVE-floor pins` (with its `Floor history`), `Blocked floors`, `Compatibility pins`, `Patched dependencies`, `Override audit`, `Build-tool version holds & dated-debt overrides`.

---

## How to extend

1. **New env variable** → §Secrets and Environment. A secret this project generates is `z.string().min(SECRET_MIN)`; document the variable in `docs/architecture/secrets-and-env.md`.
2. **New sensitive field for logger redaction** → extend `REDACT_PATHS` in `@observability/logger` (`packages/observability/logger/src/index.ts`), with its case variations (ADR-0013), and document the threat in `docs/architecture/logging.md`.
3. **New CWE control** → a fitness check: its block in `docs/development/FITNESS_FUNCTIONS.md` and its step in `.github/workflows/fitness.yml`.
4. **New tenant-scoped model** → §Multi-Tenant Isolation, the three steps.
5. **Amending a rule** → ADR required, in the shape of the latest ones.
6. **New rate-limited or IP-gated surface** → §Rate Limiting, "The rule".
7. **New deployment topology (an extra proxy or CDN hop)** → add the proxy's address to `TRUSTED_PROXY_RANGES` for that environment, as narrow as the real proxy set, and re-verify the topology invariant.
8. **Raising a range-scoped CVE floor, or patching a dependency** → [dependency-audit-policy.md](dependency-audit-policy.md).

Companion fitness checks live in `docs/development/FITNESS_FUNCTIONS.md §Inventory`:

- `#13` no direct pino · `#14` no per-class cache Maps · `#15` no insecure secret fallbacks · `#16` no `process.env.*` outside `config/env.ts` (api) · `#17` no `process.env.*` outside `lib/env.ts` (Next.js) · `#18` Argon2 only via canonical helper · `#19` no env reads inside provider Adapter classes · `#23` no raw Prisma queries outside guard exceptions · `#28` every Fastify `trustProxy` is the derived `FASTIFY_TRUST_PROXY` (allowlist — blocks `true` AND the now-inert numeric form) · `#29` no raw `x-forwarded-for` / `x-real-ip` reads outside `resolveClientIp` · `#41` single-use claim shape: a `data` consumption marker names its credential in the same call's `where` · `#45` the legal inventories under `docs/legal/` are current and every row is classified (`pnpm check:legal`) · `#48` every patched dependency has its record, its patch file and its ADR (`pnpm check:patched-deps`); the same gate's registry half runs every 6 hours in `patched-dependencies.yml` and opens a `patched-dependency` issue when the release that resolves a patch is published.
- `#39` every model that carries `accountId` is enrolled in the tenant guard or listed as global.
