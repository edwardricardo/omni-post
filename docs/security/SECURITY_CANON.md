# Security Canon — Secrets & Environment

> Authoritative security rules for omni-post. Auto-loaded via
> `@docs/security/SECURITY_CANON.md` in CLAUDE.md.

**Owner:** Platform engineering
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

- **Fail-fast required, no fallbacks for secrets** (CWE-798). CI fitness greps #15 + #16 + #17 enforce this in `apps/api/src`, `apps/workers/src`, and the Next.js apps respectively.
- **Single source of truth on disk**: root `.env` for dev, root `.env.test` for tests. Per-app `.env`s were removed.
- **Browser bundle leak prevention**: Next.js `clientPrefix: "NEXT_PUBLIC_"` enforced — referencing a server-only env var (e.g. `env.SENTRY_DSN`) from a client component throws at runtime via `onInvalidAccess`, surfacing the leak before it reaches users.

Full secrets architecture rationale: [docs/architecture/secrets-and-env.md](../architecture/secrets-and-env.md).
Operational reference (where every secret lives + how to rotate it): [docs/security/SECRETS.md](SECRETS.md).

---

## Multi-Tenant Isolation

Closed via §2.1 of the Normalization Roadmap. Layer 1 (Prisma `$extends` guard) auto-injects `accountId` on tenant-scoped queries; layer 2 (PostgreSQL RLS) gates rows by `app.account_id` GUC bound at tx start by `PrismaUnitOfWork`; layer 3 (fitness #23) blocks raw queries outside the guard. Full strategy + 50-table list + runbooks in [docs/security/MULTI_TENANT_GUARDS.md](MULTI_TENANT_GUARDS.md). The recurring audit cadence lives in `MULTI_TENANT_AUDIT_<date>.md`.

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
- **Trust a fixed number of proxy hops, counted from the RIGHT (the trusted
  edge), never from the left.** The number of trusted reverse proxies between
  the internet and this app is `TRUSTED_PROXY_HOP_COUNT`.
- **Fail toward the socket peer, never toward a client entry.** When XFF is
  absent, shorter than expected, or the selected token is not a valid IP,
  resolve to `request.socket.remoteAddress` — never `entries[0]`.
- **Never `trust proxy: true` / Fastify `trustProxy: true`.** Set Fastify
  `trustProxy` to the numeric `TRUSTED_PROXY_HOP_COUNT` so `request.ip` is
  resolved by `@fastify/proxy-addr` (battle-tested; handles IPv6/ports/multi-header).
  `resolveClientIp` is a thin normalizer over `request.ip` **plus** the
  fail-closed guards below.
- **Standalone `X-Real-IP` is NOT trusted** on the backend. It is a single
  value with no chain, so hop-counting cannot validate it; a directly-connected
  client can forge it. Ignore it unless the trusted edge is known to overwrite
  it, and even then prefer XFF hop-counting.
- **Prefer an authenticated principal over IP when one exists.** For
  authenticated endpoints, key by user / account id; reserve IP-based keys for
  unauthenticated traffic (OWASP).

### `resolveClientIp` contract

Selection (equivalent to MDN "rightmost minus (count-1)" and proxy-addr
numeric-hop semantics):

```
resolveClientIp(request) -> string   // normalized IP, stable bucket key
  hops   = TRUSTED_PROXY_HOP_COUNT
  socket = normalize(request.socket.remoteAddress)   // fail-closed target
  xff    = all "x-forwarded-for" header instances, joined in order,
           split on ",", trimmed (OWS), empties dropped
  if hops == 0            -> return socket           // no trusted proxy
  if xff.length <  hops   -> return socket           // chain shorter than expected
  candidate = normalize(request.ip)                  // proxy-addr already selected xff[len - hops]
  return isValidIp(candidate) ? candidate : socket   // unknown/obfuscated -> socket
```

`normalize` MUST, via `ipaddr.js`: strip a port suffix (bracket-aware for
`[2001:db8::1]:443`; also plain `1.2.3.4:5678` from Azure App Gateway et al.),
canonicalize IPv6 (`::ffff:` IPv4-mapped, case, drop `%zone`), and return a
single stable representation. Normalization is load-bearing: without it an
attacker varies the port or IPv6 spelling to mint a fresh bucket — the same
bypass class as the leftmost-entry bug.

### `@fastify/proxy-addr` divergence — WHY the resolver adds its own guards

Fastify's numeric `trustProxy` compiles to `(_addr, i) => i < hops`. For the
happy path (`xff.length >= hops`) `request.ip` is exactly `xff[len - hops]`
(the trusted-edge entry) — verified empirically. BUT when the chain is
**shorter** than `hops`, `@fastify/proxy-addr` walks off the end of the chain
and returns the **leftmost (client-controlled) XFF entry**, NOT the socket. A
pure `normalize(request.ip)` would therefore inherit the exact spoof it aims to
prevent. `resolveClientIp` closes this by explicitly counting the XFF entries
and failing to the socket whenever `hops == 0` or `xff.length < hops`, using
`request.ip` only on the proven-safe happy path. This guard is MERGE-BLOCKING;
a parity test locks the equivalence and the divergence.

### `TRUSTED_PROXY_HOP_COUNT` env convention

- Lives in `apps/api/src/config/env.ts` (Zod, `z.coerce.number().int().min(0)`),
  parsed once at boot. No silent default that assumes a topology.
- **The value MUST equal the real number of trusted reverse proxies for THIS
  deployment.** 1 = one edge proxy (e.g. nginx/CDN) in front; 2 = CDN → LB; etc.
- **Fail-closed default is `0`** (socket-only): always spoof-safe, but behind a
  proxy it degrades every user to the proxy's shared bucket (an availability
  risk, never a bypass). Set the real value explicitly per environment; do not
  ship a non-zero default, which bakes in an unverified topology assumption.
  Homelab (client → Next portal direct, no trusted edge) correctly stays at
  socket = shared bucket; production sets the real edge-hop count.

