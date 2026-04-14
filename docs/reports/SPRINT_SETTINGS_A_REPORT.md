# Sprint SETTINGS-A — Platform Settings API Endpoints Report

**Date:** 2026-04-13
**Branch:** Genesis
**Status:** COMPLETE

---

## Objective

Expose REST endpoints for managing encrypted platform credentials (admin) and BYOK AI keys (client). Wraps the EncryptionService + PlatformCredentialService from Sprint CRYPTO with validation, masking, connection testing, and rate limit tracking.

---

## Schema (1 model)

### AiTokenUsage

Granular AI token tracking per account, per provider.

```prisma
model AiTokenUsage {
  id         String   @id @default(cuid())
  accountId  String
  provider   String   // "openai" | "anthropic" | "gemini" | "perplexity"
  tokensUsed Int
  usedAt     DateTime @default(now())
  isByok     Boolean  @default(false)
  @@index([accountId, usedAt])
}
```

Migration: `infra/prisma/migrations/20260414014352_add_ai_token_usage/migration.sql`

---

## Endpoints

### Admin (requireAdminAuth + requireSuperAdmin)

| Method | Path                                    | Description                                        |
| ------ | --------------------------------------- | -------------------------------------------------- |
| GET    | `/api/admin/settings/status`            | Configuration status for all 18 credential groups  |
| GET    | `/api/admin/settings/:group`            | Masked credentials for a group                     |
| PUT    | `/api/admin/settings/:group`            | Store credentials (body: `{ credentials: {...} }`) |
| POST   | `/api/admin/settings/:group/test`       | Test connection to external service                |
| DELETE | `/api/admin/settings/:group/:key`       | Delete a single credential                         |
| POST   | `/api/admin/settings/encryption/rotate` | Log encryption key rotation                        |

### Client (requireClientAuth)

| Method | Path                              | Description                      |
| ------ | --------------------------------- | -------------------------------- |
| GET    | `/api/settings/ai`                | AI rate limit status + BYOK info |
| PUT    | `/api/settings/ai/byok`           | Store BYOK API key               |
| DELETE | `/api/settings/ai/byok/:provider` | Delete BYOK key                  |
| POST   | `/api/settings/ai/byok/test`      | Test BYOK key                    |

---

## Services

### SettingsService (`apps/api/src/settings/SettingsService.ts`)

- Constructor injection: `PlatformCredentialService` + `PrismaClient`
- Result pattern for all fallible operations
- **Masking:** first 4 + `••••••••` + last 4 chars; values <= 8 chars = full dots; `NON_SECRET_KEYS` shown in plaintext
- **Connection testing:** lightweight `fetch()` per group — no SDK imports
  - STRIPE: `GET /v1/balance`
  - PADDLE: `GET /customers?per_page=1` (sandbox-aware)
  - RESEND: `GET /domains`
  - AI_POOL: provider-specific models endpoint
  - STORAGE: HEAD to bucket endpoint
  - SOCIAL\_\*: provider verification endpoints
  - PLATFORM/MONITORING: no-op success
- **AI rate limit:** aggregates `AiTokenUsage` for current month, checks BYOK via `AccountCredential`

### credentialKeys.ts (`apps/api/src/settings/credentialKeys.ts`)

- `CREDENTIAL_KEYS`: whitelist of expected keys per `CredentialGroup` (18 groups)
- `NON_SECRET_KEYS`: set of keys returned in plaintext (config values, not secrets)

### settingsSchemas.ts (`apps/api/src/settings/settingsSchemas.ts`)

Zod schemas: `credentialGroupSchema`, `groupParamsSchema`, `groupKeyParamsSchema`, `updateCredentialsSchema`, `rotateEncryptionSchema`, `setByokSchema`, `byokProviderParamsSchema`, `testByokSchema`

---

## DI Registration

| Token                    | Lifecycle |
| ------------------------ | --------- |
| `TOKENS.SettingsService` | Singleton |

---

## Tests

### SettingsService.test.ts (30 tests)

| Group                    | Count | Coverage                                                                                                |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------- |
| getGroupSettings         | 6     | masked secrets, plain non-secrets, null unconfigured, short values, all keys present, error propagation |
| setGroupSettings         | 4     | reject unknown keys, call per key, success, first error stops                                           |
| getConfigurationStatus   | 4     | healthy, partial, unconfigured, correct group mapping                                                   |
| testConnection           | 6     | PLATFORM/MONITORING no-op, no-creds failure, STRIPE success/failure, latencyMs                          |
| logEncryptionKeyRotation | 2     | creates record + audit log, version increment                                                           |
| getAiRateLimit           | 5     | BYOK true/false, remainingTokens, resetDate, zero records                                               |
| setByokKey               | 1     | delegates correctly                                                                                     |
| deleteByokKey            | 1     | delegates correctly                                                                                     |
| testByokKey              | 3     | success, failure, unknown provider                                                                      |

### settingsRoutes.test.ts (14 tests)

Zod schema validation tests for all 8 schemas covering valid inputs, invalid inputs, missing fields, and edge cases.

---

## Verification

```
pnpm build           → 9/9 tasks, 0 TS errors
pnpm --filter @apps/api test → 361 files, 7,281 tests, 0 failures, 0 cancelled
```

---

## Files Created

| File                                                   | Type                       |
| ------------------------------------------------------ | -------------------------- |
| `apps/api/src/settings/credentialKeys.ts`              | Credential key definitions |
| `apps/api/src/settings/SettingsService.ts`             | Business logic service     |
| `apps/api/src/settings/settingsSchemas.ts`             | Zod validation schemas     |
| `apps/api/src/settings/settingsRoutes.ts`              | Fastify route plugin       |
| `apps/api/tests/unit/settings/SettingsService.test.ts` | 30 unit tests              |
| `apps/api/tests/unit/settings/settingsRoutes.test.ts`  | 14 schema tests            |

## Files Modified

| File                                                     | Change                                           |
| -------------------------------------------------------- | ------------------------------------------------ |
| `infra/prisma/schema.prisma`                             | +AiTokenUsage model, +Account relation           |
| `apps/api/src/infrastructure/container/types.ts`         | +TOKENS.SettingsService                          |
| `apps/api/src/infrastructure/container/setupServices.ts` | +SettingsService import + singleton registration |
| `apps/api/src/index.ts`                                  | +settingsRoutes import + registration            |
