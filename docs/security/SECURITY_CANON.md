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

Closed via §2.1 of the Normalization Roadmap. Layer 1 (Prisma `$extends` guard) auto-injects `accountId` on tenant-scoped queries; layer 2 (PostgreSQL RLS) gates rows by `app.account_id` GUC bound at tx start by `PrismaUnitOfWork`; layer 3 (fitness #23) blocks raw queries outside the guard. Full strategy + 51-table list + runbooks in [docs/security/MULTI_TENANT_GUARDS.md](MULTI_TENANT_GUARDS.md). The recurring audit cadence lives in `MULTI_TENANT_AUDIT_<date>.md`.

When adding a new `accountId`-bearing model:

1. Append the lowerCamel model name to the `TENANT_SCOPED_MODELS` Set in `infra/prisma/src/extensions/tenantGuard.ts`.
2. Append the PascalCase table name to the migration array in any forthcoming RLS migration (or extend `20260527000000_add_rls_tenant_isolation` if pre-deploy).
3. Document in MULTI_TENANT_GUARDS.md.

---

## How to extend

Adding new security rules:

1. **New required env var** → add to `apps/api/src/config/env.ts` (Zod schema), update `.env.example` AND `.env.test.example`, document in `docs/architecture/secrets-and-env.md`. If secret, use `z.string().min(32)`.
2. **New sensitive field for logger redaction** → extend `REDACT_PATHS` in `apps/api/src/lib/logger.ts` (case variations explicit — see ADR-0013). Document the threat in `docs/architecture/logging.md`.
3. **New CWE control** → add fitness regex catalog entry in `CLAUDE.md §Automated Compliance Checks`; mirror in `.github/workflows/fitness.yml`.
4. **New tenant-scoped model** → see §"Multi-Tenant Isolation" above (3-step checklist).
5. **Amending a rule** → ADR required (see ADR-0001 template).

Companion fitness checks live in `CLAUDE.md §Automated Compliance Checks`:

- `#13` no direct pino · `#14` no per-class cache Maps · `#15` no insecure secret fallbacks · `#16` no `process.env.*` outside `config/env.ts` (api) · `#17` no `process.env.*` outside `lib/env.ts` (Next.js) · `#18` Argon2 only via canonical helper · `#19` no env reads inside provider Adapter classes · `#23` no raw Prisma queries outside guard exceptions.