### Frontend client-IP relay

The Next portals (`apps/admin`, `apps/client`) proxy browser calls to the
backend server-side, so from the backend's socket the peer is the portal — not
the user. Each egress point relays the inbound client-IP header **verbatim**
via `forwardedForHeaders(inbound)` (`apps/{admin,client}/lib/http/forwardedFor.ts`):
inbound `x-forwarded-for` if present, else inbound `x-real-ip`, else nothing.
It never appends the portal's own hop and never fabricates a value — the
backend's hop-count math stays the sole authority. Server Actions read the
inbound headers via `headers()` from `next/headers`.

Because the relay is **pass-through** — `forwardedForHeaders` forwards inbound
`X-Forwarded-For` VERBATIM and appends NO hop — the topology invariant below
MUST ALSO hold at each portal's own ingress: the portal's front edge has to
strip/overwrite inbound `X-Forwarded-For` before the portal relays it.
Otherwise, if a portal is directly reachable (or its front edge does not strip
inbound XFF) while the backend runs `TRUSTED_PROXY_HOP_COUNT >= 1`, an attacker
forges XFF at the portal, the portal relays it verbatim, and the backend's
rightmost-counted entry becomes attacker-controlled — the same leftmost-spoof
bypass the resolver exists to prevent.

### Topology invariant (network precondition — mandatory)

Hop-counting is only sound if **the socket peer is ALWAYS a trusted proxy** —
i.e. the app is not directly reachable from the internet and there is no
shorter alternate path to it. If a client can reach the app with fewer hops
than configured, NO `TRUSTED_PROXY_HOP_COUNT` value is safe (they spoof the
missing hops). Enforce single-ingress-through-the-trusted-edge at the network
layer (bind private / security groups) AND the trusted edge MUST
strip/overwrite inbound `X-Forwarded-For`, `X-Real-IP`, `Forwarded`. Both, not
either.

---

## Audited audit-ignores

