# Sprint CRYPTO — Encryption Service + Platform Credentials Schema Report

**Date:** 2026-04-13
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Establish encrypted credential storage for platform-wide secrets (Stripe, Paddle, Resend, AI keys, social provider tokens) and per-account BYOK credentials. The master key (`PLATFORM_ENCRYPTION_KEY`) lives exclusively in `.env` — never in the database.

---

## Schema (3 models + 2 enums)

### Enums

| Enum                     | Values                                                                                                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CredentialGroup`        | STRIPE, PADDLE, RESEND, STORAGE, MONITORING, AI_POOL, PLATFORM, SOCIAL_FACEBOOK, SOCIAL_INSTAGRAM, SOCIAL_X, SOCIAL_YOUTUBE, SOCIAL_TIKTOK, SOCIAL_LINKEDIN, SOCIAL_SNAPCHAT, SOCIAL_TELEGRAM, SOCIAL_PINTEREST, SOCIAL_BLUESKY, SOCIAL_THREADS |
| `AccountCredentialGroup` | AI_BYOK                                                                                                                                                                                                                                         |

### Models

| Model                   | Purpose                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `PlatformCredential`    | Global encrypted credentials keyed by `(group, key)` with audit trail |
| `AccountCredential`     | Per-account encrypted credentials keyed by `(accountId, group, key)`  |
| `PlatformEncryptionKey` | Key rotation metadata (version, rotatedAt, rotatedBy)                 |

Relation added: `Account.accountCredentials AccountCredential[]`

Schema applied via `prisma db push` (shadow DB incompatibility with prior migrations prevented `migrate dev`).

---

## Services

### EncryptionService (`apps/api/src/security/EncryptionService.ts`)

- AES-256-GCM with 12-byte random IV per encrypt call
- Constructor validates `PLATFORM_ENCRYPTION_KEY` is exactly 32 bytes base64
- `encrypt(plaintext)` returns `{ encryptedValue, iv, authTag }` (all base64)
- `decrypt(encrypted)` verifies auth tag for tamper detection
- `isConfigured()` returns boolean
- `static generateKey()` generates a new random 32-byte key

### PlatformCredentialService (`apps/api/src/security/PlatformCredentialService.ts`)

- Constructor injection: `PrismaClient` + `EncryptionService`
- Uses Result pattern (`ok`/`err`) for all operations
- **Platform credentials:** `setCredential`, `getCredential`, `getGroup`, `deleteCredential`
- **Account credentials:** `setAccountCredential`, `getAccountCredential`, `deleteAccountCredential`
- **Query-only:** `isGroupConfigured`, `listConfiguredGroups` (no decryption)
- Audit log on set/delete — group and key only, never plaintext

### Key Generation Script (`apps/api/src/security/generateEncryptionKey.ts`)

Standalone script: `npx tsx apps/api/src/security/generateEncryptionKey.ts`

---

## DI Registration

| Token                              | Lifecycle | File                                                     |
| ---------------------------------- | --------- | -------------------------------------------------------- |
| `TOKENS.EncryptionService`         | Singleton | `apps/api/src/infrastructure/container/types.ts`         |
| `TOKENS.PlatformCredentialService` | Singleton | `apps/api/src/infrastructure/container/setupServices.ts` |

---

## Barrel Export Fix

`CredentialGroup` and `AccountCredentialGroup` enums were missing from `infra/prisma/src/client.ts` re-exports. Added to the explicit enum export list so downstream `import { CredentialGroup } from "@infra/prisma"` resolves correctly.

---

## Tests

### EncryptionService (17 tests)

| Group        | Tests                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| constructor  | throws without key, throws wrong length, initializes with valid key                         |
| encrypt      | returns 3 fields, unique ciphertexts, unique IVs, base64 encoded, empty string, long string |
| decrypt      | round-trip, tampered authTag/value/iv, wrong key, unicode, JSON                             |
| isConfigured | returns true with valid key                                                                 |
| generateKey  | 44-char base64 (32 bytes), different on each call                                           |

Original test used `require()` which is incompatible with ESM/Vitest — rewritten with static imports.

### PlatformCredentialService (15 tests)

| Group                   | Tests                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| setCredential           | encrypts before DB write, upserts without duplicates, audit log no plaintext |
| getCredential           | null when missing, decrypts correctly                                        |
| getGroup                | decrypted key-value map, empty when no credentials                           |
| deleteCredential        | deletes from DB + audit log                                                  |
| isGroupConfigured       | true/false, no decrypt calls                                                 |
| listConfiguredGroups    | returns only active groups, no decrypt calls                                 |
| setAccountCredential    | encrypts before write, scopes by accountId                                   |
| getAccountCredential    | null for wrong accountId, decrypts for correct accountId                     |
| deleteAccountCredential | deletes scoped to accountId                                                  |

---

## Verification

```
pnpm build           → 9/9 tasks, 0 TS errors
pnpm --filter @apps/api test → 359 files, 7,227 tests, 0 failures, 0 cancelled
```

---

## Files Changed

| File                                                             | Action                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                     | Added 3 models, 2 enums, Account relation                 |
| `infra/prisma/src/client.ts`                                     | Added CredentialGroup + AccountCredentialGroup re-exports |
| `apps/api/src/security/EncryptionService.ts`                     | New — AES-256-GCM service                                 |
| `apps/api/src/security/PlatformCredentialService.ts`             | New — encrypted CRUD service                              |
| `apps/api/src/security/generateEncryptionKey.ts`                 | New — key generation script                               |
| `apps/api/src/infrastructure/container/types.ts`                 | Added 2 DI tokens                                         |
| `apps/api/src/infrastructure/container/setupServices.ts`         | Registered both services as singletons                    |
| `.env.example`                                                   | Added `PLATFORM_ENCRYPTION_KEY=`                          |
| `apps/api/tests/unit/security/EncryptionService.test.ts`         | New — 17 tests (rewritten from require to ESM import)     |
| `apps/api/tests/unit/security/PlatformCredentialService.test.ts` | New — 15 tests                                            |
