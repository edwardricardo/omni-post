# Secrets · KMS Migration

This document describes the migration from the current direct-master-key
encryption model (master key in `process.env.PLATFORM_ENCRYPTION_KEY`) to a
**KMS-backed envelope-encryption** model where the master key (KEK) lives
in a Key Management Service and never leaves it. It covers four KMS options
with their trade-offs, the canonical re-wrap procedure for KEK rotation,
the performance and cost implications, and the rollback procedure.

The decision matrix is intentionally neutral — it lists the four KMS
options against six dimensions but does not pre-select a primary. The
choice will be made in a follow-up working session and captured in the
final canonical reference.

---

## 1. Scope

**Covers**

- Migration of the platform master key from `process.env.PLATFORM_ENCRYPTION_KEY`
  to a KMS-backed KEK
- Envelope-encryption model (KEK + per-record DEKs)
- Re-wrap procedure for KEK rotation
- Performance and cost considerations
- Rollback procedure

**Does not cover**

- Deployment-time secret delivery → [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)
- Per-secret rotation cadence and procedure → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- BYOK / per-tenant DEK derivation → SECRETS_BYOK_FEASIBILITY.md (Batch 15)
- Encryption-at-rest taxonomy and `keyVersion` columns → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- Implementation code (refactor of `EncryptionService.ts`, KMS account setup) — that lives in operational documents once a KMS option is chosen

**Audience**

Engineers and security reviewers who need to understand the architecture of
the proposed KMS migration: what changes in the data model, what changes in
the encryption flow, how rotation works, and what the operational footprint
looks like.

---

## 2. Current state

[apps/api/src/security/EncryptionService.ts](../../apps/api/src/security/EncryptionService.ts)
performs AES-256-GCM encryption and decryption directly with a single
master key resolved from `process.env.PLATFORM_ENCRYPTION_KEY` (and prior
versions from `PLATFORM_ENCRYPTION_KEY_V{N}` during rotation windows). Two
properties are already in place from earlier batches:

- **`keyVersion` graceful rotation** (Batch 06): every persisted ciphertext
  carries the version of the key that produced it; reads dispatch to the
  matching key in the prior-key map; bumping the active version + adding a
  new key opens a graceful window for re-wrap.
- **AAD-bound `EncryptionContext`** (Batch 08): every encrypt/decrypt call
  carries a structured `{ fieldName, recordId }` context that is bound as
  AES-GCM Additional Authenticated Data and logged in the audit trail.
  This is the canonical KMS pattern (see the AWS KMS EncryptionContext
  entry in the canon index).

The remaining gap is **the master key itself sits as plaintext on the
runtime host**. There is no HSM-backed protection, no audit-on-use of the
key, and rotation requires touching the environment variable on every host
that runs the application. The current model is therefore not a true
envelope-encryption architecture — it is direct encryption with a master
key, even though the AAD discipline matches what an envelope model would
do.

---

## 3. Envelope-encryption canon

The industry-standard pattern for application-layer encryption with a KMS
is two-tier: the KMS holds a Key Encryption Key (KEK) that never leaves
the service; the application generates a fresh Data Encryption Key (DEK)
per record (or per logical group of records); the data is encrypted with
the DEK; the DEK itself is encrypted with the KEK ("wrapped"); the
application persists the ciphertext alongside the wrapped DEK and the AAD
context.

```text
       ┌───────────────────────────────────────────────────────┐
       │                       KMS                             │
       │   ┌────────────────────────────────────────────────┐  │
       │   │  KEK (Key Encryption Key) — never leaves       │  │
       │   └────────────────────────────────────────────────┘  │
       │                       ▲                               │
       └───────────────────────┼───────────────────────────────┘
                               │
                       wrap / unwrap DEK
                               │
       ┌───────────────────────┼───────────────────────────────┐
       │              Application                              │
       │                                                       │
       │   plaintext ──► AES-GCM(DEK, plaintext) ──► ciphertext│
       │                                                       │
       │   DEK ──► KMS.encrypt(KEK, DEK) ──► wrapped DEK       │
       │                                                       │
       │   persist: { ciphertext, wrapped DEK, AAD context }   │
       └───────────────────────────────────────────────────────┘
```

