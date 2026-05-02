# Secrets & Environment Configuration

> Threat model and operational reference for the backend env layer. Read first when adding a new secret, when an `env.X` lookup fails at boot, or when rotating credentials for a deployment.

## Architecture

```text
┌─────────────────────────────────────────┐
│  .env  (or .env.test in test mode)      │  ← single source of truth on disk
└────────────────┬────────────────────────┘
                 │ dotenv.config()
                 ▼
┌─────────────────────────────────────────┐
│  apps/api/src/config/env.ts             │  ← Zod schema, validates at boot
│   - parses process.env once             │  ← throws + refuses to start on
│   - exports typed `env` constant        │     missing required keys
└────────────────┬────────────────────────┘
                 │ import { env } from "…/config/env.js"
                 ▼
┌─────────────────────────────────────────┐
│  apps/api/src/**.ts                     │  ← uses `env.X`, never process.env.X
└─────────────────────────────────────────┘
```

Every backend module imports `env` from `apps/api/src/config/env.ts`. The schema parses `process.env` once on first import; if any required variable is missing or malformed, it throws and the API refuses to boot. There is no warn-and-continue fallback.

## Key categories

| Category                  | Contract                                              | Examples                                                       |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| **Required**              | Schema enforces; boot fails if missing or `< 32` char | `DATABASE_URL`, `JWT_ACCESS_SECRET`, `PLATFORM_ENCRYPTION_KEY` |
| **Optional with default** | Schema applies default if unset                       | `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=info`          |
| **Optional**              | `undefined` is fine; consumer handles it              | `OPENAI_API_KEY` (AI feature auto-disables)                    |
| **Conditional**           | Required if a sibling toggle is set                   | `STRIPE_SECRET_KEY` required when `PAYMENT_PROVIDER=stripe`    |

Conditional validation is enforced at the point of use (e.g. `paymentAdapterFactory.ts` throws if Stripe is selected but its secrets are unset), not in the Zod schema, because the schema can't easily express cross-field constraints without losing the simple "all-fields-optional or required" mental model.

## What lives where

| File                         | Role                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `.env`                       | Local dev secrets (git-ignored). Single source for backend + docker-compose.            |
| `.env.test`                  | Deterministic test values (git-ignored). Loaded when `NODE_ENV=test`.                   |
| `.env.example`               | Schema mirror — lists every key with `(required)` / `(default)` / `(optional)` markers. |
| `apps/api/src/config/env.ts` | Zod schema + typed `env` export. Single boot-time validator.                            |
| `apps/api/.env.test`         | Legacy test-only operational vars (timeouts, etc.) not covered by schema.               |
| `docker-compose.yml`         | Reads infra credentials (`POSTGRES_PASSWORD`, etc.) from `.env`.                        |

The previous per-app `apps/api/.env` and `apps/api/.env.example` files were retired — they were dead duplicates that didn't get loaded at runtime and held placeholder/stale values.

## Threat model

The patterns prevented by this design are:

1. **CWE-798 (Use of Hard-coded Credentials)** — `process.env.X || "dev-only-..."`, `process.env.X ?? ""`, `process.env.X || generated()`. Each lets the app boot with a known/empty/ephemeral secret, masking misconfiguration in dev and shipping insecurely if someone deploys without setting the var.
2. **CWE-209 (Information Exposure Through Error Message)** — none of the validation errors leak secret values; only the variable name and the constraint that failed.
3. **OWASP A07:2025 (Authentication Failures)** — tokens signed with weak/known secrets; rotated-per-restart secrets that invalidate sessions; multiple subsystems silently signing with different secrets (the `JWT_SECRET` vs `JWT_ACCESS_SECRET` divergence found during the consolidation).
4. **Cache coherence and session integrity** — when `JWT_ACCESS_SECRET` was missing, the API generated a fresh secret in memory on each restart, so every existing session was invalidated by every restart. The fix is fail-fast: if the secret isn't there, the API doesn't start.

## CI gates

Two fitness functions in `.github/workflows/fitness.yml` enforce the design:

- **#15 — No insecure secret fallbacks (CWE-798).** Greps `apps/api/src` and `apps/workers/src` for any `process.env.X_(SECRET|KEY|PASSWORD|TOKEN|CREDENTIAL) (||/??) ...` pattern. Hard zero.
- **#16 — No direct `process.env.*` in `apps/api/src` outside `config/env.ts`.** Forces all consumers to go through the typed `env`.

The `packages/providers/*` tree still has ~25 occurrences of pattern #15 (provider adapters reading credentials directly from env). These are tracked under PR-40 in `docs/audits/POST_REMEDIATION_BACKLOG.md`; the canonical fix is constructor injection, which is a deeper refactor than this batch.

## Adding a new env var

1. Add the field to `envSchema` in `apps/api/src/config/env.ts` with the right type and `(required | optional | default)`.
2. Add the field to `.env.example` with the appropriate marker (and a comment if non-obvious).
3. Add a real value to your local `.env` (and to `.env.test` if tests need it).
4. Use `env.YOUR_NEW_VAR` in code — never `process.env.YOUR_NEW_VAR`.

If the new var is a secret, also:

5. Use `z.string().min(32)` (or longer) so weak placeholders fail validation.
6. Add to the rotation runbook (`docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md`).

## Rotating secrets

Local dev:

```bash
# Generate a fresh secret
openssl rand -hex 64        # for JWT/cookie secrets (128-char hex)
openssl rand -base64 32     # for symmetric encryption keys (44-char base64)
openssl rand -hex 32        # for the OAuth encryption key (64-char hex)
```

Then update `.env` and restart the API. Active sessions/tokens signed with the old secret will be invalidated — that is the correct behavior on a rotation.

Production: separate runbook (`docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md`) covers staged rotation with token grace periods and the BFG plan for git-history cleanup.

## Troubleshooting

**"Environment validation failed. Refusing to boot."** — the schema rejected one or more values. The error lists every offending key with its constraint. Common causes: secret `< 32` chars (placeholder leftover), `STORAGE_PROVIDER` set to a value not in the enum, malformed `DATABASE_URL`.

**Test suite fails with the same error** — `.env.test` is missing a key the schema requires. Add it with a deterministic dummy value (`>= 32` chars).

**Boot succeeds but a feature crashes at first call** — usually a conditional (Stripe/Paddle/S3) where the toggle is set but the matching credentials aren't. Look for the explicit "required when X is configured" error message in the factory.

**Lint error on `process.env.X` access** — fitness check #16 caught a regression. Replace with `env.X`.