> Authoritative record of every accepted security debt in the dependency baseline (ADR-0018). Two classes: **ignored GHSAs** (a `pnpm audit` advisory we accept on a transitive with no safe upstream) and **CVE-floor pins** (a catalog/override entry held AT or ABOVE the minimal patched version to keep a known vulnerability out of the tree). Each carries a remove-when so the debt is auditable, not silent. The former standing-backlog mirror (`PENDING_WORK_INVENTORY §7`) is frozen (`docs/archive/PENDING_WORK_INVENTORY.md`); its build-tool holds now live in §"Build-tool version holds & dated-debt overrides" below — this file is their canonical home.

### Ignored GHSAs (`auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`)

> Location note (ADR-0019): pnpm 11 no longer reads the `pnpm` field in `package.json`, so this allowlist moved verbatim from root `package.json` to `pnpm-workspace.yaml`. The 3 GHSAs below are unchanged.

| GHSA                  | Package (chain)                                | Severity | Reason kept                                                                | Remove-when                                               |
| --------------------- | ---------------------------------------------- | -------- | -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GHSA-q7cg-457f-vx79` | `request` (`wait-on` → `jest-process-manager`) | —        | transitive; no fixed upstream that satisfies the consumer's `wait-on ^7`   | `jest-process-manager` ships `wait-on ^8`                 |
| `GHSA-p8p7-x288-28g6` | `request` SSRF                                 | medium   | transitive; ties to §2E SSRF-WEBHOOK — no direct exploit surface confirmed | the `request`-bearing dep is replaced or upstream patches |
| `GHSA-848j-6mx2-7j84` | `elliptic` risky-curve                         | low      | transitive (crypto chain); no signing path uses the affected curve         | the consuming dep bumps `elliptic`                        |

### CVE-floor pins (catalog + override, held at or above the minimal patched version)

| Package                            | Floor                        | Where                                                        | Why (CVE floor)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axios`                            | `1.18.0`                     | catalog (`catalog:` override)                                | DIRECT (providers/tiktok) + CVE floor; override extends the floor to transitive copies. Raised 2026-07-20: 1.18.0 closes GHSA-42h9-826w-cgv3 + GHSA-xj6q-8x83-jv6g + GHSA-pmv8-rq9r-6j72 (formData/formToJSON DoS + auth prototype pollution)                                                                                                                                                                                                                                                                                                                                                                                                     |
| `brace-expansion`                  | `1.1.18` / `2.1.4` / `5.0.9` | `overrides` (3 range-scoped literals, `pnpm-workspace.yaml`) | TRANSITIVE CVE floor. History: GHSA-3jxr-9vmj-r5cp (validated 2026-07-20), GHSA-mh99-v99m-4gvg (2026-07-28, 5.0.8). Raised 2026-08-05 for GHSA-rgw5-rvv9-x895 (high): upstream published REAL backports on all three lines (1.1.18 / 2.1.4 / 5.0.9), so each major stays at its minimal patch per ADR-0018 and eslint keeps the callable default export it needs (raise-within-major, empirically validated: eslint exit 0). The former GHSA-mh99 allowlist entry was removed the same day — with the backports published the advisory no longer flags the 1.x/2.x lines (audit clean without the ignore), so its remove-when was satisfied early |
| `fastify`                          | `5.10.0`                     | catalog (`catalog:` override)                                | DIRECT (apps/api, api-common). Raised 2026-07-28 to latest stable within the 7-day maturity buffer (published 2026-07-05). Paired with the `find-my-way` override below: fastify declares `find-my-way ^9.0.0`, so bumping fastify alone does NOT lift the bundled router past the vulnerable band                                                                                                                                                                                                                                                                                                                                                |
| `find-my-way`                      | `9.7.0`                      | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-07-28 (high, HTTP/2 DDoS, vulnerable `<=9.6.0`). The advisory names 9.6.1 as the patch but npm never published it (9.6.0 → 9.7.0), so **9.7.0 IS the minimal AVAILABLE patched version** — ADR-0018's minimal-patch rule is satisfied, not waived. Tree resolved 9.6.0 through Fastify's `^9.0.0` range; range-scoped `<9.6.1`                                                                                                                                                                                                                                                                                    |
| `postcss`                          | `8.5.24`                     | catalog (`catalog:` override)                                | DIRECT (dual-role; the override references the catalog per ADR-0018). Raised 2026-08-05: CVE floor >= 8.5.23 (GHSA-fxqj-rqcc-2cmp, moderate). Value is the latest stable within the 7-day maturity buffer (8.5.25 was 6 days old that date); was 8.5.21 (2026-07-28, path-traversal floor >= 8.5.18)                                                                                                                                                                                                                                                                                                                                              |
| `valibot`                          | `1.4.2`                      | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-07-28 (moderate, `record()` issue paths make `flatten()` throw). Chain: `@t3-oss/env-core` — the env-validation path, so a throw lands at boot                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `js-yaml`                          | `4.3.0`                      | `overrides` (literal, `pnpm-workspace.yaml`)                 | Was a de-dup pin at 4.2.0; promoted to a TRANSITIVE CVE floor 2026-07-20 (high, quadratic-CPU YAML merge-key chains, patched ≥4.3.0). GOTCHA: a blanket override silently wins over a later range-scoped one — update the existing pin, never add a second key                                                                                                                                                                                                                                                                                                                                                                                    |
| `protobufjs`                       | `7.6.5`                      | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-07-20 (GHSA moderate, ReDoS/DoS in `>=7.5.0 <=7.6.4`, patched 7.6.5). Tree resolved 7.6.4; range-scoped so only the vulnerable band is lifted per ADR-0018. Distinct from the pre-existing `@protobufjs/utf8` pin (a different submodule package)                                                                                                                                                                                                                                                                                                                                                                 |
| `form-data`                        | `4.0.6`                      | catalog (`catalog:` override)                                | DIRECT (providers/tiktok) + CVE floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `next`                             | `16.2.11`                    | catalog (`catalog:` override)                                | DIRECT (apps/admin, apps/client) + CVE floor raised 2026-07-23: 3 high advisories (GHSA-6gpp-xcg3-4w24 middleware/proxy bypass, App Router DoS, Server Actions SSRF), all patched ≥16.2.11                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `validator`                        | `13.15.22`+                  | catalog (`catalog:` override)                                | DIRECT (apps/api) + CVE floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ws`                               | `8.21.0`+                    | catalog (`catalog:` override)                                | DIRECT (apps/api) + CVE floor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `tough-cookie`                     | `4.1.3`                      | `overrides` (literal, `pnpm-workspace.yaml`)                 | TRANSITIVE CVE floor; validated 2026-06-22 — removing it surfaces an advisory, so kept at the minimal patch (NOT the latest major) per ADR-0018                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@hono/node-server`                | `2.0.10`                     | `overrides` (literal, `pnpm-workspace.yaml`)                 | TRANSITIVE CVE floor (dev-only chain: `@prisma/dev` → prisma CLI). Raised 2026-07-22 from 1.19.13: path traversal patched ≥2.0.5 (no 1.x backport) AND memory-leak GHSA-9mqv-5hh9-4cgg patched ≥2.0.10. MAJOR 1→2 forced over `@prisma/dev`'s exact 1.19.11 pin — safe: 2.x peers `hono ^4`, surface is dev tooling only, `prisma generate` verified post-bump                                                                                                                                                                                                                                                                                    |
| `hono`                             | `4.12.34`                    | `overrides` (literal, `pnpm-workspace.yaml`)                 | Was a de-dup pin at 4.12.26; promoted to TRANSITIVE CVE floor 2026-07-22 (3 moderate, >=4.12.27). Raised 2026-08-05 for GHSA-8j4g-w8fx-2239 (moderate, ReDoS in CORS middleware via Access-Control-Request-Headers, patched >=4.12.34). Same dev-only chain as `@hono/node-server` (via `@prisma/dev`)                                                                                                                                                                                                                                                                                                                                            |
| `dompurify`                        | `3.4.12`                     | `overrides` (literal, `pnpm-workspace.yaml`)                 | Was a de-dup pin at 3.4.11; promoted to CVE floor 2026-07-22 (low, GHSA-c2j3-45gr-mqc4 `CUSTOM_ELEMENT_HANDLING` bypass, patched ≥3.4.12). The stale blanket pin was actively forcing 3.4.11 UNDER `isomorphic-dompurify`'s own `^3.4.12` range — third instance of the js-yaml gotcha (raise the existing pin, never add a second key)                                                                                                                                                                                                                                                                                                           |
| `@opentelemetry/propagator-jaeger` | `2.9.0`                      | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-07-22 (moderate DoS, patched ≥2.9.0). Tree resolved 2.8.0 via the OTel auto-instrumentation chain; range-scoped `<2.9.0` per ADR-0018                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `fast-uri`                         | `3.1.5` / `4.1.2`            | `overrides` (2 range-scoped literals, `pnpm-workspace.yaml`) | TRANSITIVE CVE floor added 2026-07-22 (host/scheme confusion, >=3.1.4). Both bands raised/added 2026-08-05 for GHSA-7p8r-x3mc-p8w7 (high): 3.x band `>=3.0.0 <3.1.5` -> 3.1.5 (stryker ajv chain, dev) and NEW 4.x band `>=4.0.0 <4.1.2` -> 4.1.2 (Fastify `fast-json-stringify` chain, prod). The 4.x patch is inside the consumer's `^4.0.0` range but `pnpm update` could not reach the deep transitive, so the range-scoped override is the reliable mechanism per ADR-0018                                                                                                                                                                   |
| `undici`                           | `7.29.0`                     | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-08-05 (1 high GHSA-4cwx-7wf7-3272 + 4 moderate, all patched >=7.29.0). Dev-only chain: `vitest > jsdom > undici`. jsdom declares `^7.25.0` so 7.29.0 is in-range, but `pnpm update -r undici` did not move the deep transitive (empirically verified); range-scoped `>=7.0.0 <7.29.0` per ADR-0018                                                                                                                                                                                                                                                                                                                |
| `sharp`                            | `0.35.0`                     | `overrides` (range-scoped literal, `pnpm-workspace.yaml`)    | TRANSITIVE CVE floor added 2026-07-22 (moderate, bundled libvips advisory, patched ≥0.35.0). Tree resolved 0.34.5; range-scoped `<0.35.0`. NOTE: the `sharp: false` entry in `allowBuilds` is build-script config, NOT a version pin — prebuilt binaries refresh with the version                                                                                                                                                                                                                                                                                                                                                                 |

