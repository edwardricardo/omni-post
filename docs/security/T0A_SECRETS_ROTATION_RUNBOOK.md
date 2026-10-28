# T0-A — Secrets Rotation Runbook

> **Purpose.** A step-by-step guide for the Maintainer to rotate every secret exposed as a result of finding L-591 (`.env` tracked in a public repo).
>
> **Scope.** This document does NOT perform the rotation — it describes HOW to do it outside the T0-A plan. The part done in code is: untracking `.env`, regenerating `.env.example`, and this runbook.
>
> **Audience.** The Maintainer (who owns and operates the repository).
>
> **Created.** 2026-04-21.
>
> **Success criterion.** `git log --all --oneline -- .env` returns 0 lines + every external service running with new secrets + apps redeployed green.
>
> **Status (2026-10-15): IN FORCE, NOT EXECUTED.** The rotation and the history purge happen at the move to production (`SECRETS-ROTATION-GOLIVE`, `docs/product/MASTER_PLAN_ES.md` §5.2). The dual-key window of §7 and the re-encryption of §10 describe what the code does not do yet: CRED-6 and CRED-11 (DEF-45) are still open. §2, §3 and §7 to §10 are the permanent procedure that [`SECRETS.md`](./SECRETS.md) links to; §1, §4 and §5 are the L-591 incident part; §6 (the checklist) serves both.
>
> **Division of authority.** [`SECRETS.md`](./SECRETS.md) is the catalog (which secrets exist and where they live); this document is the how (the procedure); the Master Plan carries only what is left to do.

---

## §1. Incident context

### Originating finding

**L-591** — `.env` tracked in git with real secrets. Documented in:

- The original finding L-591 (`.env` git-tracked with secrets). The pending work (the real rotation + the history purge) lives in `docs/product/MASTER_PLAN_ES.md` → `SECRETS-ROTATION-GOLIVE` (§5.2). The originating audit docs (LATERAL_FINDINGS, D0v4, REMEDIATION_ROADMAP) were retired after their absorption into the consolidated plan.

### Scope correction (found on 2026-04-21 while exploring T0-A)

The original finding described `apps/api/.env` as the tracked file. The reality:

- **Root `.env`** (not `apps/api/.env`) is the file tracked in git.
- `apps/api/.env` was never tracked (correctly gitignored from the start).
- L-591 stays CRITICAL — only the affected file changes.

### Exposure

