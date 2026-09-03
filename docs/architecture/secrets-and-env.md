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

| Category                  | Contract                                              | Examples                                                                    |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| **Required**              | Schema enforces; boot fails if missing or `< 32` char | `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `PLATFORM_ENCRYPTION_KEY` |
| **Optional with default** | Schema applies default if unset                       | `PORT=3000`, `NODE_ENV=development`, `LOG_LEVEL=info`                       |
| **Optional**              | `undefined` is fine; consumer handles it              | `OPENAI_API_KEY` (AI feature auto-disables)                                 |
| **Conditional**           | Required if a sibling toggle is set                   | `STRIPE_SECRET_KEY` required when `PAYMENT_PROVIDER=stripe`                 |

Conditional validation is enforced at the point of use (e.g. `paymentAdapterFactory.ts` throws if Stripe is selected but its secrets are unset), not in the Zod schema, because the schema can't easily express cross-field constraints without losing the simple "all-fields-optional or required" mental model.

### Non-secret vars that still carry a compliance consequence

Not every var worth documenting is a credential. `DELETION_RECORD_RETENTION_YEARS` holds no secret and leaks nothing if read, yet it is the **only operator control over how long erased customers' plaintext names are retained**, which makes an undocumented default a policy decision nobody made.

| Var                               | Contract                                                             | Consequence of the value                                                                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETION_RECORD_RETENTION_YEARS` | Optional with default (`7`); `z.coerce.number().int().min(1).max(7)` | How long a hard-delete tombstone keeps the erased entity's plaintext `name`, under the lawful basis GDPR art. 17(3)(e). Lower = less PII held; higher = a longer evidence window. |

Three layers enforce the one-year floor, and they are not redundant: the Zod bound above only sees values arriving through the environment; `computeRetainUntil` clamps anything reaching it by another route; and the `DeletionRecord_retainUntil_floor` CHECK constraint holds even against a manual `INSERT` from a psql session. The ceiling is policy (do not hold readable PII past the window its own basis covers); the floor is the invariant.

**What the value does NOT do today.** No job degrades the plaintext when the horizon passes (tracked as SMELL-88), so setting this to `1` bounds the _justification_, not the actual retention — the row keeps its plaintext until that job exists. Treat the number as a commitment being made, not one currently being kept.

> **`REDIS_URL` is required for `apps/api`.** It moved from optional to required: BullMQ queue/consumer adapters and Redis-backed services are composition-root-owned and never self-construct a connection, so a missing `REDIS_URL` now fails the boot rather than silently defaulting to `redis://localhost:6379` (CWE-798). The legacy `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` trio remains for compat (`getRedisUrl()` builds a URL from them for workers / docker-compose deploys) but is no longer a fallback that lets `apps/api` boot without `REDIS_URL`.

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

### CWE coverage

The patterns prevented by this design are:

1. **CWE-798 (Use of Hard-coded Credentials)** — `process.env.X || "dev-only-..."`, `process.env.X ?? ""`, `process.env.X || generated()`. Each lets the app boot with a known/empty/ephemeral secret, masking misconfiguration in dev and shipping insecurely if someone deploys without setting the var.
2. **CWE-209 (Information Exposure Through Error Message)** — none of the validation errors leak secret values; only the variable name and the constraint that failed.
3. **CWE-321 (Use of Hard-coded Cryptographic Key)** — encryption keys (`PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY`) declared as required at boot with `min(32)` constraint; absence fails the boot rather than silently falling back to a hardcoded default.
4. **CWE-256 (Plaintext Storage of a Password)** — DB passwords stored only in `.env`/KMS; user passwords never stored — only Argon2id hashes. Encryption uses AES-256-GCM (AEAD) with rotating IVs.
5. **CWE-547 (Hard-coded Security-relevant Constants)** — covered by the broader env-var pattern: every config value is externalized to env, no in-source constants for secrets, providers, or feature toggles.

### OWASP Top 10:2025 mapping

Secrets are not a single OWASP category — they thread through five:

| OWASP Category                                     | How it relates to secrets                                                                                                        | Control vigente en el repo                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **A02 Security Misconfiguration**                  | Default/empty credentials in deployed env, leaked via debug pages, stored in plain config files                                  | Zod `min(32)` boot rejection + `emptyStringAsUndefined` (t3-env) + fitness #15/#16/#17                                                   |
| **A03 Software Supply Chain Failures**             | Secrets leaked via npm package logs, malicious deps reading process.env                                                          | OSV-Scanner CVE check + gitleaks pre-commit + secretlint over staged files + `packages/providers/*` constructor injection (PR-40 closed) |
| **A04 Cryptographic Failures**                     | Weak hashing (MD5/SHA1), short keys, missing-at-rest encryption, hardcoded crypto keys                                           | `min(32)` schema constraint + Argon2id (canonical 2026 password hashing) + AES-256-GCM AEAD for at-rest credentials                      |
| **A07 Identification and Authentication Failures** | Hard-coded fallbacks (CWE-798 textbook), JWT signed with rotating-per-restart secret, multiple subsystems with divergent secrets | Fail-fast boot + dual-key validity windows for rotation + single source of truth for JWT signing keys                                    |
| **A09 Security Logging and Monitoring Failures**   | Secrets logged via error messages or full request dumps                                                                          | Pino redaction paths in `apps/api/src/lib/logger.ts` + structured logging contract in CLAUDE.md §Logging                                 |

