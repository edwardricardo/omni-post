# ADR-0034: Credential model — placement, one encryption seam, key custody, verifiers, rotation

- **Status**: Accepted
- **Date**: 2026-10-06
- **Deciders**: Edward
- **Supersedes**: — (no accepted ADR; it takes the number and the place of the narrower "ADR-0034 — channel
  credentials, one cipher" that DEF-29 PR 2 planned under its task T-2.4 and never wrote, see Context)
- **Superseded by**: —
- **Related**: [ADR-0025](ADR-0025-payment-gateway-selection-and-country-routing.md) (gateways configured in Admin,
  decision 2), [ADR-0028](ADR-0028-storage-configuration-and-media-access.md) (storage configured in Admin, decisions
  2, 3, 8 and 9), [ADR-0022](ADR-0022-rls-enforcement-posture.md) (RLS posture; cites the AAD-bound channel cipher),
  [ADR-0033](ADR-0033-layer-boundaries-and-composition-root-injection.md) (ports are application-owned; routes pass
  primitives), [ADR-0007](ADR-0007-di-composition-root.md) (composition root per executable),
  [ADR-0013](ADR-0013-three-logger-factory-model.md) (logger factories; amended here on redaction),
  [ADR-0021](ADR-0021-trusted-proxy-peer-model.md) (the boot-time interlock the `KEY_PROVIDER` switch copies)

## Context

On 2026-10-05, at `main` `8710327d`, every credential the platform reads, stores or caches was inventoried
(`/root/.claude/omnipost-tools/research-2026-10-05/credential-inventory.md`, engram #1300). The core is right: platform
secrets come from a typed, fail-fast environment (`apps/api/src/config/env.ts`, `apps/workers/src/config/env.ts`),
five database column families are encrypted with AES-256-GCM, a per-row AAD and a stored key version
(`Channel.credentials`, `OidcConfiguration.clientSecret`, `ExternalNotificationConfig.webhookUrl`,
`PlatformCredential.encryptedValue`, `AccountCredential.encryptedValue`), and passwords and backup codes use Argon2id
through one helper (`apps/api/src/auth/passwordHashing.ts`, fitness #18). Measured: 39 live secret names in the
environment (6 signing keys, 5 key-material values, 10 infrastructure credentials, 9 third-party keys, 8 OAuth client
secrets, 1 bootstrap) plus 2 untyped reads and 2 dead names; 28 secret-bearing database columns (5 encrypted
families, 9 hashed, 8 plaintext retrievable secrets, 6 plaintext bearer verifiers); 8 Redis namespaces and one
in-process store.

What is not right is the inconsistency around that core, and it is measured, not argued:

1. **Retrievable tenant secrets stored in plaintext**: both TOTP seeds (`AdminUser.mfaSecret`, `schema.prisma:186`;
   `CustomerUser.mfaSecret`, `:357`, written by `apps/api/src/admin/auth/MfaService.ts:120-126`), the CRM OAuth tokens
   (`CrmConnection.accessToken`/`refreshToken`, `:2853-2854`, posted by the client at `crm/crmRoutes.ts:35-36`), the
   per-subscription webhook secrets (`WebhookSubscription.secretKey`/`previousSecretKey`, `:1584-1591`) and the
   Zapier/Make hook URLs (`IntegrationSubscription.targetUrl`, `:2699`).
2. **Bearer verifiers kept in plaintext and looked up by equality**: `AdminUser.passwordResetToken` (`:183`),
   `CustomerUser.resetToken` (`:354`) and `CustomerUser.inviteToken` (`:367`); `CustomReport.shareToken` and
   `DsarRequest.verificationToken` have no reader yet.
3. **The same operator credential in two places, the visible one unread**: the Admin `STRIPE`, `PADDLE`, `RESEND` and
   `STORAGE` groups of `PlatformCredential` are written and tested through `PlatformCredentialService`
   (`packages/core/security/src/PlatformCredentialService.ts:77-104`) while the runtime builds its adapters from env
   (`infrastructure/billing/GatewayAdapterRegistry.ts:80-110`, `infrastructure/adapters/ResendEmailAdapter.ts:28`,
   `infrastructure/storage/createStorageAdapter.ts:53-80`); the AI pool keys are read from env by the admin
   orchestrator (`ai/orchestrator.ts:116-157`) and from the DB `AI_POOL` group by customer requests
   (`packages/core/ai/src/AiRequestService.ts:109`); the per-network app registrations are read from the API's env only
   (`auth/providerOAuthConfigs.ts:111-126`), are absent from the workers' env, and have an unread third copy in the Admin
   `SOCIAL_*` groups (`packages/core/settings/src/credentialKeys.ts:60-70`). ADR-0025 (decision 2) and ADR-0028
   (decisions 2 and 3) had already chosen the direction for gateways and storage: Admin is the single source, the
   environment variables leave (F14, F15). This ADR applies that criterion to every operator-provisioned credential.
4. **Rotation on paper**: the "re-wrap script" that `apps/api/src/security/EncryptionService.ts:241` tells the operator
   to run does not exist; `PlatformEncryptionKey` (`schema.prisma:3572`) and `SecretRotationLog` (`:290`) are two
   rotation logs that drive nothing; the JWT/cookie dual-key window the runbook prescribes
   (`docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md`, "Dual-key validity windows") is not implemented (no `kid`, no
   previous key); `OAUTH_ENCRYPTION_KEY` is required at boot (`config/env.ts:119`) for a table dropped on 2026-05-07.
5. **Redaction only in `apps/api`**: `REDACT_PATHS` (`apps/api/src/lib/logger.ts:14-35`) lacks `appPassword`,
   `clientSecret`, `appSecret`, `botToken`, `mfaSecret` and the nested forms; the workers and every provider package log
   through `@observability/logger`, a bare `pino()` with no `redact` option (`packages/observability/logger/src/index.ts:30-38`).
6. **The channel credential model**: the API's `PrismaChannelRepository` projects the decrypted blob to five OAuth
   fields on read (`parseCredentials`, `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts:54-62`,
   applied at `:115`) and rebuilds those five on save (`:333-351`), so any save through the repository turns a Bluesky
   row `{identifier, appPassword}` into `{"accessToken":""}` (DEF-37, confirmed at runtime with the real
   `SetPrimaryChannelUseCase`, engram #1294); the OAuth callback stores three generic fields
   (`auth/providerOAuthFlow.ts:193-197`) while every adapter's `REQUIRED_FIELDS` demands app-level keys and per-channel
   ids inside the same blob (`packages/providers/x/src/XAdapter.ts:43`, `facebook/src/FacebookAdapter.ts:45-50`, …), so
   no OAuth-connected channel publishes (DEF-36, DEF-38). DEF-29 (the workers could not decrypt what the API wrote) was
   fixed by PR #429 with one AAD-bound, version-aware cipher in the shared kernel
   (`packages/shared/src/channelCredentialsCrypto.ts`); its PR 2 makes `EncryptionService` and the seed delegate to it.
7. **Short-lived state in process memory**: the OIDC PKCE verifier and state live in a per-process `Map`
   (`auth/oidcRoutes.ts:63-70`), lost on restart and invisible to other pods, while the provider OAuth flow already
   keeps the same state in Redis with a TTL (`auth/oauth/OAuthFlowStore.ts`).

Four decisions were taken by Edward on 2026-10-06 and are recorded in engram: D1+D2 final (#1305, after the correction
#1304 that D2 had been framed without ADR-0025/0028 in view), D3 (#1303) and D4 (#1306). This document records them as
one model, so that the surgical unit (DEF-37), the write-path redesign, the key-custody units and the plaintext fixes
all implement the same rule instead of four local ones.

This ADR supersedes the narrower ADR-0034 that DEF-29's PR 2 planned under its task T-2.4
(`ADR-0034-channel-credentials-one-cipher.md`, "channel credentials, one cipher", never written): the cipher
unification is decision 3 below, which PR 2 applies and cites instead of recording it in a document of its own.

## Decision

1. **Taxonomy and placement rule.** Every secret the platform touches belongs to exactly one class, and the class
   decides where it lives and how it is protected:

   | Class                                          | What it is here                                                                                                                                                                                                                                                                                                                                                                              | Lives in                                                                                                                                                                                                                             | Protection                                                                                                                                               |
   | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **P-boot — platform bootstrap secret**         | database and Redis URLs and passwords; the six JWT/cookie signing keys; the key-encryption key ring or the KMS reference under `KEY_PROVIDER`; the deletion-name digest ring; observability DSNs                                                                                                                                                                                             | each executable's typed, fail-fast env schema, with shared Zod fragments for values both executables must agree on (`packages/shared/src/platformEncryptionKeyEnv.ts` is the precedent); delivered by a secret manager in production | never in the database; never read with untyped `process.env`                                                                                             |
   | **P-op — operator-provisioned credential**     | payment gateway keys and webhook secrets; media storage keys; the email provider key; the platform AI pool keys; the analytics measurement secret; the per-network app registrations (OAuth client id and secret, X API key and secret, Meta app id and secret, TikTok client key and secret); the Turnstile secret; provider webhook signing secrets that are app-level (Meta's App Secret) | **Admin, as the single source**, stored encrypted through `PlatformCredentialService`; the cloud-identity mode with no stored secret where the cloud offers it (ADR-0028 decision 3)                                                 | the one encryption seam (decision 3), the key-encryption provider (decision 5), write-only exposure (decision 10)                                        |
   | **T — retrievable tenant credential**          | per-channel tokens and the per-channel identifiers the adapters need; Bluesky identifier and app password; Telegram bot token and chat id (see Open points); CRM tokens; the tenant OIDC client secret; Slack/Teams/Zapier/Make URLs; per-subscription webhook secrets where the platform chooses them; AI bring-your-own-key keys; **TOTP seeds**                                           | the owning tenant's row (tenant guard + RLS); admin-plane rows for admin TOTP                                                                                                                                                        | the one encryption seam                                                                                                                                  |
   | **V — verifier**                               | passwords and backup codes (low entropy); integration API keys, refresh, reset, invite, verification and share tokens (random, ≥ 112 bits)                                                                                                                                                                                                                                                   | the database                                                                                                                                                                                                                         | Argon2id through `passwordHashing.ts` (low entropy); SHA-256 lookup hash through one `tokenHash` helper (high entropy); never encrypted, never plaintext |
   | **S — short-lived state**                      | OAuth and OIDC state and PKCE verifiers; MFA challenges; revocations; counters                                                                                                                                                                                                                                                                                                               | Redis with a TTL                                                                                                                                                                                                                     | consumed once, atomically; never in process memory                                                                                                       |
   | **C — configuration that looks like a secret** | client ids, redirect URIs, key-version pointers, DSNs, bucket names, models, budgets, branding                                                                                                                                                                                                                                                                                               | env (deployment facts) or Admin (operator settings)                                                                                                                                                                                  | none                                                                                                                                                     |

   A value that does not fit one row is a design question for an ADR, not a local choice.

2. **Admin is the single source for every operator-provisioned credential, and its environment variables leave.** This
   is ADR-0025 decision 2 and ADR-0028 decisions 2 and 3 applied to the whole P-op class (D1+D2 final, #1305):
   - The `PlatformCredential` groups become the runtime source: `STRIPE`/`PADDLE` (BILL-5), `STORAGE` (STOR-3),
     `RESEND`, `AI_POOL`, an analytics group for the GA4 secret, and the `SOCIAL_*` groups redefined to hold **app
     registrations only** — the single-tenant-era `accessToken`/`accessTokenSecret` keys and the operator-level Bluesky
     `identifier`/`appPassword` leave those groups, because those are T-class values (`credentialKeys.ts:60-70`).
   - **What leaves the environment, by class** (the names are the classes' current members, listed so the removal is
     checkable): the payment gateway credentials and switch (`PAYMENT_PROVIDER`, the Stripe and Paddle secret, API and
     webhook keys); the storage credentials and switch (`STORAGE_PROVIDER`, the `S3_*` and `DO_SPACES_*` keys and
     endpoints); the email provider key and sender; the AI pool keys and default models; the analytics measurement
     secret and id; the eight `*_CLIENT_ID`/`*_CLIENT_SECRET` pairs and their `*_REDIRECT_URI` once the redirect is
     derived from the platform base URL already stored in the `PLATFORM` group. **What stays**: the P-boot class of
     decision 1, the `TRUSTED_PROXY_*` policy, ports, URLs and flags.
   - **The workers read operator credentials through the same `PlatformCredentialService`**, composed in their own
     root (ADR-0007: composition root per executable, shared core): the Prisma repository of `PlatformCredential`
     relocates to `packages/adapters/db-prisma` so both roots construct it; `PlatformCredential` is a global table, so
     no tenant context is bound for the read. No credential crosses from the API to the workers through the environment.
   - **Fail-fast moves from boot to the setup design**: a group is "configured" only when every datum its service needs
     is present; a `probe()` against the real service runs before the configuration is saved (ADR-0028 decision 6's
     shape) and feeds Admin's provider-plus-health display; secret fields are write-only (decision 10); a feature whose
     group is not configured reports itself unavailable with a named reason, never with an empty-string credential
     (SECURITY_CANON: an unconfigured secret is an absent field, never `""`).
   - **Provider webhook verification uses the app registration's secret** (Meta signs `X-Hub-Signature-256` with the
     App Secret), read from the `SOCIAL_*` group, never from a per-tenant row; per-subscription secrets remain only for
     protocols where the platform chooses the secret (WebSub `hub.secret`, Telegram `secret_token`).

3. **One encryption seam.** Every encrypted column is written and read by the shared kernel's Node-only cipher module
   (today `packages/shared/src/channelCredentialsCrypto.ts`, served from `@shared/types/channelCredentialsCrypto.js`;
   it may be renamed to `fieldEncryption.ts` once it stops being channel-specific, moving the three path exemptions —
   `shared-root-no-node-core`, the ESLint `Buffer` rule and fitness #45 — with it). `apps/api`'s `EncryptionService`
   delegates to it (DEF-29 PR 2, T-2.1) and keeps the request-scoped decrypt audit; the seed imports it (T-2.2).
   - **AAD**: `<Model>.<column>␟<stable record key>` — the two parts joined by U+001F, canonicalised by
     `canonicaliseEncryptionContext` (`channelCredentialsCrypto.ts:133-135`); the record key is the primary key when it is
     minted before the encrypt (`Channel.credentials␟<Channel.id>`), otherwise the natural unique key the row is upserted
     by (`OidcConfiguration.clientSecret␟<accountId>`).
   - **The three conventions in use today are grandfathered, not rewritten in place**: 2 families bind
     `<Model>.<column>␟<row id>`, 1 binds `<Model>.<column>␟<natural key>`, and 2 bind `<Model>␟<natural key>`
     (`PlatformCredential␟<group>:<key>`, `PlatformCredentialService.ts:85-89`; `AccountCredential␟<accountId>:<group>:<key>`,
     `:247-251`). All five are sound bindings. Renaming a live context orphans every stored row, so the two
     non-canonical contexts are normalised only by the re-encryption job of decision 9, which reads each row under its
     recorded context and writes it back under the canonical one.
   - **A registry** — one exported constant, `ENCRYPTED_COLUMNS`, mapping each encrypted column to its model, column,
     record-key rule, canonical context and, while rows still carry it, its legacy context — is the single description
     of the encrypted surface; the job, the inventory gate (decision 12) and the composition roots read it.

4. **Envelope encryption: a data key per record.** The seam moves from direct encryption under the ring key to envelope
   encryption (D3, #1303), because that is what lets the key-encryption key live outside the process without
   re-encrypting data on every rotation, and because it ends the AES-GCM random-IV budget per key (NIST SP 800-38D
   §8.3: at most 2^32 invocations per key with random IVs; one key per record cannot reach it).
   - **Each encrypt generates a fresh 32-byte data key (DEK)**, encrypts the value with AES-256-GCM under the DEK with
     the record's AAD, wraps the DEK through the key-encryption provider of decision 5, and stores the wrapped DEK
     beside the ciphertext. Decrypt unwraps the DEK (through the short-TTL cache), then decrypts the value.
   - **Column contract per family**, extending the shape all five families already share: `<col>Ciphertext`,
     `<col>Iv`, `<col>AuthTag`, `<col>KeyVersion` (kept) plus `<col>WrappedDek` (text), `<col>KeyRef` (text) and
     `<col>WrapAlgorithm` (text), with `@@index([<col>KeyRef])`. For `Channel` the prefix is `credentials`; for the two
     credential tables it is the existing unprefixed `encryptedValue`/`iv`/`authTag`/`keyVersion` quartet plus
     `wrappedDek`/`keyRef`/`wrapAlgorithm`.
   - **Two modes, told apart by one nullable column, during the migration window**: `wrappedDek IS NULL` is a
     direct-mode row (today's shape; `keyVersion` selects the ring key, the row's recorded context binds the AAD);
     `wrappedDek IS NOT NULL` is an envelope-mode row (`keyRef` names the provider and key; the canonical context binds
     the AAD). New writes are envelope-mode from the day the provider port lands; the job of decision 9 rewrites the
     direct-mode rows. Once a family counts zero direct-mode rows, its `keyVersion` column and the direct-mode read path
     are removed by their own migration, after the zero is observed, never before.
   - **The seam becomes asynchronous.** A provider unwrap is a network call for every adapter but `env`, so
     `EncryptionPort.encrypt`/`decrypt` return promises, and every caller awaits them — the five repositories,
     `PlatformCredentialService`, `ChannelCredentialsCrypto`, `PrismaChannelRepository.toDomain` (which maps rows
     synchronously today, `:157`, `:246`) and the workers' `ChannelCredentialsDecryptor`. This is a mechanical change
     with a wide surface; it is its own unit so that the provider port lands on an already-async seam.
   - **Where it lives**: the pure primitives (cipher, AAD, key decoding) stay in the kernel module, the only file that
     may call `createCipheriv`/`createDecipheriv` (fitness #45); the envelope orchestration — provider, DEK cache,
     registry, dual-mode read — is `FieldEncryptionService` in a new infrastructure package `@adapters/field-encryption`,
     implementing the async `EncryptionPort`; `apps/api`'s `EncryptionService` becomes the audit-emitting wrapper around
     it (it keeps `DecryptAuditPort` and the request ALS, which the kernel and the package may not import).

5. **A provider-neutral key-encryption port, one switch, five adapters, one contract suite.**
   - **Port** (`packages/ports/src/KeyEncryptionProvider.ts`, `@layer domain` like every port; the kernel keeps a
     structurally identical interface because it imports no port):

     ```ts
     export const KEY_PROVIDER_IDS = {
       ENV: "env",
       VAULT: "vault",
       AWS_KMS: "aws-kms",
       GCP_KMS: "gcp-kms",
       AZURE_KEYVAULT: "azure-keyvault",
     } as const;
     export type KeyProviderId = (typeof KEY_PROVIDER_IDS)[keyof typeof KEY_PROVIDER_IDS];

     /** A data key as stored beside the ciphertext; everything here is non-secret. */
     export interface WrappedDataKey {
       /** `<provider>:<key identity>`, e.g. `env:2`, `vault:transit/omnipost-kek:3`, `aws-kms:<key ARN>`,
        *  `gcp-kms:<cryptoKeyVersion resource name>`, `azure-keyvault:<key identifier URL, versioned>`. */
       readonly keyRef: string;
       /** The wrap algorithm the adapter used, e.g. `AES-256-GCM`, `AWS-KMS-SYMMETRIC_DEFAULT`, `RSA-OAEP-256`. */
       readonly wrapAlgorithm: string;
       /** The wrapped key material in the provider's own text form (base64, or Vault's `vault:v3:…`). */
       readonly wrapped: string;
     }

     export interface GeneratedDataKey {
       /** 32 bytes; the caller zeroes it after use. */
       readonly plaintext: Uint8Array;
       readonly wrapped: WrappedDataKey;
     }

     export type KeyProviderProbeError =
       "UNAUTHORIZED" | "NOT_FOUND" | "MISCONFIGURED" | "TIMEOUT" | "SERVICE_ERROR";

     export interface KeyEncryptionProvider {
       readonly id: KeyProviderId;
       generateDataKey(): Promise<GeneratedDataKey>;
       /** Refuses a `keyRef` it does not own; never retries against another key. */
       unwrapDataKey(wrapped: WrappedDataKey): Promise<Uint8Array>;
       /** The `keyRef` new data keys are wrapped under: the re-encryption selector and the health display read it. */
       activeKeyRef(): Promise<string>;
       probe(options: {
         timeoutMs: number;
       }): Promise<Result<{ latencyMs: number; keyRef: string }, KeyProviderProbeError>>;
     }
     ```

     The wrap is context-free by design: the record binding lives in the data layer's AAD (a DEK moved to another row
     cannot decrypt that row's ciphertext), which keeps the five adapters behaviourally identical — Azure's `wrapKey`
     has no AAD, and AWS writes an encryption context into CloudTrail (D3's reasoning).

   - **The DEK cache** is in-process, bounded (LRU) and short-lived (TTL ≤ 300 s), keyed by a hash of
     `keyRef ␟ wrapped`, holding plaintext keys in an opaque holder whose `toJSON()` is redacted (DEF-29 T-2.6's shape).
     It lives in `@adapters/field-encryption`, not in `apps/api/src`, and it is the one cache that MUST NOT be cross-pod:
     plaintext key material never enters Redis. This is a stated exception to LOGGING_CANON §Caching's cross-pod rule,
     with its reason, not a per-class `Map` of the kind fitness #14 forbids.
   - **The switch**: `KEY_PROVIDER` (enum of the ids above, default `env`), declared in a shared Zod fragment both env
     modules spread, with a boot-time interlock in each final schema (the `TRUSTED_PROXY_MODE`/`TRUSTED_PROXY_RANGES`
     precedent of ADR-0021): `env` requires the `PLATFORM_ENCRYPTION_KEY*` ring; `vault` requires the server address,
     the authentication material and the transit mount and key name; `aws-kms` the key id (credentials through the
     default chain); `gcp-kms` the key resource name (Application Default Credentials); `azure-keyvault` the versioned
     key identifier (`DefaultAzureCredential`). An inconsistent pair refuses to boot. These references are P-boot
     values and stay in env. The exact variable names are fixed by the implementing units under the env canon.
   - **Adapters**, each its own package beside the storage adapters (`packages/adapters/key-provider-env`,
     `key-provider-vault`, `key-provider-aws-kms`, `key-provider-gcp-kms`, `key-provider-azure-keyvault`), constructed
     only in a composition root: `env` wraps the DEK with AES-256-GCM under the ring's active key through the kernel's
     own primitive (no second cipher call) and names `env:<version>`; `vault` uses the transit engine's
     `datakey/plaintext/:name`, `decrypt/:name`, `rewrap/:name` and `keys/:name/rotate` endpoints over plain `fetch`
     (no SDK), honouring the `vault:vN:` prefix and `min_decryption_version`; `aws-kms` uses `GenerateDataKey` and
     `Decrypt`; `gcp-kms` generates the key locally and uses `encrypt`/`decrypt` on a key version; `azure-keyvault`
     generates locally and uses `wrapKey`/`unwrapKey` with RSA-OAEP-256 (AES key wrap exists only on Managed HSM).
   - **Certification label rule**: `env` and `vault` are proven by the real contract suite in the battery and CI;
     each cloud adapter carries, in its `@file` header and in its tracker row, the words
     `UNCERTIFIED against the live service` with the remove-when "first live contract run green", and nothing in the
     repository claims otherwise before that run.
   - **Contract suite tiers**, one parameterised suite for every adapter (round trip; wrong `keyRef` refused; tampered
     wrapped blob refused; unwrap of a key wrapped under the previous version still works after a rotation;
     `activeKeyRef()` changes after a rotation; `probe()` reports latency and `keyRef`, and `TIMEOUT` when the service
     does not answer): **real** against `env` (vitest, every run) and against `vault` (a node:test batch named in
     `apps/api/scripts/run-tests.sh` under `TIER=pr-integration`, against a Vault container in dev mode with transit
     enabled — in `docker-compose.yml` beside MinIO for local runs and as a `services:` entry of the CI integration job;
     a missing server FAILS the batch, it never skips it); **mocked SDK** for the three cloud adapters (vitest, every
     run, the client mocked to the documented request and response shapes); and **a live batch** for the cloud adapters
     under its own `TIER=live-kms`, declared in `docs/development/TESTING_REFOUNDATION.md` as unrun until credentials
     exist, which FAILS when `TIER=live-kms` is set and no credentials are present — never a silent skip (fitness #30
     reachability by its `run_batch` line; fitness #32: no `.skip`).

6. **Verifiers are hashed; shared keys are encrypted.**
   - **TOTP seeds are not verifiers.** `AdminUser.mfaSecret` and `CustomerUser.mfaSecret` are shared keys the server
     must present to its TOTP library on every check; they move onto the encryption seam (encrypt in place, then drop
     the plaintext column), with the AAD `AdminUser.mfaSecret␟<id>` / `CustomerUser.mfaSecret␟<id>`.
   - **Random bearer tokens are hashed**, never stored: `AdminUser.passwordResetToken`, `CustomerUser.resetToken` and
     `CustomerUser.inviteToken` become `@unique` SHA-256 hash columns looked up by hash, through one `tokenHash()`
     helper that `AdminSession.refreshTokenHash` (`auth/refreshTokenHash.ts`) and the Redis blacklist already
     approximate; the plaintext travels only in the email or link. `CustomReport.shareToken` and
     `DsarRequest.verificationToken` are hashed when a reader is built. The `"CHANGE_REQUIRED"` sentinel that
     `admin/AccountSessionService.ts:79` writes into `passwordResetToken` moves to its own flag first (SMELL-110).
   - **Fitness #41's consumption markers name these columns** (`passwordResetToken: null`, `resetToken: null`); the
     unit that renames a column renames its marker, re-measures `SITE_FLOOR` and proves the red path in the same change.
   - Low-entropy values stay on Argon2id through `passwordHashing.ts`; the seed's two parameter copies
     (`infra/prisma/seed.ts:779`, `:1082`) import the helper or fitness #18 widens to `infra/prisma`.

7. **Short-lived state lives in Redis and is consumed once.** The OIDC PKCE verifier and state move from the
   per-process `Map` (`oidcRoutes.ts:63-70`) to the `OAuthFlowStore` pattern (`api:oidc:flow:<state>`, TTL 600 s).
   Consume becomes atomic for both stores: `CachePort` gains a `take(key)` operation (Redis `GETDEL`; the in-memory
   adapter mirrors it), closing the read-then-delete window `OAuthFlowStore.ts:32-38` documents.

8. **Redaction is one list, applied by every logger.** `REDACT_PATHS` moves to `@observability/logger` as an exported
   constant consumed by `apps/api/src/lib/logger.ts` and by the packages' base logger (which gains `redact`), amending
   ADR-0013's "no redaction in packages" row of LOGGING_CANON. The list gains `appPassword`, `clientSecret`,
   `appSecret`, `botToken`, `secretKey`, `webhookSecret`, `mfaSecret`, `backupCodes`, `codeVerifier`, `webhookUrl`,
   `targetUrl`, `privateKey`, `accessTokenSecret` and the nested forms `*.accessToken`, `*.refreshToken`,
   `*.credentials`, `*.*.token`, `*.*.secret`. Credential objects, rings and data keys are never logged; opaque holders
   with a redacting `toJSON()` are the mechanism (DEF-29 T-2.6).

9. **Rotation exists before it is needed.**
   - **The re-encryption job** is a use case in `packages/core/security` (`RotateEncryptedColumnsUseCase`) over an
     `EncryptedColumnRepository` port implemented in `packages/adapters/db-prisma`, run as a command from the API's
     composition root under `withSystemContext` (it crosses tenants; the canon-sanctioned path). It walks every family
     of the registry in batches, selecting rows whose `wrappedDek IS NULL` or whose `keyRef` is not the provider's
     active one, reads each under its recorded mode and context, writes it back envelope-mode under the active key with
     the canonical context, idempotently and resumably, and reports counts per family. It is required before the first
     rotation of any provider; `EncryptionService.ts:241` names it instead of a script that does not exist.
   - **One rotation log**: `SecretRotationLog`, written by the job (and by the signing-key procedure); the
     `PlatformEncryptionKey` table, its Admin "rotate" endpoint (`settings/settingsRoutes.ts:156-175`) and
     `SettingsService.logEncryptionKeyRotation` are deleted — the endpoint recorded a rotation that never happened.
   - **Cadence** (SECRETS.md and `secretCatalog.ts` are the policy): the key-encryption key yearly; signing keys every
     90 days; verifiers on use; tenant OAuth tokens on refresh. The `env` ring keeps its `_V<N>` shape until a rotation
     needs more than three prior slots, at which point it takes the slot-free JSON form of
     `DELETION_NAME_DIGEST_KEY_RING`.
   - **The JWT/cookie dual-key window is implemented, not promised**: each signing key gains an optional
     `*_SECRET_PREVIOUS`; new tokens carry a `kid`; verification tries the active key, then the previous one, within
     the runbook's window; `@fastify/cookie` receives `secret: [active, previous]` — the first signs, all verify, per
     its README ("Rotating signing secret"). Until the unit lands, the runbook states that a rotation is a global logout.

10. **Secrets are write-only through every API.** A secret is shown once, at creation (API keys, backup codes, the TOTP
    provisioning secret), and masked afterwards (last four characters; fully masked at eight or fewer). Admin shows
    presence and health, never a value; no route returns a tenant credential; any future "reveal" needs
    re-authentication plus an audit entry and its own ADR. `ListExternalNotificationsQuery.ts:49`, which returns the
    decrypted Slack/Teams URL, is the one measured violation and is fixed.

11. **Tenant-facing credential surfaces** (D4, #1306): per-account AI keys stay (`AccountCredential`, on the seam);
    the Zapier/Make `IntegrationApiKey` slice stays (Argon2id-hashed, live); CRM connections stay and their tokens
    move onto the seam with a write-only API; the customer `ApiKey` slice is deleted (it authenticates no route and
    schedules a rotation nothing runs); PREG-1 — which credential authenticates a public API — was decided later the same
    day without a dead design to drag: scoped keys now on the `IntegrationApiKey` pattern and OAuth 2.1 for third-party
    apps when a consumer exists (Master Plan rows PUBAPI-1 and PUBAPI-2).

12. **Three gates hold the model** (numbers assigned at landing; fitness #44 keeps the inventory contiguous):
    - **The cipher gate** (reserved as #45 by DEF-29 T-3): `createCipheriv(`/`createDecipheriv(` appear only in the
      kernel's cipher module, hard-zero elsewhere, with a floor on the module's own calls so a rename fails closed;
      named exceptions only for files already scheduled for deletion (`credentialManager.ts`, DC-4; the dead
      `video/uploadPipeline.ts` cipher), each with its remove-when.
    - **The inventory gate**: every `schema.prisma` column whose name matches the secret pattern
      (`secret|token|password|credential|apiKey|hash|digest|cipher|mfa|webhookUrl|targetUrl|privateKey|appPassword|encryptedValue`)
      must appear in the `SECRET_COLUMNS` registry (the `ENCRYPTED_COLUMNS` constant of decision 3, widened) with a class —
      `encrypted`, `hashed`, `plaintext-by-decision` (with a remove-when), `identifier` (non-secret) or `dead` — and
      every registry entry must still exist in the schema; zero extracted columns, an unclassified column or a stale
      entry fail closed (the #38/#39 shape). A new secret-bearing column cannot land unclassified.
    - **The env allowlist gate** (the #28/#40 allowlist form): a secret-pattern key
      (`SECRET|KEY|PASSWORD|TOKEN|CREDENTIAL`) may appear in `apps/api/src/config/env.ts` or `apps/workers/src/config/env.ts`
      only if it is a P-boot name of decision 1 or a member of a **named, shrink-only exception list** in which each
      operator-credential name still in env is tagged with the row that removes it (BILL-5, STOR-3, the env→Admin
      units). The list lands with the gate so the drift is visible from day one; a name that leaves env leaves the list
      in the same change, and a stale entry fails.

13. **Dead secrets leave.** `OAUTH_ENCRYPTION_KEY` (required at boot for a table dropped on 2026-05-07), `JWT_SECRET`,
    `ADMIN_EMAIL` and `BCRYPT_ROUNDS` leave the schema, `.env.example`, `.env.test.example`, `secretCatalog.ts`,
    SECRETS.md and the runbook; `SHADOW_DATABASE_URL` becomes optional for the API (only `prisma.config.ts` uses it).

## Rationale

1. **One criterion instead of four.** ADR-0025 and ADR-0028 had already chosen Admin as the single source for two
   operator credentials; a third rule for app registrations and a fourth for email and AI would have re-created the
   two-sources defect those ADRs closed (F14, F15). The drift measured in the inventory — Admin written, env read — is
   closed in the direction already decided.
2. **Keys apart from data, without betting on one cloud.** OWASP Cryptographic Storage puts the key-encryption key in
   a separate location from the data, and OWASP Key Management retires a KEK by re-wrapping the DEKs under its
   replacement. Envelope encryption behind a port gives the project that shape today with the env ring and tomorrow
   with Vault or a cloud KMS, without touching a caller; two real adapters (`env`, `vault`) prove the port is neutral
   rather than a wrapper around one SDK (Edward's reasoning in D3: leave the infrastructure as close as possible to the
   future implementation, and say plainly what is uncertified).
3. **The AAD binding is kept and made uniform, not reinvented.** It is the project's existing control against
   ciphertext substitution (ADR-0022 relies on it), the same idea as a KMS encryption context, and it stays in our layer
   so every provider behaves alike.
4. **Hashing is the only honest storage for a verifier.** A reset token stored in plaintext and compared by equality
   is a password stored in plaintext (OWASP Forgot Password; NIST SP 800-63B-4 §3.1.2.2); a TOTP seed is a shared key
   and must be encrypted, not hashed (§3.1.4.2). The split is by what the server must do with the value, not by table.
5. **Rotation that exists only in a runbook is not rotation.** The job, the single log and the dual-key window are
   the "code and processes in place before they are required" (OWASP Cryptographic Storage); two logs and a nonexistent
   script were the opposite.
6. **A gate per class, fail-closed.** The repository's experience is that a dead scope passes forever (fitness #2/#3/#4,
   #36): the inventory gate derives its population from the schema, the env gate is an allowlist, and the cipher gate
   has a floor, so each fails when its subject moves instead of reporting a clean zero over nothing.

## Alternatives Considered

- **Environment only for every platform secret, Admin keeps non-secret settings** (the inventory's first
  recommendation and the provisional D1/D2 of 2026-10-06 00:10–00:30Z). Rejected by ADR-0025 decision 2 and ADR-0028
  decisions 2–3, accepted on 2026-10-04: keeping the gateway and storage variables beside the Admin configuration is
  exactly F14/F15; superseding both ADRs for a rule that adds nothing the operator needs was not chosen (#1304, #1305).
- **The database as the only runtime source without a cloud-identity mode.** Rejected: ADR-0028 decision 3 keeps the
  mode with no stored secret where the cloud offers it ("no stored secret is the safest secret"); forcing a key into
  the database where an instance role exists would weaken the storage decision to fit the credential one.
- **Adopt a KMS now, as the only provider.** Rejected: the deployment target is not settled, a cloud adapter cannot be
  certified without the live service, and a single-provider port is not a port. The env ring stays the key-encryption
  key today, behind the port, with the cloud adapters written now and labelled.
- **One cipher per family (the pre-#429 state: three copies, two of them wrong).** Rejected: three copies of one cipher
  diverged within one commit (`1a48bbf3`) and nothing stopped a fourth.
- **Keep the seam synchronous and let only the `env` adapter exist for now.** Rejected: a synchronous port cannot be
  implemented by any network-backed provider, so the port would be neutral in name only; the async change is mechanical
  and is done once, before the provider lands.
- **A shared env fragment for the app registrations across API and workers** (the provisional D1). Rejected with D1:
  it keeps a platform secret in two processes' environments and the unread Admin copy alive; the service the workers
  already reach for the database gives them the registrations without an env fragment.
- **Hash the TOTP seeds like the backup codes.** Rejected: a TOTP check needs the seed, so a hash makes the second
  factor unusable; the seed is a shared key and is encrypted.

## Consequences

**Positive**

- One rule decides where a secret lives; the inventory gate makes a new column declare its class.
- Operator credentials have one source, write-only fields and a health signal; the Admin screens that today store
  values nothing reads become real.
- Rotation of the key-encryption key is a job with a log; moving to Vault or a cloud KMS is a `KEY_PROVIDER` change
  plus one run of that job, not a redesign.
- Every logger redacts the same names; the workers stop being the unredacted process.

**Negative / costs**

- **The seam becomes asynchronous**, touching every `EncryptionPort` caller and `PrismaChannelRepository.toDomain`;
  mechanical, but wide.
- **Live rows are migrated** twice over time: encrypted families into envelope mode (and two of them onto the canonical
  AAD), and the plaintext columns onto the seam or onto hashes. Each is a dual-read window with a measured zero before a
  column is dropped.
- **Five families gain three columns each** and an index; the two credential tables gain the same.
- **The workers' composition root grows** (the credential repository, the field-encryption service, the key provider).
- **The Admin UI handles secrets** for more groups: write-only fields, presence, health, probe; the UI work rides with
  each env→Admin unit.
- **Docs change with every unit**: SECURITY_CANON §Secrets and Environment (the P-boot/P-op split), SECRETS.md (the
  drift the inventory lists in its §11), LOGGING_CANON (the redaction row), `docs/architecture/secrets-and-env.md`,
  the rotation runbook, `.env.example` and `.env.test.example` (sensitive paths, a token per change).
- **Vault adds a container** to `docker-compose.yml` and to the CI integration job; its image is pinned under ADR-0018
  (Vault is BSL-licensed; OpenBao, MPL-2.0 and transit-compatible, is the fallback image if the licence ever matters —
  the Vault unit confirms the compatibility before relying on it).

## Legal impact

This ADR changes no processing purpose, legal basis, retention or subprocessor; it changes the **description of the
security measures** and the **breach position**, which the legal register of §5.10 (LEGAL-1, anchored in GDPR art. 30)
records when it exists, and which this section states ahead of LEGAL-2's template change:

- **Art. 32(1)(a)–(b) and art. 28(3)(c)**: OmniPost processes personal data as a processor for its customers and holds
  credentials that identify natural persons' accounts on third-party networks (OAuth tokens, handles, app passwords),
  plus authentication data of its own users (TOTP seeds, reset and invite tokens). Encryption at rest with per-record
  data keys, AAD binding and hashed verifiers are the "appropriate technical measures" the processor must implement and
  document; the plaintext TOTP seeds, CRM tokens and reset tokens the inventory found are the current gap against that
  article, and decisions 6 and 11 are its remediation.
- **Art. 33(1) and art. 34(3)(a)**: notification of a breach to data subjects is not required where the data were
  rendered unintelligible, encryption being the named example. The envelope seam, with keys held outside the data
  store, is the control the register cites for that position; a `plaintext-by-decision` entry in the inventory gate's
  registry is, by construction, a column that position does not cover.
- **Art. 30(1)(g)**: the record of processing activities carries "a general description of the technical and
  organisational security measures"; the register's security-measures row references this ADR, the key provider in use
  (the cloud KMS of AWS, Google or Microsoft is a subprocessor already listed when that cloud hosts the storage of
  ADR-0028; a self-hosted Vault adds none) and the rotation cadence of SECRETS.md.
- **No legal fact changes** for the customer-facing terms: the credentials a customer grants are stored for the same
  purposes, under the same bases, and are deleted with the channel or account as before.

## Open points

- **Telegram's bot token class.** The adapter expects a per-channel `botToken` + `chatId` (T-class) while an Admin
  `SOCIAL_TELEGRAM.botToken` group exists (P-op), the single-platform-bot model a comparable product runs. Which model
  the product wants is a §2F slice 1 decision for Edward; the taxonomy admits either, not both.
- **CRM app registrations.** Today the client posts the HubSpot/Salesforce tokens (`crmRoutes.ts:35-36`) and no server-side
  code exchange exists. When one is built, the client secrets follow decision 2 (Admin, `CRM_*` groups); whether the
  platform's app or the customer's own app connects the CRM is a product decision not taken here.
- **The analytics measurement secret** is placed in Admin by the rule of decision 2 (an operator-provisioned external
  service); it was not named in D1+D2 and is confirmed with Edward in the unit that moves it.

## Revisit if

- A KMS or Vault is adopted in production: the `env` adapter is retired from the default, the ring becomes the fallback
  for local development only, and the "UNCERTIFIED" labels of the chosen cloud adapter fall with its first live run.
- A public API credential is decided (PREG-1): a static key is rebuilt on the `IntegrationApiKey` pattern (hashed,
  enforced permissions, real rotation) or OAuth 2.1 is chosen; either way it enters the taxonomy as V-class.
- A second deployable needs credentials (a CLI, an edge function): it gets its own composition root over the same
  service and provider (ADR-0007), never an env fragment of operator credentials.
- A provider offers workload identity or AES key wrap it lacks today (Azure standard tier): the adapter's algorithm
  changes under the same port.
- The application layer needs decrypt audit in the workers: the audit wrapper of `apps/api` moves to the package.

## Risks and Mitigations

| Risk                                                                  | Mitigation                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The migration of live rows corrupts or orphans a row                  | Dual-mode read until the family counts zero direct-mode rows; the job is idempotent and resumable, reads each row under its recorded context, and is proven against each family's real shape before any column is dropped                      |
| A dual-read window becomes permanent                                  | Each family's zero is an observed count recorded in the unit that drops its legacy column; the registry's legacy entries may only shrink, and the inventory gate fails on a stale entry                                                        |
| The Admin UI exposes a secret it should not                           | Write-only fields and masked reads are the API's contract (decision 10), pinned by route tests; the one measured violation (B-3) is fixed in the same programme                                                                                |
| The asynchronous seam leaves a caller un-awaited                      | The port's return type is a promise, so the compiler names every caller; the no-floating-promises lint rule covers the rest                                                                                                                    |
| A cloud adapter is believed certified                                 | The label rule of decision 5 is in the file header and the tracker row, with a remove-when; the live batch fails loudly without credentials instead of skipping                                                                                |
| The DEK cache leaks key material                                      | In-process only, bounded, short TTL, opaque holders with redacting `toJSON()`, never serialised, never in Redis; a unit test pins that `JSON.stringify` of a holder contains no key bytes                                                      |
| An operator rotates a key in one process and not the other            | The provider configuration is one shared env fragment with a boot interlock; the rotation runbook names both executables; a decrypt with an unknown `keyRef` is `CREDENTIALS_UNREADABLE` (DEF-29 T-2.5), an operator alert, not a user re-auth |
| Renaming a verifier column silently defeats fitness #41               | The unit renames the marker, re-measures `SITE_FLOOR` and proves the red path in the same change (the gate's own "How to extend")                                                                                                              |
| The env allowlist gate is bypassed by moving a secret to another file | Fitness #16/#19 keep `process.env` reads out of everything but the env modules; the allowlist scans both modules                                                                                                                               |

## References

- Twelve-Factor App, III Config — https://12factor.net/config
- OWASP Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP Cryptographic Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- OWASP Key Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html
- OWASP Password Storage Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- OWASP Forgot Password Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- NIST SP 800-57 Part 1 Rev. 5 (§5.2, §5.3.6) — https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf
- NIST SP 800-38D (§8, §8.3) — https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf
- NIST SP 800-63B-4 (§3.1.2.2, §3.1.4.2) — https://pages.nist.gov/800-63-4/sp800-63b.html
- AWS KMS cryptography essentials, envelope encryption — https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html
- AWS KMS encryption context — https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html
- Google Cloud KMS envelope encryption — https://docs.cloud.google.com/kms/docs/envelope-encryption
- HashiCorp Vault transit secrets engine — https://developer.hashicorp.com/vault/docs/secrets/transit ; API
  (`datakey/plaintext/:name`, `encrypt`, `decrypt`, `rewrap`, `keys/:name/rotate`, `min_decryption_version`, the
  `vault:vN:` prefix) — https://developer.hashicorp.com/vault/api-docs/secret/transit
- Tink, "Manage Keys" (key URIs `aws-kms://`, `gcp-kms://`, `hcvault://`; a KMS-held KEK wrapping keysets) —
  https://developers.google.com/tink/key-management-overview
- RFC 6819, OAuth 2.0 Threat Model (§5.1.4.1.3, store token hashes) — https://datatracker.ietf.org/doc/html/rfc6819
- W3C, Good Practices for Capability URLs — https://www.w3.org/TR/capability-urls/
- Meta Graph API Webhooks, validating payloads — https://developers.facebook.com/docs/graph-api/webhooks/getting-started
- `@fastify/cookie` README, "Rotating signing secret" (array of secrets; the first signs, all verify) — installed
  package, `apps/api/node_modules/@fastify/cookie/README.md`
- GDPR art. 28(3)(c), 30(1)(g), 32, 33, 34(3)(a) — https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Inventory and decisions: `research-2026-10-05/credential-inventory.md` (engram #1300); engram #1294, #1295 (runtime
  verification); #1301–#1306 (D1–D4 and the correction); the DEF-29 plan and task list
- Canon: `docs/security/SECURITY_CANON.md` §Secrets and Environment; `docs/security/SECRETS.md`;
  `docs/architecture/secrets-and-env.md`; `docs/observability/LOGGING_CANON.md` §Logging, §Caching;
  `docs/security/MULTI_TENANT_GUARDS.md` (`withSystemContext`, the global-table denylist); `CLAUDE.md` fitness #14,
  #15, #16, #18, #19, #28, #30, #32, #38, #39, #40, #41, #44
- Code: `packages/shared/src/channelCredentialsCrypto.ts`; `apps/api/src/security/EncryptionService.ts`;
  `apps/api/src/security/ChannelCredentialsCrypto.ts`; `packages/core/security/src/PlatformCredentialService.ts`;
  `packages/core/domain/src/repositories/EncryptionPort.ts`; `packages/core/settings/src/credentialKeys.ts`;
  `apps/api/src/auth/providerOAuthConfigs.ts`; `apps/api/src/config/env.ts`; `apps/workers/src/config/env.ts`;
  `packages/shared/src/platformEncryptionKeyEnv.ts`; `apps/api/src/infrastructure/storage/createStorageAdapter.ts`;
  `apps/api/src/infrastructure/repositories/PrismaChannelRepository.ts`; `packages/core/domain/src/entities/Channel.ts`;
  `apps/workers/src/services/CredentialResolver.ts`; `apps/api/src/lib/logger.ts`;
  `packages/observability/logger/src/index.ts`; `apps/api/src/auth/oidcRoutes.ts`; `infra/prisma/schema.prisma`