- **Repo:** `https://github.com/edwardricardo/omni-post.git` — **PUBLIC on GitHub**
- **First commit with `.env`:** `5603d6b` (2026-03-08)
- **Active exposure time:** ~44 days
- **Affected commits:** 6 (the file's whole history)

### What counts as compromised

Every value present in root `.env` during the last 44 days. Check against the commits:

```bash
git log --all --oneline -- .env
# For each commit SHA, inspect:
git show <SHA>:.env
```

**⚠️ Assume compromised** every secret documented in §2 until it is rotated, even if the historical diff shows partial changes.

---

## §2. Full list of secrets to rotate

Table grouped by domain. **43+ variables** across root `.env` + `apps/api/.env`.

### §2.1 Database (PostgreSQL)

| Key                   | Service                                                 | Action                                                             | Priority |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ | -------- |
| `DATABASE_URL`        | Managed PostgreSQL (Railway/Supabase/AWS RDS — confirm) | Create a new DB user + new password + update the connection string | CRITICAL |
| `SHADOW_DATABASE_URL` | Managed PostgreSQL                                      | Same — it can reuse the same instance with a new password          | HIGH     |

**Procedure:**

1. Log in to the DB provider's panel.
2. Create a new role/user with the same permissions (`CREATE USER new_user WITH PASSWORD '...' ;`).
3. `GRANT ALL PRIVILEGES ON DATABASE omnipostdb TO new_user;`
4. Revoke the old user (or disable its login): `ALTER USER old_user NOLOGIN;`
5. Build the new `DATABASE_URL` and `SHADOW_DATABASE_URL`.
6. Update the local `.env` + the deploy platform.

### §2.2 Auth / JWT

| Key                   | Service  | Action                 | Priority |
| --------------------- | -------- | ---------------------- | -------- |
| `ADMIN_JWT_SECRET`    | Internal | `openssl rand -hex 64` | CRITICAL |
| `JWT_ACCESS_SECRET`   | Internal | `openssl rand -hex 64` | CRITICAL |
| `JWT_REFRESH_SECRET`  | Internal | `openssl rand -hex 64` | CRITICAL |
| `CUSTOMER_JWT_SECRET` | Internal | `openssl rand -hex 64` | CRITICAL |

**Side effect:** rotating these secrets invalidates **every active session**. Users and admins must log in again. Announce it in advance or accept downtime.

**Procedure:**

```bash
for key in ADMIN_JWT_SECRET JWT_ACCESS_SECRET JWT_REFRESH_SECRET CUSTOMER_JWT_SECRET; do
  echo "$key=$(openssl rand -hex 64)"
done
# Copy the output to the local .env + the deploy platform
```

### §2.3 Admin bootstrap

| Key              | Service  | Action                                            | Priority |
| ---------------- | -------- | ------------------------------------------------- | -------- |
| `ADMIN_EMAIL`    | Internal | Change if the email was visible in public commits | MEDIUM   |
| `ADMIN_PASSWORD` | Internal | Generate a strong one: `openssl rand -base64 24`  | CRITICAL |

**Note:** L-546 (T4-V) will implement a fail-fast when `ADMIN_PASSWORD` is missing. For now, make sure the value in `.env` is strong.

### §2.4 AI Providers

| Key                  | Service          | Rotation URL                                                     | Priority |
| -------------------- | ---------------- | ---------------------------------------------------------------- | -------- |
| `OPENAI_API_KEY`     | OpenAI           | <https://platform.openai.com/api-keys> → "Revoke" + "Create new" | CRITICAL |
| `PERPLEXITY_API_KEY` | Perplexity       | <https://www.perplexity.ai/settings/api> → rotate key            | CRITICAL |
| `GEMINI_API_KEY`     | Google AI Studio | <https://aistudio.google.com/apikey> → rotate                    | CRITICAL |

**Check:** after the revoke, monitor the dashboards for 24h to detect unauthorized use of the old key.

### §2.5 Billing (Stripe)

| Key                     | Service | Rotation URL                                                                       | Priority |
| ----------------------- | ------- | ---------------------------------------------------------------------------------- | -------- |
| `STRIPE_SECRET_KEY`     | Stripe  | <https://dashboard.stripe.com/apikeys> → rotate secret key                         | CRITICAL |
| `STRIPE_WEBHOOK_SECRET` | Stripe  | <https://dashboard.stripe.com/webhooks> → roll signing secret per webhook endpoint | CRITICAL |

**⚠️ The order matters:**

1. Create a new secret key in Stripe (do not revoke the old one yet)
2. Update the deploy platform with the new key
3. Redeploy the app (workers + api)
4. Verify the health check (Stripe calls working)
5. Revoke the old key
6. Repeat for the webhook secret: update the Stripe endpoint signing secret → deploy → verify → the old secret rolls off automatically

### §2.6 Email (Resend)

| Key              | Service | Rotation URL                                    | Priority |
| ---------------- | ------- | ----------------------------------------------- | -------- |
| `RESEND_API_KEY` | Resend  | <https://resend.com/api-keys> → delete + create | HIGH     |

### §2.7 URLs and config

| Key                                  | Action                                | Priority |
| ------------------------------------ | ------------------------------------- | -------- |
| `APP_URL`, `CLIENT_URL`, `ADMIN_URL` | No action unless the host has changed | LOW      |

### §2.8 Observability

| Key                           | Service        | Action                                               | Priority |
| ----------------------------- | -------------- | ---------------------------------------------------- | -------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector | No action unless the endpoint is private and exposed | LOW      |

### §2.9 Redis

| Key         | Service                              | Action                                     | Priority |
| ----------- | ------------------------------------ | ------------------------------------------ | -------- |
| `REDIS_URL` | Managed Redis (Upstash/Railway/etc.) | Rotate password if auth is on; rebuild URL | HIGH     |

---

## §3. PLATFORM_ENCRYPTION_KEY — special consideration

**This key is different from the rest.** It encrypts values in the `PlatformCredential` table (each tenant's OAuth credentials for the social providers, stored in the DB).

### If the key is rotated

The existing encrypted values **can no longer be decrypted** with the new key. Consequences:

- Every connected channel (Twitter, Instagram, Facebook, etc.) fails when it tries to publish.
- The stored OAuth tokens become inaccessible.
- Users must reconnect every channel (re-OAuth flow).

### Options

**Option A — Conservative (recommended by default):**

- **Do not rotate** `PLATFORM_ENCRYPTION_KEY` unless there is specific evidence that this key was exposed.
- Check in the git history whether this key was in root `.env`: `git log -p --all -S "PLATFORM_ENCRYPTION_KEY" .env`
- If the grep shows the value in public commits → force **Option B**.
- If the key was only in `apps/api/.env` (never tracked) → keep it.

**Option B — Paranoid (if the exposure is confirmed):**

Migration plan:

1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Write a migration script: it reads `PlatformCredential`, decrypts with the old key, encrypts with the new key, saves.
3. Stop the workers (`publishWorker`, `analyticsIngestWorker`, `inboxSyncWorker`) during the migration.
4. Run the script on the prod DB (with a backup taken BEFORE).
5. Swap the key in `.env` + deploy.
6. Restart the workers.
7. Verify: test a publication on a test channel.

**Alternative to Option B — Force a re-OAuth:**

- Truncate the `PlatformCredential` table (or soft-delete its records).
- Notify the tenants: "Your channel must be reconnected for security reasons".
- Each tenant re-authorizes each channel → the new tokens are encrypted with the new key.
- A larger user impact, but no data migration risk.

### Checking whether this specific key was exposed

```bash
# Search the git history for PLATFORM_ENCRYPTION_KEY
git log -p --all -S "PLATFORM_ENCRYPTION_KEY" -- .env
# If it shows lines with a value — exposed, Option B
# If it shows only the variable name with no value — not exposed, Option A
```

---

## §4. Git history purge

**⚠️ A destructive operation, irreversible from the remote.** Run it only after:

1. Every new secret is generated and on the deploy platform
2. The apps are redeployed with the new secrets and verified green
3. A local backup of the current repo (off-site)
4. Collaborators are informed (if applicable)

### Recommended option: git-filter-repo

```bash
# Install it if it is missing
pip install git-filter-repo

# Run from the repo root (make sure you are on the right branch)
git filter-repo --invert-paths --path .env --force

# This rewrites the WHOLE history — .env no longer exists in any commit
```

### Alternative: BFG Repo-Cleaner

```bash
# Friendlier, but it requires Java
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
java -jar bfg-1.14.0.jar --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Force push to the public remote

```bash
# Verify local state
git log --all --oneline -- .env   # must return 0 lines

# Force push — invalidates clones
git push --force origin --all
git push --force origin --tags
```

### Pre-force-push checklist

- [ ] Every new secret confirmed active in the external services
- [ ] Deploy platforms (Vercel + backend) already running with the new secrets
- [ ] Health checks green on `/health` and the critical endpoints
- [ ] Stripe webhook confirmed receiving with the new secret
- [ ] Backup of the current repo: `git clone --bare <repo> backup-pre-purge.git` stored off-site
- [ ] Collaborators informed (if any) — they must re-clone afterwards
- [ ] In-flight PRs/merges handled (close or postpone them before the purge)

### Post-purge

```bash
# Check that the public remote no longer contains .env
git clone https://github.com/edwardricardo/omni-post.git /tmp/verify-clone
cd /tmp/verify-clone
git log --all --oneline -- .env   # must return 0 lines
```

---

## §5. Deploy target update

### Frontend (admin + client) — Vercel

Confirmed in the repo: `apps/admin/vercel.json` and `apps/client/vercel.json` exist.

**Procedure:**

1. Log in: <https://vercel.com/dashboard>
2. Select the `omnipost-admin` project → Settings → Environment Variables
3. Update each variable with its new value
4. Triggers: Production, Preview, Development (as applicable)
5. Save
6. Deployments → Redeploy (latest commit) → Production
7. Verify: visit the URL → the login screen loads → no console errors
8. Repeat for `omnipost-client`

### Backend — platform still to be confirmed

**⚠️ There is no `fly.toml`, `railway.json` or `render.yaml` in the repo.**

**Maintainer: confirm the backend platform here:**

```
BACKEND_DEPLOY_PLATFORM: <FILL IN — Railway / Fly.io / Render / Heroku / Kubernetes / VPS / other>
BACKEND_PROJECT_URL: <dashboard URL>
```

### Generic steps per platform

**Railway:**

1. <https://railway.app/dashboard> → project
2. Service → Variables → Update each key
3. The service redeploys automatically
4. Logs → verify there are no missing-env errors

**Fly.io:**

```bash
fly secrets set DATABASE_URL="..." -a <app-name>
fly secrets set JWT_ACCESS_SECRET="..." -a <app-name>
# ... and so on for each key
fly deploy -a <app-name>
```

**Render:**

1. <https://dashboard.render.com> → service
2. Environment → Update each
3. Save Changes → auto redeploy

**VPS / self-hosted:**

1. SSH into the server
2. Update the `.env` file (with the new values; CAREFUL: do not commit it)
3. `pm2 reload <app>` or `systemctl restart <service>`
4. Check logs

### Post-deploy check

```bash
curl https://<your-api-host>/health
# Expected: {"status":"ok", ...}
```

---

## §6. Verification checklist post-rotation

### Secret hygiene

```bash
# No .env tracked in git
git ls-files | grep -E "\.env$"   # → empty

# History purged
git log --all --oneline -- .env   # → empty

# .env.example without real values
grep -E "=.+[a-zA-Z0-9]{20,}" .env.example apps/api/.env.example | \
  grep -v "CHANGE_ME\|localhost\|your"   # → empty (matches only in placeholders)
```

### Service running

```bash
# Health check API
curl -s https://<host>/health | jq .

# Admin loads
curl -s -o /dev/null -w "%{http_code}" https://<admin-url>/login   # → 200

# Client loads
curl -s -o /dev/null -w "%{http_code}" https://<client-url>   # → 200

# The Stripe webhook accepts signed requests (from the Stripe dashboard → "Send test webhook")
# → 200 in the backend logs
```

### Data integrity

- [ ] Admin login works (the JWT secrets work)
- [ ] Customer login works
- [ ] Publish a post on a test channel (checks the provider API keys + PLATFORM_ENCRYPTION_KEY)
- [ ] Billing: create a test subscription (checks the Stripe keys)
- [ ] Email: trigger a password reset (checks Resend)

### Local git

```bash
git status
# Expected:
#   .env is still on disk (gitignored)
#   .env.example committed
#   apps/api/.env.example committed
#   docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md committed
```

### Final note

If the whole checklist passes: **L-591 CLOSED**. The tail (the real rotation + the history purge) stays tracked in `docs/product/MASTER_PLAN_ES.md` → `SECRETS-ROTATION-GOLIVE` (§5.2); mark it closed there once it is done.

---

## §7. Canonical cryptoperiods (NIST SP 800-57 Part 1 Rev 5)

The validity period NIST recommends per class of cryptographic key.
**Operational target** = what this repo applies (usually more conservative than the NIST upper bound).

| Secret class                                                                                                  | NIST originator usage | NIST recipient usage | Operational target          | Rationale                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JWT signing keys** (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_JWT_SECRET`, `ADMIN_JWT_*_SECRET`) | ≤ 2 years             | ≤ 3 years            | **90 days**                 | Access tokens TTL ≤ 15min; rotation bounds blast radius if signing key compromised. Dual-key window ≥ 24h covers max access-token validity.                                            |
| **Cookie signing** (`COOKIE_SECRET`)                                                                          | ≤ 2 years             | ≤ 3 years            | **90 days**                 | Same logic as JWT. Sessions invalidate gracefully on rotation since cookie verification is stateless.                                                                                  |
| **API keys** (`STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, etc.)                                  | —                     | ≤ 2 years            | **1 year**                  | OAuth client secrets often appear in CI logs, third-party support tickets; tighter than NIST upper bound.                                                                              |
| **Encryption keys** (`PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY`)                                       | ≤ 2 years             | indefinite           | **1 year** + key versioning | Encrypted-at-rest data must be readable across rotations; version column on every encrypted row enables zero-downtime rotation. Old key kept for decrypt-only until re-wrap completes. |
| **Database passwords** (`DATABASE_URL`, `POSTGRES_PASSWORD`)                                                  | —                     | —                    | **1 year**                  | App restart required for rotation; coordinate with DB admin for grace window if connection pooling is hot.                                                                             |
| **Service account / infrastructure** (`MINIO_ROOT_PASSWORD`, `GF_SECURITY_ADMIN_PASSWORD`)                    | —                     | —                    | **1 year**                  | Single-instance dev today; in prod migrate to IAM roles where possible to avoid static credentials entirely.                                                                           |
| **HMAC webhook signing secrets**                                                                              | ≤ 2 years             | ≤ 2 years            | **1 year**                  | Per-customer-rotated when supported by the integration provider.                                                                                                                       |

### Dual-key validity windows (zero-downtime rotation)

| Secret type      | Window length                                  | Why                                                                                                                         |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| JWT signing keys | 24 hours                                       | Covers max access-token TTL (15 min) + max refresh-token TTL (7 days needs longer window — see below) + buffer.             |
| Refresh tokens   | 7 days                                         | Refresh-token TTL = 7 days; old key must verify until last issued refresh expires.                                          |
| Encryption KEKs  | 7 days minimum, until re-wrap script completes | Re-wrap may take hours on large datasets; old key must decrypt until every row re-encrypted with new KEK + version flipped. |
| Cookie signing   | 7 days                                         | Cookie max-age + buffer.                                                                                                    |
| API keys         | N/A                                            | Hard cutover; provider rotation is atomic.                                                                                  |

### Schedule template

Recommended cadence for ops team to track in calendar:

- **Quarterly (every 90 days)**: rotate JWT signing keys + cookie secret. Use dual-key window.
- **Annually (every 12 months)**: rotate API keys, DB password, encryption KEKs (with re-wrap window).
- **On security incident**: immediately rotate every secret in the affected blast radius regardless of cadence.
- **On personnel change**: rotate any credential that the departing engineer had access to (DB passwords, OAuth client secrets they configured).

NIST source: <https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final> (Recommendation for Key Management, Part 1: General).

---

## §8. Password hashing canon (Argon2id)

Argon2id is the canonical algorithm for password / API-key / backup-code
hashing. Centralised helper: `apps/api/src/auth/passwordHashing.ts`
(`hashPassword` / `verifyPassword` / `needsRehash`). Direct `argon2.hash` /
`argon2.verify` calls outside this module are blocked by fitness check #18.

Parameters (`ARGON2_PARAMS`):

| Parameter     | Value          | OWASP min      | RFC 9106 (2nd) | Rationale                                                                                                                                                                                                                                                                                                         |
| ------------- | -------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | `argon2id`     | `argon2id`     | `argon2id`     | Resists side-channel (argon2i) + GPU/ASIC (argon2d) attacks.                                                                                                                                                                                                                                                      |
| `memoryCost`  | 65536 (64 MiB) | 19456 (19 MiB) | 65536 (64 MiB) | RFC second-recommended; ASIC-resistant; ~250ms on a typical login server.                                                                                                                                                                                                                                         |
| `timeCost`    | 3              | 2              | 3              | RFC second-recommended; matches login UX (~240ms).                                                                                                                                                                                                                                                                |
| `parallelism` | 4              | 1              | 4              | RFC 9106 endorses `p=4` (lanes). OWASP later tightened to `p=1` because most libs serialise lanes; we follow RFC because (a) `node-argon2` lib defaults match RFC exactly so explicit params and lib defaults stay aligned, (b) the cost difference is negligible on server-side single-user-per-request hashing. |
| `hashLength`  | 32             | 32             | 32             | 256-bit output.                                                                                                                                                                                                                                                                                                   |

**Transparent rehash on login.** When `ARGON2_PARAMS` is bumped (server-side
cost increase, e.g. CPU upgrade allows higher `memoryCost`), `needsRehash`
returns `true` for any existing hash that uses the previous params. The
login flow (`authServiceCore.authenticate` for admin, `LoginCustomerUseCase`
for customer) re-hashes silently while the plaintext is still on the stack,
then writes the new hash back. Users never see a forced password reset.

**Sources**:

- OWASP 2025: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- RFC 9106 (IETF Argon2 spec): <https://datatracker.ietf.org/doc/html/rfc9106>
- node-argon2 library defaults: <https://github.com/ranisalt/node-argon2>

---

## §9. Decryption audit trail

Every call to `EncryptionService.decrypt()` (and the parallel
`enhancedOAuthProvider.decryptToken()`) emits an audit event via
`AuditService.logCredentialDecrypt()`. The row is persisted to the
`AuditLog` table with `action="CREDENTIAL_DECRYPTED"` and the following
shape:

```json
{
  "action": "CREDENTIAL_DECRYPTED",
  "resource": "<fieldName, e.g. Channel.credentials>",
  "resourceId": "<recordId, e.g. ch-123>",
  "userId": "<from request auth tier, when in request scope>",
  "ipAddress": "<from request, when in request scope>",
  "userAgent": "<from request, when in request scope>",
  "success": true,
  "details": {
    "fieldName": "<same as resource>",
    "caller": "<service.method, optional>",
    "correlationId": "<req.id from Fastify>"
  }
}
```

The plaintext NEVER appears in the audit row (OWASP ASVS V16.2.5).

### Encryption context (KMS canon — AAD binding)

`EncryptionService.encrypt()` and `.decrypt()` REQUIRE an
`EncryptionContext { fieldName, recordId, caller? }`. The
`(fieldName, recordId)` pair is bound as **AAD** (Additional Authenticated
Data) in AES-GCM via `cipher.setAAD(canonicaliseContext(ctx))`. This
provides two independent guarantees:

1. **Tamper-resistance** — a ciphertext stored as
   `Channel.credentials/<id>` cannot be replayed as
   `OidcConfiguration.clientSecret/<id>` (or any other field/record). The
   auth tag is computed over the canonicalised context bytes, so a
   mismatch fails the decrypt loud (no silent data swap).
2. **Audit categorisation** — the same context flows into the AuditLog
   row, enabling per-field / per-record queries.

Mirrors AWS KMS's `EncryptionContext` parameter pattern. The `caller`
field is audit metadata only; it is NOT included in the AAD bytes so
that refactoring caller names doesn't invalidate stored ciphertexts.

### Request-scoped enrichment (AsyncLocalStorage)

`apps/api/src/security/decryptAuditContext.ts` exposes a request-scoped
`AsyncLocalStorage<RequestAuditContext>` that holds `userId`, `ipAddress`,
`userAgent`, `correlationId`. The Fastify `onRequest` hook (in
`apps/api/src/index.ts`) populates it from the request; auth middleware
fills in `userId` post-authentication via `setAuthenticatedUserId()`.
Workers / cron / background jobs run outside any request scope —
their audit rows carry only `fieldName/recordId/caller`, which is the
honest representation of "system-initiated decrypt".

### Compliance mapping

- **OWASP ASVS V16.3.2** (L3): "logging when sensitive data is accessed
  (without logging the sensitive data itself)".
- **OWASP ASVS V16.2.5** (L2): credentials must not be logged in plain.
- **AWS KMS EncryptionContext** (industry canon): caller-supplied,
  non-secret, AAD-bound + audit-logged.
- **SOC 2 CC6.1, ISO 27001 A.12.4.1**: every access to sensitive data
  must be auditable. By emitting at the decryption boundary rather than
  at the read site, we capture access regardless of which code path
  triggered it.

---

## §10. Re-encryption procedure (when AAD changes)

The encryption context bytes are bound to the auth tag at encrypt time.
Any change to the canonicalisation (currently `${fieldName}\x1f${recordId}`)
or to a row's `fieldName` / `recordId` invalidates that row's auth tag —
decrypt will fail.

When this happens (rare — only via deliberate refactor):

1. **Identify affected rows**: `SELECT * FROM "<Table>" WHERE
"<KeyVersionColumn>" = <oldVersion>` (re-encryption is implicit on
   write — every save() rotates to the active key version).
2. **Re-encrypt with the new context**: load the row, decrypt with the
   OLD context, encrypt with the NEW context, persist.
3. **Verification**: assert `decrypt(row) === plaintext` for a sample.

For dev / test environments: the simplest path is `TRUNCATE <Table>
CASCADE` followed by `pnpm db:seed`. The seed already binds the correct
AAD per row.

For production with non-trivial data: write a one-off backfill script
(`apps/api/scripts/reencryptChannelCredentials.ts` etc.) that reads each
row, decrypts with the legacy context, re-encrypts with the new context,
and writes back. Run inside a single transaction per row to bound rollback
scope. Audit emission is suppressed for backfills via a dedicated
`caller="backfill"` value so the AuditLog is not flooded.

---

## Annex A — Emergency contact

If something fails catastrophically during the rotation (DB unreachable, prod service down):

1. **Do not force-push** until the situation is stable.
2. Roll back to the previous deploy (Vercel: previous deployment; backend: deploy previous commit).
3. Diagnose with the logs before continuing.

## Annex B — Cross-references

- `docs/product/MASTER_PLAN_ES.md` → `SECRETS-ROTATION-GOLIVE` (§5.2, rotation + history purge at go-live) · `L-546` ADMIN_PASSWORD fallback (§5.7) · `L-623` password123 in CI = accepted-dev-fixture (§5.7). The originating roadmaps (REMEDIATION_ROADMAP, LATERAL_FINDINGS) were retired after their absorption.
- CLAUDE.md — "Automated Compliance Checks" (fitness functions already wired in CI).