The decryption path mirrors the encryption path: the application reads
the wrapped DEK and the AAD context from the database, asks the KMS to
unwrap the DEK (passing the AAD context), receives the plaintext DEK in
memory, decrypts the ciphertext with it, and discards the plaintext DEK.

Why this matters:

- **The KEK never leaves the KMS.** A compromise of the application host
  exposes the in-memory DEK for the records it touched, but not the master
  key for everything.
- **KEK rotation does not re-encrypt data.** Rotating the KEK means
  generating a new KEK version inside the KMS and re-wrapping the existing
  DEKs (one cheap KMS operation per record). The much larger ciphertext is
  untouched. This is the canonical reason envelope encryption scales.
- **Audit-on-use is native.** Every wrap/unwrap is a KMS API call, logged
  by the KMS provider with the calling principal, the AAD context, and a
  timestamp.

The trade-off is latency: every encrypt or decrypt now involves a KMS
round-trip. Cloud KMS calls are typically 10–50 ms; self-hosted Vault
Transit calls in the same region are 1–5 ms. Mitigation strategies are
discussed in §7.

---

## 4. The four KMS options

Each option includes a one-paragraph description, a canonical link, and
explicit when-to-use / when-NOT-to-use guidance. The four are not mutually
exclusive — Vault Transit can sit on top of cloud KMS for the underlying
HSM, for example.

### 4.1 AWS KMS

[AWS KMS](https://aws.amazon.com/kms/) is the managed key-management
service for AWS workloads. Symmetric and asymmetric customer-managed keys
(CMKs); FIPS 140-2 Level 2 by default, Level 3 with CloudHSM backing.
Automatic key rotation is opt-in for customer-managed keys; when enabled,
KMS generates new key material annually but **leaves existing data
untouched** — old key versions remain active for decryption, and data
re-encryption is the user's responsibility (see §6 for the canonical
re-wrap procedure).

- **When to use:** the deployment is AWS-native; CloudTrail integration
  for KMS audit is acceptable; FIPS Level 2 is sufficient (Level 3 via
  CloudHSM if required).
- **When NOT to use:** multi-cloud topology where AWS lock-in is a
  liability; data-sovereignty requirements that forbid key material
  custodianship by a US-headquartered provider.
- **Canon:** <https://aws.amazon.com/kms/>
  · Rotation behaviour: <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>

### 4.2 GCP Cloud KMS

