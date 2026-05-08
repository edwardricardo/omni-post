# Secrets · BYOK Feasibility Study

This document is a feasibility study for moving omni-post from a
single-platform-master-key model to a per-tenant key model, optionally
extending to true Bring-Your-Own-Key (BYOK) for enterprise tenants. It
analyses three levels of per-tenant key isolation (L1 / L2 / L3),
quantifies the schema and operational impact, lays out the compliance
benefits unlocked at each level, and proposes the implementation phases
that would apply when the work is approved.

It is **not** a recommendation to execute. The decision criteria in §10
must be satisfied before committing to any phase. The architectural
inputs that this study presupposes (KMS provider, deployment topology)
live in [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md) (Batch 14)
and [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)
(Batch 13).

---

## 1. Scope

**Covers**

- Per-tenant DEK / KEK study and the three industry-standard isolation
  levels (L1 platform-KEK, L2 per-tenant-KEK, L3 customer-managed KEK)
- Database schema impact (the tables and columns that change at each level)
- Performance and operational impact at scale
- Compliance benefits (GDPR Art. 17, HIPAA Security Rule, SOC2 Common
  Criteria CC6.7, PCI-DSS Req. 3)
- Implementation phases for the chosen level
- Decision criteria — the questions that must have answers before any
  phase is executed

**Does not cover**

- Implementation code (schema migrations, EncryptionService refactor) —
  out of scope; this is feasibility, not an executive plan
- L3 deep-dive setup (AWS XKS, GCP EKM, Azure HYOK detailed configuration)
  — referenced, but the step-by-step operational guide is deferred
- Pricing model for a BYOK enterprise tier — a product decision
- The KMS provider selection itself → [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md)
- Deployment-time secret delivery → [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md)
- Per-secret rotation cadence → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)

**Audience**

Product and security planning teams considering SOC2 / HIPAA / GDPR
roadmap; enterprise sales preparing technical answers for procurement
questionnaires; engineering when a level is approved for implementation.

---

## 2. Current state