> Method (ADR-0018 §Transitive policy): a transitive override is justified ONLY by a real CVE floor confirmed empirically (`remove override → pnpm install → pnpm audit`; advisory surfaces → re-add at the minimal patched version). De-dup-only overrides are dropped. The CVE-floor catalog pins are exact (the catalog value IS ≥ the floor), so the security intent holds without a range.

### Build-tool version holds & dated-debt overrides

> Migrated from the frozen `docs/archive/PENDING_WORK_INVENTORY.md §7` (2026-07-21) — this file is now their canonical home. Temporary version **holds** and dated-debt **overrides** on the build/test toolchain — distinct from the CVE-floor pins above (those keep a known vulnerability out of the tree; these hold a tool below its latest to preserve a working toolchain). Each carries a remove-when so the hold is auditable, not silent. **Reconciled against `pnpm-workspace.yaml` at migration:** the former **`vite` 7.3.5 hold is RESOLVED** (ADR-0019 added `@vitejs/plugin-react` to `apps/client`, collapsing the vite 7/8 split — `vite` is now a single `8.0.16`), and **`concurrently` (CONCURRENTLY-BUMP) is CLOSED-by-removal** (Turbo replaced the concurrent dev orchestration; absent from every manifest, the catalog, and the lockfile).

| Package                               | Hold / floor                                                                      | Where                               | Remove-when                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `esbuild`                             | `0.28.1` override                                                                 | `overrides` (`pnpm-workspace.yaml`) | vite's bundled esbuild peer allows `>=0.28.1`. Now that the JSX frontends are on vite 8 (the former vite-7 blocker cleared), re-verify empirically whether the override is still load-bearing — candidate to drop (tracked in engram `backlog-esbuild-override`; override temporal aprobado por Edward).                                                                                                   |
| `eslint`                              | `9.36.0` held below eslint 10                                                     | catalog (`pnpm-workspace.yaml`)     | `eslint-plugin-react` + `eslint-plugin-jsx-a11y` publish an eslint-10 peer range (both currently declare none; bumping ahead crashes `pnpm lint`). Re-confirmed 2026-07-21 (PR #138) — the code-quality catalog slice held eslint at 9 for exactly this reason. The `eslint-plugin-boundaries` v6→v7 migration it unblocks is tracked as **SMELL-66**.                                                     |
| `storybook` (+ `@storybook/*` family) | `10.4.6` atomic family-lock                                                       | catalog (`pnpm-workspace.yaml`)     | the Storybook family publishes a newer atomic set compatible with the toolchain. Reconciled: the prior "paired with vite 7" rationale is superseded — 10.4.6 IS the vite-8 peer, and vite is already 8.                                                                                                                                                                                                    |
| `minimatch` / `brace-expansion`       | deliberately NOT force-pinned to latest majors (minimatch 10 / brace-expansion 5) | consumer-governed (no override)     | a real CVE floor surfaces under a consumer's range (`pnpm audit`) → then pin to the minimal patched version, never the latest major. Those majors dropped the callable-default export the eslint toolchain (`eslint-plugin-jsx-a11y`, `eslint-plugin-react`, both `minimatch ^3.1.2`) still uses. Distinct from the `brace-expansion` CVE floors in the table above (those lift only the vulnerable band). |
| `shell-quote`                         | `1.8.4` override (transitive CVE pin)                                             | `overrides` (`pnpm-workspace.yaml`) | every consumer pulling `shell-quote` resolves `>=1.8.4` on its own (override becomes a no-op de-dup) — verify empirically: remove, `pnpm install`, `pnpm audit`; if no advisory surfaces it was de-dup-only and can be dropped.                                                                                                                                                                            |

---

## How to extend

Adding new security rules:

1. **New required env var** → add to `apps/api/src/config/env.ts` (Zod schema), update `.env.example` AND `.env.test.example`, document in `docs/architecture/secrets-and-env.md`. If secret, use `z.string().min(32)`.
2. **New sensitive field for logger redaction** → extend `REDACT_PATHS` in `apps/api/src/lib/logger.ts` (case variations explicit — see ADR-0013). Document the threat in `docs/architecture/logging.md`.
3. **New CWE control** → add fitness regex catalog entry in `CLAUDE.md §Automated Compliance Checks`; mirror in `.github/workflows/fitness.yml`.
4. **New tenant-scoped model** → see §"Multi-Tenant Isolation" above (3-step checklist).
5. **Amending a rule** → ADR required (see ADR-0001 template).
6. **New rate-limited / IP-gated surface** → derive the client IP ONLY via
   `resolveClientIp(request)`; never read `x-forwarded-for` / `x-real-ip`
   directly, never use `entries[0]`. Prefer an authenticated principal for the
   bucket key when the endpoint is authenticated.
7. **New deployment topology (extra proxy/CDN hop)** → update
   `TRUSTED_PROXY_HOP_COUNT` for that environment to the new real hop count and
   re-verify the topology invariant (app unreachable except through the trusted
   edge; edge strips inbound forwarding headers). Never `trust proxy: true`.

Companion fitness checks live in `CLAUDE.md §Automated Compliance Checks`:

- `#13` no direct pino · `#14` no per-class cache Maps · `#15` no insecure secret fallbacks · `#16` no `process.env.*` outside `config/env.ts` (api) · `#17` no `process.env.*` outside `lib/env.ts` (Next.js) · `#18` Argon2 only via canonical helper · `#19` no env reads inside provider Adapter classes · `#23` no raw Prisma queries outside guard exceptions · `#28` no permissive Fastify `trustProxy: true` · `#29` no raw `x-forwarded-for` / `x-real-ip` reads outside `resolveClientIp`.