### STRIDE per credential class

Threat coverage applied to each credential type vivo en el repo:

| Threat                     | JWT signing keys                                                         | Encryption KEKs (PLATFORM_ENCRYPTION_KEY, OAUTH_ENCRYPTION_KEY) | OAuth client secrets (FACEBOOK_CLIENT_SECRET, etc.)      | DB passwords (DATABASE_URL)                | Per-tenant credentials (Channel.credentials)                       |
| -------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| **Spoofing**               | Stolen secret → forge any user's token                                   | Stolen KEK → decrypt all rows                                   | Stolen → impersonate platform integration                | Stolen → full DB access                    | Per-row encryption isolates blast radius                           |
| **Tampering**              | Modified `.env` → deploy with new key invalidates sessions (intentional) | Modified KEK → all reads fail (catches tampering loudly)        | Modified → OAuth handshake fails immediately             | DB writes monitored via audit log          | Tampering = ciphertext fails AES-GCM auth tag                      |
| **Repudiation**            | No audit log on JWT signing today (deferred — emit on `jwt.sign`)        | Decryption events logged via `EncryptionService` audit          | OAuth flow logged via `AuditLogger`                      | DB queries audit-trailed via Postgres logs | Per-row audit via `AuditLog.entityId` linking to encrypted row     |
| **Information Disclosure** | Logs redact `Authorization`/`token` paths (Pino redactor)                | KEK never written to logs (Pino redact + fitness #16)           | Same redact paths cover OAuth client secrets             | Same; `password` redacted                  | Ciphertext is safe to log; plaintext never logged                  |
| **Denial of Service**      | Rotation outage if secret rotated without grace window                   | KEK rotation re-wraps ALL rows (slow); plan dual-key window     | Rate-limited at OAuth provider; cache rate-limit headers | Connection pool tuned + circuit breaker    | Per-row decrypt caches via L1+L2 cache (5-15% perf hit acceptable) |
| **Elevation of Privilege** | Stolen JWT signing key bypasses RBAC entirely                            | Stolen KEK → read others' OAuth tokens, impersonate via API     | Stolen → escalate to platform-level scope                | Stolen → bypass all app-level RBAC         | Per-tenant DEK (BYOK, future) limits to single tenant              |

## Test environment

The test runner (vitest) needs the same Zod-validated env shape as production
but with safe dummies. Canon since §1.4 (Normalization Roadmap):

| File                              | Tracked? | Purpose                                                                                                  |
| --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `.env.test`                       | NO       | Local test env. Each dev owns their own; gitignored. Copy from the example, edit DATABASE_URL/REDIS_URL. |
| `.env.test.example`               | YES      | Tracked template. Documents the schema with safe dummy values (32-byte base64 keys, placeholder URLs).   |
| `apps/api/tests/setup-env.ts`     | YES      | Vitest `setupFiles` hook for `apps/api`. Loads `.env.test` before any test's transitive `env.ts` import. |
| `apps/workers/tests/setup-env.ts` | YES      | Same for `apps/workers`.                                                                                 |
| `scripts/ci-setup-test-env.sh`    | YES      | CI-only synthesiser — fails if `DATABASE_URL` / `REDIS_URL` not exported by the CI job.                  |

Local dev flow (one-time, after fresh clone):

```bash
cp .env.test.example .env.test
# Edit DATABASE_URL and REDIS_URL to point at your local docker-compose host
# (e.g. `localhost:5432` or `omnipost-infra:5432`).
```

Vitest auto-loads `.env.test` via the `setupFiles` hook — no manual `source`
needed. Run any single test file:

```bash
pnpm --filter @apps/api exec vitest run tests/unit/security/PlatformCredentialService.test.ts
```

CI: `scripts/ci-setup-test-env.sh` synthesises the file at job start from
shell-exported `DATABASE_URL` / `REDIS_URL` (no secret literals in the
repo, no `.env.test` file needed).

Adding a new test-only env var: extend `.env.test.example`, the `setup-env.ts`
loader picks it up automatically. If the var is REQUIRED in the Zod schema,
also update `ci-setup-test-env.sh` so CI provides it.

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