omni-post is multi-tenant. The tenancy boundary is `Account`
([infra/prisma/schema.prisma:11](../../infra/prisma/schema.prisma#L11));
`Project`, `Channel`, and the rest of the application data hang off
`accountId` with `onDelete: Cascade`.

Today, every tenant's encrypted data is protected by the **same** master
key (`PLATFORM_ENCRYPTION_KEY`). The earlier batches added two
properties on top of that single key:

- A graceful-rotation window via `keyVersion` on every persisted
  ciphertext (Batch 06).
- AAD-bound `EncryptionContext` that prevents cross-record substitution
  inside a single tenant — and incidentally across tenants — but does
  **not** prevent cross-tenant blast radius if the master key itself is
  compromised (Batch 08).

The current model also leaves tenant deletion incomplete from a
right-to-erasure perspective. `Account.delete` cascades through the
relational graph in the active database, but encrypted data persists in
backups, read-replicas, and any audit trail. The platform operator
cannot selectively destroy a single tenant's data from cold storage.

---

## 3. Three levels of per-tenant key isolation

The industry taxonomy distinguishes three levels of isolation, each
strictly stronger than the previous one. They are not alternatives —
they form a tiering: a product can offer L1 to all tenants, L2 to paid
tiers, and L3 as an enterprise-compliance addon.

### 3.1 Level 1 — Per-record DEK, single platform KEK

Every encrypted row carries its own Data Encryption Key (DEK). All DEKs
are wrapped by a single platform-wide KEK held in the platform's KMS.
Tenants share the same KEK; only the DEKs differ.

- **Blast-radius reduction:** smallest. Compromising the platform KEK
  unlocks every DEK and therefore every record across all tenants.
- **Schema change:** largest. Every encrypted column gains a wrapped-DEK
  column.
- **GDPR crypto-shredding:** not available — destroying the platform
  KEK would shred _all_ tenants' data.
- **Operational footprint:** lightest. One KEK to manage.

### 3.2 Level 2 — Per-tenant KEK, platform-managed

Each `Account` has its own KEK in the platform's KMS. DEKs (per-record
or per-field) are wrapped by the tenant's KEK. The platform retains
custody of the KEK material.

- **Blast-radius reduction:** strong. A compromised platform KMS account
  still exposes all tenants, but a per-tenant compromise (e.g., a misbehaving
  application code path scoped to one tenant's resources) cannot leak
  another tenant's data.
- **Schema change:** mid-weight. `Account` gains a KEK reference column;
  encrypted columns gain wrapped-DEK columns as in L1.
- **GDPR crypto-shredding:** **available** — destroying a tenant's KEK
  renders all their encrypted data permanently unreadable, in active DB
  and backups alike. Recognised as a valid Article 17 deletion method
  by the Article 29 Working Party.
- **Operational footprint:** mid-weight. Tenant-key lifecycle hooks
  (provision on `Account.create`, disable on suspend, schedule destruction
  on delete) become part of the platform.

### 3.3 Level 3 — Customer-managed KEK (true BYOK)

The tenant supplies their own KEK via cross-account key reference. The
platform never has custody of the key material. Three vendor patterns
exist:

- **AWS KMS External Key Store (XKS):** the KEK lives in the customer's
  HSM; AWS KMS calls out to the customer for every wrap/unwrap.
- **GCP External Key Manager (EKM):** equivalent to XKS for GCP.
- **Azure Managed HSM with HYOK ("Hold Your Own Key"):** the customer
  retains custody; Azure invokes their HSM for cryptographic operations.

- **Blast-radius reduction:** maximum. The platform cannot decrypt the
  tenant's data without the customer's HSM cooperation; the customer can
  revoke at any time.
- **Schema change:** same as L2 (`Account.kekKmsKeyId` simply points to
  an external key reference).
- **GDPR crypto-shredding:** the customer can shred unilaterally.
- **Operational footprint:** heaviest. Latency depends on the customer's
  HSM availability; outages of the customer's HSM stall their tenant
  unconditionally; debugging crosses an organisational boundary.

---

## 4. Schema impact (L2 baseline)

L2 is the most likely starting point because L1 lacks the
crypto-shredding property and L3 layers on top of L2 without changing
the core schema. The columns described here are baseline — exact column
naming is decided when the migration is designed.

| Table                                                                                                                                                         | Column additions                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `Account`                                                                                                                                                     | `kekKmsKeyId String?`, `kekProvisionedAt DateTime?`, `kekRotatedAt DateTime?`                                          |
| Each encrypted field row (e.g. `Channel.credentials`, `OidcConfiguration.clientSecret`, `ExternalNotificationConfig.webhookUrl`, `AdminSession.refreshToken`) | `wrappedDekCiphertext String?`, `wrappedDekKeyVersion Int?` (existing `*KeyVersion` column repurposes for KEK version) |

Migration semantics:

- Every column starts nullable; existing code keeps using the platform
  KEK when `Account.kekKmsKeyId` is null.
- Backfill is lazy: the next write to a row populates the per-tenant
  wrapped DEK. A background job sweeps remaining rows once the lazy
  backfill stabilises.
- Cardinality: one KEK per `Account` (not per `Project` — `Account` is
  the tenancy boundary in the current schema). Total KEK count tracks
  active account count.

The exact migration plan and column names are designed when L2 is
approved, not in this study.

---

## 5. Performance impact

Every encryption or decryption that goes through a per-tenant KEK
requires, at minimum, the unwrap of that tenant's DEK by the KMS. Three
mitigations apply:

- **Per-tenant DEK cache:** an in-process LRU keyed by `accountId` (and
  by `(accountId, encryption context)` if more granularity is needed)
  reduces the steady-state cost from one-KMS-call-per-operation to
  one-KMS-call-per-cache-miss. TTL of 1 h is typical.
- **Cold-start cost:** the first request per `(tenant, process)` pair
  pays one KMS round-trip. A pre-warm step at process startup (for hot
  tenants) eliminates the user-visible spike.
- **Per-tenant KMS rate limits:** cloud KMS providers throttle per
  customer key. For high-write enterprise tenants this becomes the
  bottleneck, not the per-call latency.

The migration cost is one-shot: the backfill campaign issues N KMS
calls for N existing encrypted rows, chunked by `accountId` and
throttled to stay within KMS rate limits.

---

## 6. Operational impact

The L2/L3 model introduces **tenant key lifecycle hooks** that do not
exist today:

- `Account.create` → provision tenant KEK in KMS.
- `Account.suspend` → disable KEK without destruction (the tenant can be
  reactivated).
- `Account.delete` → schedule KEK destruction with the standard 24-hour
  cloud KMS grace window. Crypto-shredding completes when destruction
  finalises.

Other operational consequences:

- **Backup strategy.** Backups are encrypted under whatever KEK was
  active at backup time. If the tenant's KEK is destroyed, the backup
  cannot be restored. This is the feature for GDPR (data is genuinely
  unrecoverable). It is the bug for accidental deletion (mitigated by
  the 24-hour grace and KEK backup procedures where the KMS supports
  them).
- **Disaster recovery.** Loss of a tenant KEK is loss of the tenant's
  data. Multi-region KEK replication is non-optional in production.
- **Audit complexity.** Per-tenant CloudTrail / Cloud Audit / Activity
  Log queries become the norm. The logs gain per-tenant scope.
- **Key cost.** Cloud KMS pricing is per key per month. At 10 tenants
  the cost is rounding error; at 100 000 tenants the line item is
  material and must be modelled before commit.

---

## 7. Compliance benefits

The benefits scale with the level chosen.

- **GDPR Art. 17 (Right to Erasure).** Crypto-shredding via KEK
  destruction is recognised as a valid deletion method. The Article 29
  Working Party (precursor to the EDPB) acknowledged cryptographic
  erasure where the data is rendered permanently irrecoverable. The
  practical effect: a tenant deletion request is satisfied by a single
  KMS API call instead of a hunt-and-delete campaign across active DB,
  read-replicas, and backups.
- **HIPAA Security Rule §164.312(a)(2)(iv).** The "encryption and
  decryption" addressable specification is satisfied by any AES
  encryption of PHI at rest; per-tenant KEK strengthens the implementation
  and supports the "minimum necessary" principle.
- **SOC2 Trust Services Criterion CC6.7.** Data confidentiality during
  transmission and at rest. Per-tenant key isolation provides direct
  evidence for the auditor.
- **PCI-DSS Req. 3 (Protect stored cardholder data).** If cardholder
  data ever enters the platform, per-tenant key separation reduces the
  audit scope and the blast radius of a single-tenant compromise.
- **Sales / procurement.** Enterprise procurement questionnaires
  routinely require BYOK or describe it as a contractual addendum.
  Without an L2 or L3 offer the deal can stall.

The compliance benefits are not free: each framework's requirements
must be evidenced (key lifecycle audit logs, DR test reports,
encryption-at-rest scope diagrams). The benefit is unlocking the
**possibility** of certification, not the certification itself.

---

## 8. Implementation phases

When the work is approved, the migration unfolds in seven phases, each
of which leaves the platform in a working state:

1. **Schema additions.** `Account.kekKmsKeyId` nullable + wrapped-DEK
   columns. Non-breaking; existing code paths unchanged.
2. **Per-tenant DEK helper layer in `EncryptionService`.** When
   `Account.kekKmsKeyId` is null, fall back to the platform KEK; when set,
   use the per-tenant flow.
3. **KEK provisioning hook on `Account.create`.** Gated behind a feature
   flag for incremental rollout. New accounts get per-tenant KEKs;
   existing accounts continue under the platform KEK until phase 5.
4. **BYOK opt-in feature flag for paid tier.** Customers self-serve the
   provisioning; until they opt in, they continue under the platform
   KEK.
5. **Backfill campaign.** Background job per `Account`, idempotent and
   resumable, that lazily migrates active rows to per-tenant DEKs.
6. **Crypto-shredding on `Account.delete`.** Background job schedules
   the KEK destruction with the standard 24-hour grace; tenant-facing
   docs describe the irreversibility.
7. **L3 — true BYOK** (separate follow-up). XKS / EKM / HYOK setup,
   customer onboarding flow, customer revocation handling. Only
   undertaken if phases 1–6 prove the model and an enterprise customer
   asks for it.

The seven phases are weeks of work, not days. They are not all required
— phases 1–3 alone deliver per-tenant DEK with crypto-shredding for new
accounts; phases 4–6 generalise to all tenants; phase 7 is the BYOK
upsell.

---

## 9. Risks

- **Catastrophic data loss.** A destroyed tenant KEK with no backup
  cannot be recovered, and neither can the tenant's data. Mitigations:
  the 24-hour grace before destruction is final; multi-region KMS
  replication; documented disaster recovery test before any production
  tenant is migrated.
- **Performance regression at scale.** Per-tenant KMS calls per request
  are unsustainable without caching. Mitigation: aggressive per-tenant
  DEK cache with sensible TTL is non-optional.
- **Cost growth with tenant count.** Cloud KMS keys are billed monthly.
  The total cost should be modelled at the projected tenant count and
  approved before commit.
- **Backup / restore semantics.** The contract changes: data deleted
  via crypto-shredding cannot be restored even from backups. This must
  be reflected in tenant-facing terms of service and support procedures.
- **Cross-region failures.** A KMS regional outage stalls per-tenant
  operations until failover. Multi-region replication is the standard
  mitigation; the failover path must be tested.

---

## 10. Decision criteria

Before any phase is executed the following questions must have answers
documented:

- **Tenant volume.** How many tenants does omni-post expect on a 1–2 year
  horizon? Tens of tenants make BYOK trivially affordable; thousands of
  tenants make L2 a real cost line item; hundreds of thousands of tenants
  push the model toward shared-tenant pools or sharded keys.
- **Enterprise demand.** What fraction of pipeline tenants formally
  request BYOK in their procurement questionnaires? If the fraction is
  near zero the project pays cost without revenue.
- **Compliance roadmap.** Is a SOC2 Type II / HIPAA / GDPR certification
  in the next 12 months? If yes, per-tenant isolation is on the critical
  path; if no, it can be deferred.
- **Operational capacity.** Can the team support the new tenant-key
  lifecycle (provisioning, destruction, DR drills)?
- **KMS provider choice.** Does the KMS provider chosen in
  [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md) support L3
  (XKS / EKM / HYOK) if L3 is in scope?

---

## 11. Verify gates (when implemented)

Before promoting any phase to production, the following gates must
pass in a non-production environment:

- End-to-end per-tenant encryption and decryption succeeds for a test
  account that has `kekKmsKeyId` provisioned.
- Crypto-shredding test: destroy a test tenant's KEK and confirm that
  decryption fails for both active database rows and backup-restore
  reads.
- Backup-restore with destroyed KEK fails gracefully with a clear error
  message that names crypto-shredding as the cause.
- Per-tenant cost monitor is operational and alerts when a single
  tenant's KMS spend exceeds a configured threshold.

---

## 12. Operational links

- **KMS architecture base** → [SECRETS_KMS_MIGRATION.md](./SECRETS_KMS_MIGRATION.md) (Batch 14)
- **Production deployment** → [SECRETS_PRODUCTION_ARCHITECTURE.md](./SECRETS_PRODUCTION_ARCHITECTURE.md) (Batch 13)
- **Per-secret rotation** → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- **Encryption-at-rest taxonomy** → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- **Final canonical reference** → SECRETS.md (Final batch)

---

## 13. Canon citations

| Source                                            | URL                                                                                                                      | Date            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| IronCore Labs — BYOK explained                    | <https://ironcorelabs.com/byok/>                                                                                         | 2026            |
| AWS Architecture Blog — multi-tenant KMS strategy | <https://aws.amazon.com/blogs/architecture/simplify-multi-tenant-encryption-with-a-cost-conscious-aws-kms-key-strategy/> | 2026            |
| AWS KMS External Key Store (XKS)                  | <https://docs.aws.amazon.com/kms/latest/developerguide/keystore-external.html>                                           | 2026            |
| GCP Cloud External Key Manager (EKM)              | <https://cloud.google.com/kms/docs/ekm>                                                                                  | 2026            |
| Azure Managed HSM — Hold Your Own Key (HYOK)      | <https://learn.microsoft.com/en-us/azure/key-vault/managed-hsm/overview>                                                 | 2026            |
| Crypto-shredding for GDPR right-to-erasure        | <https://stealthcloud.ai/cryptography/cryptographic-shredding-deep-dive/>                                                | 2026            |
| GDPR Article 17 (Right to Erasure)                | <https://gdpr-info.eu/art-17-gdpr/>                                                                                      | 2018 (in force) |
| HIPAA Security Rule §164.312                      | <https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html>                                       | 2024 (current)  |
| SOC2 Trust Services Criteria (AICPA)              | <https://www.aicpa-cima.com/topic/audit-assurance/audit-and-assurance-greater-than-soc-2>                                | 2022 (current)  |
| PCI-DSS v4.0.1                                    | <https://www.pcisecuritystandards.org/standards/pci-dss/>                                                                | 2024            |
