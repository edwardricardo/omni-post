# Secrets · Canonical Reference

Catalogue of every secret in the omni-post platform with its location,
format, consumer, classification, rotation cadence, and operational
links. This is the single authoritative answer to "what is this secret
and how do I handle it?".

This document does NOT duplicate procedures. For step-by-step rotation
go to [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md).
For the database-encryption taxonomy (the meaning of Class A/B/C/D/E)
go to [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md).
For architectural decisions (deployment delivery, KMS migration, BYOK)
see [Appendix F](#appendix-f--cross-references).

---

## 1. Scope

**Covers**

- Every runtime secret loaded from `process.env` (validated by
  [apps/api/src/config/env.ts](../../apps/api/src/config/env.ts))
- Every database column that stores credentials, tokens, or hashes
- CI/CD secrets (current location and target location)
- Local-dev-only secrets (Docker Compose service credentials, admin seed)

**Does not cover**

- The procedure to rotate any individual secret → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- The Class A–E classification semantics → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- Architectural decisions (deployment delivery, KMS migration, BYOK
  feasibility) → [Appendix F](#appendix-f--cross-references)

**Audience**

Operators, on-call engineers, security reviewers, new contributors.
Anyone who needs to find a specific secret and understand its lifecycle
without reading five other documents.

---

## 2. How to use this document

- **By category.** §3 master keys, §4 infrastructure, §5 third-party,
  §6 per-tenant DB-stored, §7 CI/CD, §8 local-dev only.
- **By compliance.** [Appendix C](#appendix-c--compliance-framework-mapping)
  maps each category to SOC2 / PCI-DSS / GDPR / HIPAA controls.
- **By urgency.** [Appendix D](#appendix-d--emergency-procedures)
  is the compromise-response runbook.
- **By search.** Use `Ctrl-F` with the env var name (`JWT_ACCESS_SECRET`)
  or the database column name (`Channel.credentials`).
- **Adding a new secret.** [Appendix E](#appendix-e--adding-a-new-secret)
  is the contributor checklist.

Cross-references in tables use these short forms:

- **Rotation:** link to the relevant section of T0A
- **Class:** A / B / C / D / E from [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- **NIST:** cryptoperiod from NIST SP 800-57 Part 1 Rev 5

---

## 3. Master keys (cryptographic root)

The platform's two cryptographic roots. Both are required at boot; the
API and workers refuse to start without them. They protect every
encrypted-at-rest credential downstream.

| Name                      | Format                  | Used by                                         | Encrypts                                                                                                                                                         | Rotation cadence  | Notes                                                                                                                                  |
| ------------------------- | ----------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `PLATFORM_ENCRYPTION_KEY` | base64-decoded 32 bytes | `EncryptionService`, `ChannelCredentialsCrypto` | Class A columns: `Channel.credentials`, `PlatformCredential.*`, `AccountCredential.*`, `OidcConfiguration.clientSecret`, `ExternalNotificationConfig.webhookUrl` | NIST 1 year (KEK) | `keyVersion` graceful-rotation window: prior keys live in `PLATFORM_ENCRYPTION_KEY_V{N}` during cutover. AAD-bound `EncryptionContext` |
| `OAUTH_ENCRYPTION_KEY`    | hex-decoded 32 bytes    | `enhancedOAuthProvider`                         | `ProviderConnection.accessToken`, `.refreshToken`, `.apiSecret` (inline `iv:authTag:ciphertext` format)                                                          | NIST 1 year (KEK) | Single-version key today; same rotation pattern applies                                                                                |

**Generation.** `openssl rand -base64 32` for `PLATFORM_ENCRYPTION_KEY`,
`openssl rand -hex 32` for `OAUTH_ENCRYPTION_KEY`.

**Rotation procedure.** [T0A §3](./T0A_SECRETS_ROTATION_RUNBOOK.md#3-platform_encryption_key--consideración-especial)
documents the special handling required (re-wrap of all DEKs, dual-key
validity windows, audit verification).

**Future architecture.** The current model holds the master key as a
plaintext environment variable on the runtime host. The migration to
KMS-backed envelope encryption (KEK in KMS, per-record DEKs) is
documented in [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md).
The further evolution to per-tenant KEKs (and optionally true BYOK) is
documented as a feasibility study in
[SECRETS_BYOK_FEASIBILITY.md](./SECRETS_BYOK_FEASIBILITY.md).

---

## 4. Infrastructure secrets

Runtime infrastructure credentials loaded from `process.env`. All are
validated at boot by `env.ts`; missing required values cause fail-fast.

### 4.1 Database (PostgreSQL)

| Env var               | Required                      | Format                                              | Used by                      | Rotation cadence          | Notes                                                            |
| --------------------- | ----------------------------- | --------------------------------------------------- | ---------------------------- | ------------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`        | required                      | `postgresql://USER:PASS@HOST:PORT/DB?schema=public` | API, workers, Prisma migrate | NIST 1 year (DB password) | Embedded password is the credential; URL host/port may be public |
| `SHADOW_DATABASE_URL` | required for `prisma migrate` | Same shape                                          | Prisma migration tool        | Same as above             | Used only for shadow database during schema diffing              |

Rotation procedure: [T0A §2.1](./T0A_SECRETS_ROTATION_RUNBOOK.md#21-database-postgresql).

### 4.2 Cache and queue (Redis)

| Env var          | Required | Format                            | Used by                        | Rotation cadence             | Notes                                      |
| ---------------- | -------- | --------------------------------- | ------------------------------ | ---------------------------- | ------------------------------------------ |
| `REDIS_URL`      | optional | `redis://[USER]:[PASS]@HOST:PORT` | API cache port, BullMQ workers | NIST 1 year if password used | Preferred over the host/port/password trio |
| `REDIS_PASSWORD` | optional | string                            | API + workers                  | Same                         | Required only if Redis ACL is enabled      |

Rotation procedure: [T0A §2.9](./T0A_SECRETS_ROTATION_RUNBOOK.md#29-redis).

### 4.3 Authentication / sessions

Six independent JWT and cookie signing keys. Each must be at least 64
hex bytes (32 bytes of entropy). Generate with `openssl rand -hex 64`.

| Env var                    | Used by                   | Signs                              | Rotation cadence |
| -------------------------- | ------------------------- | ---------------------------------- | ---------------- |
| `JWT_ACCESS_SECRET`        | Customer access tokens    | Customer-facing JWT access tokens  | NIST 90 days     |
| `JWT_REFRESH_SECRET`       | Customer refresh tokens   | Customer-facing JWT refresh tokens | NIST 90 days     |
| `CUSTOMER_JWT_SECRET`      | Customer SDK / portal API | Customer programmatic JWTs         | NIST 90 days     |
| `ADMIN_JWT_ACCESS_SECRET`  | Admin app access tokens   | Admin-facing JWT access tokens     | NIST 90 days     |
| `ADMIN_JWT_REFRESH_SECRET` | Admin app refresh tokens  | Admin-facing JWT refresh tokens    | NIST 90 days     |
| `COOKIE_SECRET`            | Fastify `@fastify/cookie` | Signed-cookie integrity            | NIST 90 days     |

Rotation procedure: [T0A §2.2](./T0A_SECRETS_ROTATION_RUNBOOK.md#22-auth--jwt). All
six rotate independently; the typical pattern is staggered rotation
with a dual-key validity window so existing sessions stay valid until
their natural expiry.

### 4.4 Storage (S3 / MinIO)

| Env var                | Required                            | Used by         | Rotation cadence        | Notes                                                                                |
| ---------------------- | ----------------------------------- | --------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `S3_ACCESS_KEY_ID`     | conditional (`STORAGE_PROVIDER=s3`) | Storage adapter | NIST 1 year (cloud IAM) | Static IAM credential                                                                |
| `S3_SECRET_ACCESS_KEY` | conditional (`STORAGE_PROVIDER=s3`) | Storage adapter | NIST 1 year             | Static IAM credential — prefer instance role / OIDC where the deployment supports it |

The `STORAGE_PROVIDER=local` default disables S3 entirely. Rotation
procedure: cloud-provider IAM rotation; not in T0A because the credential
is not omni-post-controlled.

### 4.5 Logging and observability

No secrets in this category today. `LOG_LEVEL`, `METRICS_PORT`,
`TRACING_ENABLED`, and the OpenTelemetry config keys are non-secret
configuration. If a tracing collector or an external log sink with
authentication is added, it lands in §5.

---

## 5. Third-party customer credentials

Credentials issued by third-party services that omni-post calls outbound.
All are scoped to a single platform identity (one Stripe account, one
Resend account, etc.); per-tenant credentials live in §6.

### 5.1 AI providers

| Env var              | Used by                      | Rotation cadence      | Notes                                 |
| -------------------- | ---------------------------- | --------------------- | ------------------------------------- |
| `OPENAI_API_KEY`     | AI orchestrator (GPT models) | NIST 1 year (API key) | AI features auto-disable when missing |
| `PERPLEXITY_API_KEY` | AI orchestrator (Perplexity) | Same                  | Same                                  |
| `GEMINI_API_KEY`     | AI orchestrator (Gemini)     | Same                  | Same                                  |

Rotation procedure: [T0A §2.4](./T0A_SECRETS_ROTATION_RUNBOOK.md#24-ai-providers).
The `*_MODEL` companion variables (`OPENAI_MODEL`, etc.) are configuration,
not secrets.

### 5.2 Email (Resend)

| Env var          | Used by                       | Rotation cadence      | Notes                        |
| ---------------- | ----------------------------- | --------------------- | ---------------------------- |
| `RESEND_API_KEY` | Email service (transactional) | NIST 1 year (API key) | Outbound transactional email |

Rotation procedure: [T0A §2.6](./T0A_SECRETS_ROTATION_RUNBOOK.md#26-email-resend).
`RESEND_FROM_ADDRESS` is configuration, not a secret.

### 5.3 Analytics (GA4)

| Env var          | Used by                    | Rotation cadence | Notes                                          |
| ---------------- | -------------------------- | ---------------- | ---------------------------------------------- |
| `GA4_API_SECRET` | Measurement Protocol calls | NIST 1 year      | Server-to-server only; do not expose to client |

`GA4_MEASUREMENT_ID` and `GA4_ENDPOINT` are configuration, not secrets.

### 5.4 Payment

| Env var                 | Required when             | Used by                        | Rotation cadence |
| ----------------------- | ------------------------- | ------------------------------ | ---------------- |
| `STRIPE_SECRET_KEY`     | `PAYMENT_PROVIDER=stripe` | Billing service                | NIST 1 year      |
| `STRIPE_WEBHOOK_SECRET` | `PAYMENT_PROVIDER=stripe` | Webhook signature verification | NIST 1 year      |
| `PADDLE_API_KEY`        | `PAYMENT_PROVIDER=paddle` | Billing service                | NIST 1 year      |
| `PADDLE_WEBHOOK_SECRET` | `PAYMENT_PROVIDER=paddle` | Webhook signature verification | NIST 1 year      |

Rotation procedure: [T0A §2.5](./T0A_SECRETS_ROTATION_RUNBOOK.md#25-billing-stripe).
`PADDLE_SANDBOX` is a boolean flag, not a secret.

### 5.5 Provider OAuth client secrets

Eight social platforms follow the same trio pattern:

```text
{PLATFORM}_CLIENT_ID       — public, identifies the omni-post OAuth app
{PLATFORM}_CLIENT_SECRET   — secret, proves the request comes from omni-post
{PLATFORM}_REDIRECT_URI    — public, OAuth callback URL
```

Only the `_CLIENT_SECRET` is a secret. The other two are configuration.

| Provider    | Secret env var            | Rotation cadence                                     | Notes                                    |
| ----------- | ------------------------- | ---------------------------------------------------- | ---------------------------------------- |
| Facebook    | `FACEBOOK_CLIENT_SECRET`  | Provider-controlled (re-issue via developer console) | App secret                               |
| Instagram   | `INSTAGRAM_CLIENT_SECRET` | Same                                                 | Shares Meta developer flow with Facebook |
| X / Twitter | `X_CLIENT_SECRET`         | Same                                                 | OAuth 2.0 client secret                  |
| LinkedIn    | `LINKEDIN_CLIENT_SECRET`  | Same                                                 | OAuth 2.0 client secret                  |
| TikTok      | `TIKTOK_CLIENT_SECRET`    | Same                                                 | TikTok Marketing API                     |
| YouTube     | `YOUTUBE_CLIENT_SECRET`   | Same                                                 | Google OAuth client (Cloud Console)      |
| Pinterest   | `PINTEREST_CLIENT_SECRET` | Same                                                 | OAuth 2.0 client secret                  |
| Snapchat    | `SNAPCHAT_CLIENT_SECRET`  | Same                                                 | Snapchat Marketing API                   |

Provider OAuth secrets are rotated by re-issuing the credential in the
provider's developer console and updating the env var. The per-tenant
OAuth tokens (which are derived from these client secrets via the user
consent flow) are stored encrypted in the database — see
[§6 Per-tenant secrets](#6-per-tenant-secrets-database-stored-encrypted).

### 5.6 CRM integrations

| Env var                   | Used by               | Notes                        |
| ------------------------- | --------------------- | ---------------------------- |
| `HUBSPOT_CLIENT_ID`       | HubSpot OAuth flow    | Public client identifier     |
| `HUBSPOT_REDIRECT_URI`    | HubSpot OAuth flow    | Public callback URL          |
| `SALESFORCE_CLIENT_ID`    | Salesforce OAuth flow | Public client identifier     |
| `SALESFORCE_REDIRECT_URI` | Salesforce OAuth flow | Public callback URL          |
| `SALESFORCE_SANDBOX`      | Salesforce OAuth flow | Boolean toggle, not a secret |

CRM OAuth client secrets, when present, follow the same per-provider
pattern as §5.5. Per-tenant CRM credentials, after consent, are stored
encrypted in the database — see [§6](#6-per-tenant-secrets-database-stored-encrypted).

---

## 6. Per-tenant secrets (database-stored, encrypted)

Per-tenant credentials and tokens stored in the database. Each row is
classified per the taxonomy in
[SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md):

- **Class A** — symmetric encrypted with a KEK (rotation requires re-wrap)
- **Class B** — hashed (one-way, password-style; rotation = re-hash on update)
- **Class D** — HMAC / signing key for webhooks (shared with provider)
- **Class E** — temporary tokens (one-time use, short TTL)

(Class C is the historical category for plaintext red flags. The
inventory document tracks any remaining Class C entries.)

### 6.1 Class A — KEK-encrypted

| Model.field                                              | KEK                       | Storage shape                                                                                        | Notes                                                                     |
| -------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Channel.credentials`                                    | `PLATFORM_ENCRYPTION_KEY` | Envelope: `credentialsCiphertext` + `credentialsIv` + `credentialsAuthTag` + `credentialsKeyVersion` | Per-channel OAuth tokens / API secrets; AAD context binds to `channel.id` |
| `OidcConfiguration.clientSecret`                         | `PLATFORM_ENCRYPTION_KEY` | Envelope columns                                                                                     | Per-account OIDC client secret                                            |
| `ExternalNotificationConfig.webhookUrl`                  | `PLATFORM_ENCRYPTION_KEY` | Envelope columns                                                                                     | URLs may carry embedded auth tokens (Slack, Teams)                        |
| `PlatformCredential.encryptedValue` + `.iv` + `.authTag` | `PLATFORM_ENCRYPTION_KEY` | Envelope columns                                                                                     | Generic platform-credential blob                                          |
| `AccountCredential.encryptedValue` + `.iv` + `.authTag`  | `PLATFORM_ENCRYPTION_KEY` | Envelope columns                                                                                     | Per-account credential blob                                               |
| `ProviderConnection.accessToken`                         | `OAUTH_ENCRYPTION_KEY`    | Inline `iv:authTag:ciphertext` (single column)                                                       | Per-tenant OAuth access tokens                                            |
| `ProviderConnection.refreshToken`                        | `OAUTH_ENCRYPTION_KEY`    | Inline format                                                                                        | Per-tenant OAuth refresh tokens                                           |
| `ProviderConnection.apiSecret`                           | `OAUTH_ENCRYPTION_KEY`    | Inline format                                                                                        | Per-tenant provider API secrets                                           |

Rotation = re-wrap with the new KEK version using the
`*KeyVersion` discriminator. Procedure in
[T0A §3](./T0A_SECRETS_ROTATION_RUNBOOK.md#3-platform_encryption_key--consideración-especial)
and [T0A §10](./T0A_SECRETS_ROTATION_RUNBOOK.md#10-re-encryption-procedure-when-aad-changes)
(when AAD changes).

### 6.2 Class B — Hashed (one-way)

| Model.field                     | Algorithm | Parameters                        | Notes                                        |
| ------------------------------- | --------- | --------------------------------- | -------------------------------------------- |
| `AdminUser.passwordHash`        | Argon2id  | m=64 MiB, t=3, p=4, hashLength=32 | OWASP / RFC 9106 second-recommended          |
| `AdminUser.passwordHistory[]`   | Argon2id  | Same                              | Reuse-prevention history                     |
| `AdminUser.mfaBackupCodes[]`    | Argon2id  | Same                              | Plaintext shown once at generation           |
| `CustomerUser.passwordHash`     | Argon2id  | Same                              | Customer-facing                              |
| `AdminSession.refreshTokenHash` | SHA-256   | Single-pass                       | Looked up by hash; plaintext never persisted |
| `ApiKey.keyHash`                | SHA-256   | Single-pass                       | Same pattern as session refresh              |

Rotation is implicit: every successful login re-hashes via the
`needsRehash` path in
[apps/api/src/auth/passwordHashing.ts](../../apps/api/src/auth/passwordHashing.ts).
Argon2id parameters change in one place; user credentials transparently
upgrade on next login.

### 6.3 Class D — HMAC / webhook signing secrets

| Model.field                       | Generation                        | Use                                   | Notes                                      |
| --------------------------------- | --------------------------------- | ------------------------------------- | ------------------------------------------ |
| `WebhookSubscription.secretKey`   | `randomBytes(32).toString('hex')` | HMAC-SHA256 over webhook body         | Verified in webhook processors             |
| `WebhookSubscription.verifyToken` | `randomBytes(16).toString('hex')` | Provider-specific origin verification | Used by Facebook / Instagram webhook setup |

Shared secrets — omni-post generates, the provider stores. Rotation
procedure: regenerate locally, push to provider via their API or UI,
update the `WebhookSubscription` row. Detailed rotation cadence in
[T0A §7](./T0A_SECRETS_ROTATION_RUNBOOK.md#7-cryptoperiods-canónicos-nist-sp-800-57-part-1-rev-5).

### 6.4 Class E — Temporary tokens

| Model.field                     | Generation                        | TTL                 | Validation                                   |
| ------------------------------- | --------------------------------- | ------------------- | -------------------------------------------- |
| `AdminUser.passwordResetToken`  | `crypto.randomUUID()`             | 1 hour              | Plaintext lookup; UUID v4 = 122 bits entropy |
| `AdminUser.emailVerifyToken`    | Similar                           | per-token           | Plaintext lookup                             |
| `CustomerUser.emailVerifyToken` | Similar                           | `emailVerifyExpiry` | Plaintext lookup                             |
| `CustomerUser.resetToken`       | `randomBytes(32).toString('hex')` | 1 hour              | Plaintext lookup; 256 bits entropy           |
| `TeamMember.inviteToken`        | Similar                           | `inviteTokenExpiry` | Plaintext lookup                             |

These are not "rotated" in the traditional sense — they expire and are
discarded. The lifecycle is: issued by API → emailed to user once →
consumed (single-use) → marked used or expired. There is no graceful
window because there is no long-lived value.

---

## 7. CI/CD secrets

Two sections: the current location (where the CI/CD secrets live today)
and the target location (where they will live after deployment-time
secret delivery is in place per the architecture in
[SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)).

### 7.1 Current state

CI is GitHub Actions. CI-only secrets are stored in the repository's
GitHub Actions Secrets configuration. The set is small:

| Secret                            | Used by                                               | Notes                                                           |
| --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `GITHUB_TOKEN`                    | All workflows                                         | Auto-provisioned by GitHub Actions; scoped per workflow run     |
| Container registry credentials    | Image build / push workflows                          | Currently absent — only added when an image is published        |
| Application runtime secrets in CI | Integration tests that talk to live external services | Currently absent — integration tests run against local fixtures |

Pre-commit guards (`gitleaks`, `secretlint`) run via husky and block any
secret-shaped string in a commit. Configuration files for these tools
are themselves not secrets and live in the repository.

### 7.2 Target state

Per [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md),
the target is to remove static long-lived secrets from CI configuration
and consume from the chosen target store via:

- GitHub OIDC trust to the cloud secret manager (no static tokens in CI)
- Or: a CI-side CLI (`doppler run`, `op run`, `vault read`) that
  fetches secrets at job time
- Container registry push uses short-lived OIDC-issued credentials

The contract for the target state: zero plaintext secret values in
workflow YAML; every secret used by CI traces back to the central
target store.

---

## 8. Local-dev only secrets (NEVER in production)

These secrets exist purely to bootstrap a working development environment.
They must never be reused in any non-development environment.

### 8.1 Docker Compose service credentials

Read by [docker-compose.yml](../../docker-compose.yml) to parametrise
the local Postgres, MinIO, and Grafana containers. They are not loaded
by the API or workers.

| Env var                      | Service            | Notes                          |
| ---------------------------- | ------------------ | ------------------------------ |
| `POSTGRES_USER`              | Postgres container | Default `postgres`             |
| `POSTGRES_PASSWORD`          | Postgres container | Replace before any non-dev use |
| `POSTGRES_DB`                | Postgres container | Default `omnipostdb`           |
| `MINIO_ROOT_USER`            | MinIO container    | Default `minioadmin`           |
| `MINIO_ROOT_PASSWORD`        | MinIO container    | Replace before any non-dev use |
| `GF_SECURITY_ADMIN_USER`     | Grafana container  | Default `admin`                |
| `GF_SECURITY_ADMIN_PASSWORD` | Grafana container  | Replace before any non-dev use |

Production deployments use managed Postgres / object storage / Grafana
and do not consume these variables.

### 8.2 Admin bootstrap seed

| Env var          | Used by     | Notes                                                               |
| ---------------- | ----------- | ------------------------------------------------------------------- |
| `ADMIN_EMAIL`    | Seed script | Default `admin@omnipost.local`; identifies the bootstrap admin user |
| `ADMIN_PASSWORD` | Seed script | Replaced via the launch runbook in any non-dev environment          |

The seed script is invoked once at first boot of a new environment.
After the first admin user exists, this env var is no longer consulted.
Production launch must replace the default with a strong randomly
generated value; the bootstrap admin must immediately rotate that
password to one only the operator knows.

### 8.3 Bcrypt rounds

| Env var         | Default | Notes                                                                          |
| --------------- | ------- | ------------------------------------------------------------------------------ |
| `BCRYPT_ROUNDS` | 10      | Legacy parameter; the canonical password hashing path uses Argon2id (see §6.2) |

---

## Appendix A — Rotation cadence summary

Cryptoperiods consolidated from NIST SP 800-57 Part 1 Rev 5. Detailed
schedule template in
[T0A §7](./T0A_SECRETS_ROTATION_RUNBOOK.md#7-cryptoperiods-canónicos-nist-sp-800-57-part-1-rev-5).

| Category                                                                            | Cadence                        | Rotation method                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| Symmetric encryption keys (KEK) — `PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY` | 1 year                         | Re-wrap of all dependent ciphertexts using the version discriminator      |
| JWT signing keys — `JWT_*_SECRET`, `ADMIN_JWT_*_SECRET`, `CUSTOMER_JWT_SECRET`      | 90 days                        | Dual-key validity window; existing tokens stay valid until natural expiry |
| Session / cookie secrets — `COOKIE_SECRET`                                          | 90 days                        | Same dual-key window                                                      |
| Database password (embedded in `DATABASE_URL`)                                      | 1 year                         | Roll the DB role password, update env var, restart                        |
| Redis password (`REDIS_PASSWORD`)                                                   | 1 year                         | Same as DB                                                                |
| Storage credentials (`S3_*`)                                                        | 1 year (cloud IAM convention)  | Provider-side rotation                                                    |
| Third-party API keys (`OPENAI_*`, `RESEND_*`, `STRIPE_*`, etc.)                     | 1 year                         | Provider-side rotation; update env var                                    |
| Provider OAuth client secrets                                                       | Provider-controlled (re-issue) | Re-issue in provider console; update env var                              |
| Hashed values (Class B)                                                             | N/A (re-hash on update)        | Transparent rehash via `needsRehash`                                      |
| HMAC / webhook signing (Class D)                                                    | 1 year                         | Regenerate locally, push to provider, update DB row                       |
| Temporary tokens (Class E)                                                          | Per-token TTL (no rotation)    | Issued and consumed; never long-lived                                     |

---

## Appendix B — STRIDE per credential class

Map of the database-storage classes to STRIDE threats and the canonical
mitigations.

| Class                               | Primary STRIDE threats                   | Canonical mitigation                                                                                                         |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **A** — KEK-encrypted               | Tampering, Information Disclosure        | AES-256-GCM with AAD-bound `EncryptionContext` defeats both for any attacker without the KEK                                 |
| **B** — Hashed (Argon2id / SHA-256) | Spoofing, brute-force credential testing | Argon2id parameters from RFC 9106 second-recommended (m=64 MiB, t=3, p=4); SHA-256 sufficient for high-entropy lookup tokens |
| **D** — HMAC / signing              | Tampering, Repudiation                   | HMAC-SHA256 over the canonical payload; signature verification before action; audit log of every verification outcome        |
| **E** — Temporary tokens            | Elevation of Privilege                   | High-entropy generation (`crypto.randomUUID` / `randomBytes`); short TTL; single-use semantics                               |
| **C** — Plaintext (red flag)        | All five                                 | Should not exist; remediation tracked in [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)                    |

---

## Appendix C — Compliance framework mapping

Which controls each secret category supports under SOC2 / PCI-DSS /
GDPR / HIPAA. Detailed compliance interpretation lives in
[SECRETS_BYOK_FEASIBILITY.md §7](./SECRETS_BYOK_FEASIBILITY.md#7-compliance-benefits)
for the per-tenant case.

| Secret category                 | SOC2 (Trust Services Criteria) | PCI-DSS v4.0.1                    | GDPR                          | HIPAA Security Rule                    |
| ------------------------------- | ------------------------------ | --------------------------------- | ----------------------------- | -------------------------------------- |
| Master keys (§3)                | CC6.1, CC6.7                   | Req. 3.5, 3.6                     | Art. 32                       | §164.312(a)(2)(iv), §164.312(e)(2)(ii) |
| User passwords (§6.2 Class B)   | CC6.6                          | Req. 8.3                          | Art. 32                       | §164.308(a)(5)                         |
| OAuth tokens (§6.1 Class A)     | CC6.1, CC6.7                   | Req. 3 (if cardholder data flows) | Art. 32                       | §164.312(d)                            |
| Webhook signing (§6.3 Class D)  | CC6.7, CC6.8                   | Req. 4                            | Art. 32                       | §164.312(c)(1)                         |
| Temporary tokens (§6.4 Class E) | CC6.6                          | Req. 8                            | Art. 32                       | §164.308(a)(5)                         |
| Third-party API keys (§5)       | CC6.1                          | Provider-dependent                | Art. 28 (processor)           | §164.314(a)                            |
| Audit logging of secret access  | CC7.2, CC7.3                   | Req. 10                           | Art. 33 (breach notification) | §164.312(b)                            |

The audit-log row is implemented via `AuditService.logCredentialDecrypt`
in [apps/api/src/security/EncryptionService.ts](../../apps/api/src/security/EncryptionService.ts);
see [T0A §9](./T0A_SECRETS_ROTATION_RUNBOOK.md#9-decryption-audit-trail)
for the request-scoped enrichment via AsyncLocalStorage.

---

## Appendix D — Emergency procedures

Compromise-response runbook. For each scenario: detection signals,
immediate steps, verification, communication.

### D.1 Master key compromise

Signal: `PLATFORM_ENCRYPTION_KEY` or `OAUTH_ENCRYPTION_KEY` appears in
logs, git history, screenshots, error messages, or external dump.

Immediate steps:

1. Generate a new key (`openssl rand -base64 32` / `openssl rand -hex 32`).
2. Add it as the new active version (bump `keyVersion`); keep the
   compromised key in the prior-version map for the duration of re-wrap.
3. Run the re-wrap campaign for every Class A column
   (procedure: [T0A §3](./T0A_SECRETS_ROTATION_RUNBOOK.md#3-platform_encryption_key--consideración-especial)).
4. Verify via the audit log that no decrypt operations happened with
   the compromised key after rotation.
5. Drop the compromised key from env once verification is complete.

If the runtime model has migrated to KMS-backed envelope encryption
(see [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md)): the
procedure simplifies to "rotate the KEK in the KMS and run re-wrap";
the wrapped DEKs change, the data ciphertext stays.

### D.2 Single secret leak (env var)

Signal: a secret env var value is grepped from logs, git history,
issue tracker, or external dump.

Immediate steps:

1. Rotate the secret at the source (provider console, database role
   alter, key generation).
2. Update the runtime configuration with the new value.
3. Verify the leaked value no longer authenticates anywhere
   (revocation at the provider; password change verification in DB).
4. Audit recent usage of the leaked secret if the source supports it
   (Stripe events log, GitHub audit log, etc.).
5. If the leak is in git history, run a history purge
   ([T0A §4](./T0A_SECRETS_ROTATION_RUNBOOK.md#4-git-history-purge)).

### D.3 Customer credential compromise (Class A column)

Signal: a row of `Channel.credentials` or equivalent encrypted column
is suspected exposed (database dump, backup leak, decrypted audit
trail anomaly).

Immediate steps:

1. Revoke the credential at the provider (re-issue via developer
   console or API).
2. Mark the affected channel as needing reauth in the database; the
   tenant is forced through the reconnect flow on next use.
3. Notify the tenant (compliance: GDPR Art. 33 if personal data is
   exposed, contractual notification per SLA).
4. Audit recent provider-side activity attributable to the compromised
   credential.

### D.4 Database breach

Signal: unauthorised access to the production database is suspected or
confirmed.

Immediate steps:

1. Assume every Class A column is exposed if the master key is on the
   same host (current model) or if the KMS key was accessible from the
   compromised principal (KMS model).
2. Activate the master-key rotation procedure (D.1) with re-wrap.
3. Force a global session invalidation (rotate JWT signing keys per
   §4.3 with the dual-key window).
4. Force every tenant to reconnect every provider channel (treat all
   `ProviderConnection` rows as compromised).
5. Engage the compliance / legal channel for breach notification.
6. Cross-reference [T0A §6](./T0A_SECRETS_ROTATION_RUNBOOK.md#6-verification-checklist-post-rotation)
   verification checklist.

### D.5 Provider OAuth client secret compromise

Signal: `{PLATFORM}_CLIENT_SECRET` value is leaked.

Immediate steps:

1. Re-issue the client secret in the provider's developer console.
2. Update the env var in the runtime store.
3. Existing per-tenant OAuth tokens (`ProviderConnection.*`) remain valid
   because they are independent of the client secret; the client secret
   is only used during initial consent and refresh-token exchange.
4. Watch for refresh-token failures over the next refresh cycle and
   force tenant re-consent for any that fail.

### D.6 Contact

Emergency contact list and escalation path: [T0A Anexo A](./T0A_SECRETS_ROTATION_RUNBOOK.md#anexo-a--contacto-emergencia).

---

## Appendix E — Adding a new secret

Checklist for any contributor introducing a new secret.

1. **Add to the env schema.** Server-only secrets go in the `server`
   block of [apps/api/src/config/env.ts](../../apps/api/src/config/env.ts)
   (or the equivalent in the Next.js app under `apps/admin/lib/env.ts`
   / `apps/client/lib/env.ts`). Never expose a secret to the browser
   bundle — fitness function #17 enforces this for the Next.js apps.
2. **Add to `.env.example`.** Use the marker convention (`required`,
   `optional`, `conditional: X`, `default: X`).
3. **Classify.** Decide which section of this document the new secret
   belongs to: master key (§3), infrastructure (§4), third-party (§5),
   per-tenant DB-stored (§6), CI/CD (§7), or local-dev only (§8).
4. **Add a row to this document.** Pick the relevant table and include
   the env var name (or DB column), format, consumer, rotation cadence,
   and notes.
5. **Add a rotation entry.** If rotation is non-trivial (anything beyond
   "re-issue at the provider and update env var"), add a section to
   [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md).
6. **Classify under DATABASE_INVENTORY.** If the secret is stored in the
   database, assign Class A / B / C / D / E and add the row to
   [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md).
7. **Verify the pre-commit guards.** `secretlint` and `gitleaks` run
   automatically; confirm the new secret pattern is detected if a
   plaintext value is accidentally staged.
8. **Update fitness functions if needed.** New secret patterns may
   warrant a new regex in the fitness suite documented in `CLAUDE.md`.

---

## Appendix F — Cross-references

- **Production deployment delivery** (where secrets live in production
  runtimes, ESO / SOPS / dotenvx / Doppler / Vault) → [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)
- **KMS migration** (envelope encryption, KEK / DEK model, four KMS
  options, re-wrap procedure) → [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md)
- **BYOK feasibility** (per-tenant key isolation, three levels L1 / L2 /
  L3, schema impact, compliance benefits, implementation phases) →
  [SECRETS_BYOK_FEASIBILITY.md](./SECRETS_BYOK_FEASIBILITY.md)
- **Rotation procedures** (per-secret step-by-step, NIST cryptoperiods,
  Argon2id parameters, decryption audit trail) →
  [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- **Database-storage taxonomy** (Class A / B / C / D / E definitions,
  per-column inventory, encryption infrastructure summary) →
  [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- **Architecture overview** (env layer, t3-env, Zod validation, fitness
  functions for env access) → [../architecture/secrets-and-env.md](../architecture/secrets-and-env.md)
