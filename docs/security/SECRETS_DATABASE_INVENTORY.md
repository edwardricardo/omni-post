# Database-Stored Secrets Inventory

> Comprehensive map of every Prisma field in `infra/prisma/schema.prisma`
> that stores a secret, credential, password hash, OAuth token, MFA secret,
> webhook signing key, or temporary access token.
>
> Classification scheme:
>
> - **Class A** — Symmetric encrypted with a Key Encryption Key (KEK)
> - **Class B** — Hashed (one-way, password-style)
> - **Class C** — Plaintext-stored (red flag if it's a credential)
> - **Class D** — HMAC / signing key for webhooks
> - **Class E** — Temporary tokens (password reset, email verify, magic links)

## Class A — KEK-encrypted (rotation requires re-wrap)

| Model.field                         | Type     | Encryption Pattern                                     | KEK Source                          | Notes                               |
| ----------------------------------- | -------- | ------------------------------------------------------ | ----------------------------------- | ----------------------------------- |
| `PlatformCredential.encryptedValue` | `String` | AES-256-GCM, IV + authTag stored separately            | `env.PLATFORM_ENCRYPTION_KEY` (b64) | Full envelope structure on row      |
| `PlatformCredential.iv`             | `String` | random 12 bytes per encryption (base64)                | —                                   | Stored on row alongside ciphertext  |
| `PlatformCredential.authTag`        | `String` | 16-byte GCM auth tag (base64)                          | —                                   | Tamper-detection                    |
| `AccountCredential.encryptedValue`  | `String` | Same pattern as PlatformCredential                     | `env.PLATFORM_ENCRYPTION_KEY`       | Per-account (per-tenant) credential |
| `AccountCredential.iv`              | `String` | random 12 bytes (base64)                               | —                                   |                                     |
| `AccountCredential.authTag`         | `String` | 16-byte tag (base64)                                   | —                                   |                                     |
| `ProviderConnection.accessToken`    | `String` | AES-256-GCM, **inline format** `iv:authTag:ciphertext` | `env.OAUTH_ENCRYPTION_KEY` (hex)    | OAuth access tokens (per-platform)  |
| `ProviderConnection.refreshToken`   | `String` | Same inline format                                     | `env.OAUTH_ENCRYPTION_KEY`          | OAuth refresh tokens                |
| `ProviderConnection.apiSecret`      | `String` | Same inline format                                     | `env.OAUTH_ENCRYPTION_KEY`          | Provider-API secrets                |

**Bug found**: `enhancedOAuthProvider.encryptToken()` has a fallback to
plaintext when encryption throws (line 578 area). Mixed plaintext/encrypted
tokens can land in the same column. **P0 fix in Batch 06.**

**Gap**: no `keyVersion` column on any of these rows. Rotation requires
re-encrypting every row with the new KEK in-place — no graceful overlap
window. **P0 fix in Batch 06**: introduce `keyVersion: Int @default(1)` on
`PlatformCredential`, `AccountCredential`, `ProviderConnection`.

## Class B — Hashed (one-way, password-style)

| Model.field                   | Hash Algorithm | Parameters                                    | Notes                                                                                                  |
| ----------------------------- | -------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AdminUser.passwordHash`      | Argon2id       | memory 65 536 (64 MiB), time 3, parallelism 4 | Meets OWASP 2023+ minimum                                                                              |
| `AdminUser.passwordHistory[]` | Argon2id       | Same                                          | Historical hashes for reuse-prevention                                                                 |
| `AdminUser.mfaBackupCodes[]`  | Argon2id       | Same                                          | Backup codes hashed; plaintext shown once                                                              |
| `CustomerUser.passwordHash`   | Argon2id       | Same                                          | Customer-facing                                                                                        |
| `ApiKey.keyHash`              | SHA-256        | Single-pass via `crypto.createHash`           | Full API key never persisted; only hash stored. Key prefix `sk_…` plus 32-byte body — only hash stays. |

**Audit (Batch 07)**: confirm Argon2id parameters meet OWASP **2026**
recommendation. Current params likely OK; doc params authoritatively in
the runbook §8 and add boot-time logger with chosen values.

## Class C — Plaintext red flags

| Model.field                             | Content Type              | Severity     | Status                                                                                                                |
| --------------------------------------- | ------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `OidcConfiguration.clientSecret`        | OIDC client secret string | **CRITICAL** | **P0** — must be encrypted (Batch 06)                                                                                 |
| `Channel.credentials` (`Json`)          | OAuth tokens, API keys    | **CRITICAL** | **P0** — must be encrypted (Batch 06)                                                                                 |
| `SamlConfiguration.idpCertificate`      | X.509 PEM certificate     | LOW          | Public certificate by design — OK                                                                                     |
| `ExternalNotificationConfig.webhookUrl` | Webhook URL string        | MEDIUM       | May contain embedded auth tokens (Slack, Teams) — encrypt in Batch 06                                                 |
| `AdminSession.accessToken` (optional)   | JWT access token          | MEDIUM       | Stored plaintext "for tracking" — should be removed or hashed (Batch 06)                                              |
| `AdminSession.refreshToken`             | JWT refresh token         | MEDIUM       | Plaintext for `@unique` lookup; canonical pattern is to store SHA-256 hash and look up by hash. Refactor in Batch 06. |

## Class D — HMAC / webhook signing secrets

| Model.field                       | Generation                        | Storage   | Verification                                                            |
| --------------------------------- | --------------------------------- | --------- | ----------------------------------------------------------------------- |
| `WebhookSubscription.secretKey`   | `randomBytes(32).toString('hex')` | PLAINTEXT | HMAC-SHA256 over body; verified in webhook processors (LinkedIn etc.)   |
| `WebhookSubscription.verifyToken` | `randomBytes(16).toString('hex')` | PLAINTEXT | Provider-specific (Facebook, Instagram) — used to verify webhook origin |

These are **shared secrets between us and the provider** (we generate,
provider stores). Encrypting at rest is best-practice but not blocking
because the same value lives in the provider's UI; rotation procedure
documented in `T0A_SECRETS_ROTATION_RUNBOOK.md` §7.

## Class E — Temporary tokens (one-time use)

| Model.field                     | Generation                        | Expiry               | Validation       | Risk                                                |
| ------------------------------- | --------------------------------- | -------------------- | ---------------- | --------------------------------------------------- |
| `AdminUser.passwordResetToken`  | `crypto.randomUUID()`             | 1 hour               | Plaintext lookup | UUID v4 has 122 bits entropy; timing-safe lookup OK |
| `AdminUser.emailVerifyToken`    | (similar pattern)                 | configured per token | Plaintext lookup | Same as reset token                                 |
| `CustomerUser.emailVerifyToken` | TBD (verify via grep)             | `emailVerifyExpiry`  | Plaintext lookup | Same                                                |
| `CustomerUser.resetToken`       | `randomBytes(32).toString('hex')` | 1 hour               | Plaintext lookup | 256 bits entropy; OK                                |
| `TeamMember.inviteToken`        | (verify via grep)                 | `inviteTokenExpiry`  | Plaintext lookup | Time-bounded                                        |

**Canon improvement (Batch 06)**: store SHA-256 hash of these tokens
instead of plaintext. Lookup by hash; user receives plaintext via email
once. Same pattern as ApiKey.keyHash — protects against DB exfiltration
exposing live reset tokens.

## Encryption infrastructure summary

### `EncryptionService` (`apps/api/src/security/EncryptionService.ts`)

- Algorithm: **AES-256-GCM**
- IV: 12 random bytes per encryption
- Auth tag: 16 bytes (full strength)
- Output format: `{encryptedValue, iv, authTag}` separate fields (envelope-friendly)
- KEK: env var `PLATFORM_ENCRYPTION_KEY`, base64-decoded → 32 bytes
- **No KDF**: raw key bytes used. KDF (HKDF) per-tenant DEK derivation = future BYOK feature.
- **Tamper detection**: `decryptCipher.setAuthTag()` then `decipher.final()` throws on mismatch.

### `enhancedOAuthProvider` token encryption

- Same algorithm AES-256-GCM
- KEK: `env.OAUTH_ENCRYPTION_KEY`, hex-decoded → 32 bytes
- **Inline format**: `${iv_hex}:${authTag_hex}:${ciphertext_hex}` — single string column
- **BUG**: silent fallback to plaintext if encryption throws (mix of plaintext + encrypted in same column over time)

### Key versioning — gap

- `PlatformEncryptionKey` model exists with `keyVersion: Int` — appears unused (orphan / scaffolding).
- No `keyVersion` column on `PlatformCredential`, `AccountCredential`, `ProviderConnection`, or `Channel`.
- Single-KEK rotation requires re-encrypting every row; no graceful overlap window. **Closed in Batch 06**.

### Per-tenant keys — gap

- Single global KEK (`PLATFORM_ENCRYPTION_KEY` + `OAUTH_ENCRYPTION_KEY`) for all data across all tenants.
- BYOK / per-tenant DEK derivation is the canon path for multi-tenant SaaS maturity.
- Decision documented as feasibility study (`SECRETS_BYOK_FEASIBILITY.md`).

## Gap → batch mapping

| Gap                                               | Severity | Closed in                       |
| ------------------------------------------------- | -------- | ------------------------------- |
| `Channel.credentials` plaintext                   | CRITICAL | Batch 06                        |
| `OidcConfiguration.clientSecret` plaintext        | CRITICAL | Batch 06                        |
| `encryptToken()` plaintext fallback               | CRITICAL | Batch 06                        |
| No `keyVersion` columns                           | HIGH     | Batch 06                        |
| No decryption audit log                           | MEDIUM   | Batch 08                        |
| Argon2id params not authoritatively documented    | LOW      | Batch 07                        |
| `AdminSession.refreshToken` plaintext lookup      | MEDIUM   | Batch 06                        |
| `ExternalNotificationConfig.webhookUrl` plaintext | MEDIUM   | Batch 06                        |
| Temp tokens stored plaintext (reset, verify)      | MEDIUM   | Batch 06                        |
| Per-tenant DEKs (BYOK)                            | FUTURE   | Batch 15 (feasibility doc only) |

## See also

- `docs/architecture/secrets-and-env.md` — env-layer secrets architecture
- `docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md` — operational rotation procedures + NIST cadences (§7) + Argon2id params (§8) + decryption audit (§9)
- `docs/security/SECRETS.md` — operator reference manual (where each secret lives + how to rotate)
- `docs/security/SECRETS_PRODUCTION_ARCHITECTURE.md` — KMS / SOPS / dotenvx / ESO migration paths
- `docs/security/SECRETS_KMS_MIGRATION.md` — KEK move from `.env` to managed KMS
- `docs/security/SECRETS_BYOK_FEASIBILITY.md` — per-tenant DEK study