[GCP Cloud KMS](https://cloud.google.com/security-key-management) is the
GCP equivalent. Key rings group related keys; each key has multiple
versions; encryption uses the primary version while decryption supports
all enabled versions. Software-protected keys are the default; HSM-backed
keys (Cloud HSM) are an upgrade. Rotation schedules are configurable
per-key (e.g. every 90 days).

- **When to use:** the deployment is GCP-native; multi-version key model
  with explicit primary/decrypt-set semantics is desirable.
- **When NOT to use:** multi-cloud or sovereignty constraints similar to
  AWS KMS.
- **Canon:** <https://cloud.google.com/kms/docs>

### 4.3 Azure Key Vault

[Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/overview)
combines key management with secret storage in a single service —
distinct from the AWS / GCP separation between KMS (keys) and Secrets
Manager (values). The Premium tier is HSM-backed (FIPS 140-2 Level 3).
Integration with Azure AD identities is deeper than the AWS / GCP
equivalents.

- **When to use:** the deployment is Azure-native; consolidated key +
  secret store is desirable; Azure AD identities are already the auth
  primitive.
- **When NOT to use:** non-Azure deployment (the API surface is
  Azure-specific); separation of key custody from secret custody is a
  hard requirement.
- **Canon:** <https://learn.microsoft.com/en-us/azure/key-vault/general/overview>

### 4.4 HashiCorp Vault Transit

[HashiCorp Vault](https://www.vaultproject.io/) is the self-hosted,
multi-cloud option. The **Transit secrets engine** is encryption-as-a-
service: the application sends plaintext, Vault returns ciphertext
(prefixed with the key version, e.g. `vault:v1:...`), and the keys never
leave Vault. The differentiator is the **`rewrap` API**: a process can
request that Vault re-encrypt an existing ciphertext with the newest key
version _without ever returning plaintext to the caller_. Even an
untrusted process can perform re-wrap because the operation is
plaintext-blind; the only privilege required is the rewrap policy.

Vault relicensed to BSL in August 2023; for internal use the license is
unchanged in practice.

- **When to use:** multi-cloud or hybrid topology; rewrap-without-
  plaintext-exposure is a security requirement; dynamic secrets (DB
  credentials with TTL) are also wanted from the same system.
- **When NOT to use:** the team lacks the operational capacity to run a
  Vault HA cluster; single-cloud deployment where the cloud-native KMS
  covers the same ground at lower cost and zero ops.
- **Canon:** <https://developer.hashicorp.com/vault/docs/secrets/transit>
  · Rewrap procedure: <https://developer.hashicorp.com/vault/tutorials/encryption-as-a-service/eaas-transit-rewrap>

---

## 5. Decision matrix

The matrix compares the four options across six dimensions. No primary
option is selected here.

| Dimension                          | AWS KMS                             | GCP Cloud KMS                                  | Azure Key Vault          | Vault Transit          |
| ---------------------------------- | ----------------------------------- | ---------------------------------------------- | ------------------------ | ---------------------- |
| Single-cloud lock-in               | Yes (AWS)                           | Yes (GCP)                                      | Yes (Azure)              | No (multi-cloud)       |
| HSM-backed FIPS 140-2 L3           | Optional via CloudHSM               | Optional via Cloud HSM                         | Premium tier             | Depends on backend     |
| Re-wrap without plaintext exposure | No (decrypt + re-encrypt explicit)  | No                                             | No                       | Yes (`transit/rewrap`) |
| Operational overhead               | Low (managed)                       | Low (managed)                                  | Low (managed)            | High (HA cluster)      |
| Cost model                         | ~$1 per key per month + per-request | ~$0.06 per key version per month + per-request | Per-tier + per-operation | Self-hosted compute    |
| Auto KEK rotation                  | Annual (opt-in, customer-managed)   | Configurable per-key                           | Configurable             | Manual API call        |

---

## 6. Re-wrap procedure (KEK rotation)

The canonical procedure for rotating a KEK in any of the four KMS
options. The application's data ciphertext is **never** re-encrypted —
only the wrapped DEK changes.

1. **Rotate the KEK in the KMS.** The KMS service produces a new key
   version. The previous version remains usable for decryption (until it
   is eventually scheduled for deletion).
2. **Identify all wrapped DEKs in the database.** The
   [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md) lists
   every column with a `*KeyVersion` discriminator. Each such row holds
   one wrapped DEK to re-wrap.
3. **Re-wrap each DEK** in chunks (to respect KMS rate limits). For each
   row:
   - Read the wrapped DEK and the AAD context.
   - Ask the KMS to decrypt the DEK with the old KEK version.
   - Ask the KMS to encrypt the DEK with the new KEK version.
   - Write the new wrapped DEK back; the data ciphertext is untouched.
4. **Verify** by reading a sample of rows after the re-wrap and confirming
   that decryption with the new KEK version succeeds.
5. **Schedule the old KEK version for deletion** after a grace period
   (typically 30 days) so any in-flight reads with cached DEKs are not
   disrupted.

The Vault Transit advantage materialises in step 3: the
`vault write transit/rewrap/<key>` call collapses the
decrypt-then-encrypt into a single operation that never returns plaintext
to the caller. AWS, GCP, and Azure require the application to hold the
plaintext DEK in memory momentarily between the decrypt and encrypt
calls.

---

## 7. Performance considerations

Every encrypt or decrypt in the new model adds a KMS round-trip. The
mitigation strategies are well-established:

- **Per-call latency.** Cloud KMS APIs typically respond in 10–50 ms.
  Self-hosted Vault Transit in the same VPC can respond in 1–5 ms.
- **DEK caching.** A per-process LRU cache keyed by `(KEK version,
encryption context)` with a short TTL (e.g. 1 hour) reduces KMS calls
  from one-per-operation to one-per-cache-miss. Cache invalidation
  happens on KEK rotation; the entries naturally expire.
- **Bulk operations.** During the initial migration (and during re-wrap
  campaigns), batch wrap/unwrap APIs — where the KMS provider exposes
  them — amortise the per-call overhead.
- **Pre-warming.** At application startup, the boot path can pre-warm the
  DEK cache for hot encryption contexts (e.g. the platform-credential
  decryption that runs on every authenticated request).

The dominant cost driver after caching becomes the number of unique
encryption contexts — not the request rate.

---

## 8. Cost considerations

Indicative pricing (consult vendor pages for current rates):

- **AWS KMS** — ~$1 per CMK per month plus ~$0.03 per 10 000 requests.
  The customer-managed CloudHSM cluster is significantly more expensive
  if FIPS Level 3 is required.
- **GCP Cloud KMS** — ~$0.06 per active key version per month plus
  ~$0.03 per 10 000 cryptographic operations. Cloud HSM is a separate
  premium.
- **Azure Key Vault** — Standard tier at ~$0.03 per 10 000 operations;
  Premium tier (HSM-backed) is per-key-month plus operations.
- **HashiCorp Vault Transit** — self-hosted compute. A 3-node HA cluster
  on EC2 t3.medium is ~$200 per month for the VMs; storage and load
  balancer add to that.

For omni-post specifically, the migrated surface is small (the platform
master key wraps a handful of credential classes; per-channel DEKs would
amortise across many operations). With aggressive DEK caching the cost
is dominated by the number of unique encryption contexts, not the
request rate.

---

## 9. Rollback procedure

Each environment must be rollback-able independently. The forward path
is reversible at the cost of a re-wrap campaign in the opposite
direction.

1. Re-enable the in-app crypto path (the current `EncryptionService`
   stays present as a fallback during the migration window — it is not
   deleted until the migration is fully verified).
2. Decrypt all KMS-wrapped DEKs to plaintext DEKs in memory.
3. Re-encrypt the data with the in-app master key (the model the platform
   is on today).
4. Drop the KMS dependency.

The largest risk is **not** rollback complexity — it is **losing the KMS
key**. A KMS key that has been deleted (or whose region becomes
permanently unreachable) is irrecoverable, and the data wrapped under it
is lost. Mitigations:

- Multi-region KMS replication (where the provider supports it).
- KMS key backup procedure documented and tested before production
  cutover.
- Disaster-recovery test executed at least once before any production
  data is migrated.

---

## 10. Verify gates

The migration is considered ready for production when the following gates
pass in a non-production environment:

- End-to-end encrypt and decrypt cycle through the chosen KMS succeeds.
- DEK cache hit-rate metric is exposed via Prometheus and reads as
  expected under load.
- Audit log captures the KMS API calls with the principal, the AAD
  context, and the timestamp (CloudTrail / Cloud Audit Logs / Activity
  Log / Vault audit device, depending on the option chosen).
- Cost monitor and alert are configured against the KMS spend.
- Disaster-recovery test (KMS region failover or Vault leader failover)
  is executed and recovery time meets the recovery objective.

---

## 11. Operational links

- **Production deployment architecture** → [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)
- **Per-secret rotation cadence** → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- **Encryption-at-rest taxonomy** → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- **BYOK / per-tenant DEK feasibility** → SECRETS_BYOK_FEASIBILITY.md (Batch 15)
- **Final canonical reference** → SECRETS.md (Final batch)

---

## 12. Canon citations

| Source                           | URL                                                                                           | Date |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ---- |
| AWS KMS                          | <https://aws.amazon.com/kms/>                                                                 | 2026 |
| AWS KMS — automatic key rotation | <https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html>                      | 2026 |
| GCP Cloud KMS                    | <https://cloud.google.com/kms/docs>                                                           | 2026 |
| Azure Key Vault                  | <https://learn.microsoft.com/en-us/azure/key-vault/general/overview>                          | 2026 |
| HashiCorp Vault Transit          | <https://developer.hashicorp.com/vault/docs/secrets/transit>                                  | 2026 |
| Vault Transit — rewrap procedure | <https://developer.hashicorp.com/vault/tutorials/encryption-as-a-service/eaas-transit-rewrap> | 2026 |
