# Secrets · Production Architecture

This document describes the deployment-time options for delivering secrets to
production runtimes. It does NOT cover rotation procedure (see
[T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)) or
encryption-at-rest in the database (see
[SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)).

The decision matrix is intentionally neutral — it lists viable options per
environment with their trade-offs but does not pre-select a primary stack.
The mapping of specific secrets to specific stores will be decided in a
separate working session and captured in the final canonical reference.

---

## 1. Scope

### Covers

- Deployment-time secret delivery for the omni-post platform
- Current deployment topology (single VPS-style runtime, future Kubernetes)
- Near-term horizon (1–2 years)

### Does not cover

- Per-secret rotation procedure → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- Encryption-at-rest model and `keyVersion` taxonomy → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- KMS deep-dive (AWS KMS · Vault Transit · GCP KMS · Azure Key Vault) → Batch 14
- BYOK / per-tenant DEK feasibility → Batch 15
- Multi-region / multi-cloud federation (deferred beyond near-term horizon)
- Sample manifests — those live in operational documents per chosen tool;
  this document stays at the architectural level

### Audience

Anyone who needs to understand the options for moving secrets out of `.env`
and into a production-grade delivery mechanism: contributors, reviewers,
operators, security auditors.

---

## 2. Current state

The omni-post platform currently delivers secrets via a single `.env` file
per process. The repository ships [.env.example](../../.env.example) (~43
secrets across the API, workers, admin, and client apps); operators copy that
template, fill in real values, and place the resulting `.env` on each runtime
host. Validation happens at boot through `@t3-oss/env-core` + Zod
([apps/api/src/config/env.ts](../../apps/api/src/config/env.ts) and the
equivalent files in the Next.js apps).

This model is appropriate for local development. For production it has four
gaps:

- **No automated rotation.** Cryptoperiods documented in T0A
  (90 days for JWT signing keys, 12 months for API keys, etc.) are
  enforced manually. A missed rotation does not fail any check; the
  platform happily keeps using a stale secret.
- **No audit-on-access.** A secret value is read by every process that
  imports `env.X`; no record exists of which process read which secret at
  what time. Forensic investigation after an incident is reduced to log
  inference.
- **High exposure surface during delivery.** Operators move plaintext
  values across Slack, SSH sessions, deployment dashboards, and shell
  history. Each hop is an opportunity for accidental capture (tmux scroll
  buffers, screen-sharing, accidental `git add .env`).
- **No segregation guarantee per environment.** Nothing structurally
  prevents the same `.env` from ending up in dev and prod. The Zod schema
  validates shape, not provenance.

The remediation work in Batches 01–09 hardened the application boundary
(Zod fail-fast, fitness checks #15–#19, secretlint + gitleaks pre-commit,
Argon2id hashing, AAD-bound encryption). The remaining gap is **how the
plaintext value reaches the running process in the first place**. That is
what this document addresses.

---

## 3. Canon: six deployment patterns

Each pattern has a canonical primary source (the authors, not a tutorial),
a one-paragraph description, and explicit when-to-use / when-NOT-to-use
guidance. None of these are mutually exclusive — most production stacks
combine two or three.

### 3.1 External Secrets Operator (ESO)

A Kubernetes operator that synchronises secrets from an external store
(AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, HashiCorp Vault,
Doppler, 1Password, and many more) into native `Secret` resources inside the
cluster. Workloads consume the synchronised `Secret` as they would any other
Kubernetes secret; the operator reconciles the value when the upstream store
changes.

The architecture revolves around three Custom Resources: `SecretStore`
defines a backend (per namespace), `ClusterSecretStore` does the same
cluster-wide, and `ExternalSecret` declares which keys to fetch from which
store and into which target `Secret`. The 2026 line was rebuilt on the
`controller-runtime` framework with high-availability deployment as the
default.

- **When to use:** the runtime is Kubernetes and there is already (or will
  be) a backing secret store. ESO is the canonical bridge.
- **When NOT to use:** the runtime is not Kubernetes, or the backing store
  is the only source of truth and direct integration (e.g. an SDK call from
  the app) is cheaper than running the operator.
- **Canon:** <https://external-secrets.io/>

### 3.2 SOPS + age

[SOPS](https://github.com/getsops/sops) (Secrets OPerationS, originally
Mozilla, now CNCF-graduated) encrypts only the _values_ in a structured file
(YAML, JSON, env, INI), keeping the keys plaintext so diffs and code review
remain meaningful. Combined with [age](https://age-encryption.org/) (modern
file-encryption library, X25519 + ChaCha20-Poly1305, no PGP keyring), it
gives a GitOps repository the property that every secret is encrypted at
rest in git and decryptable only with the recipients' age private keys.

Operationally: a `.sops.yaml` at the repo root pins encryption rules
(creation rules per path, recipient public keys per environment). Pre-commit
hooks reject any unencrypted file matching the rules. CI/CD systems hold
the age private key as their own secret and decrypt at deploy time.

- **When to use:** GitOps workflow, mostly static secrets, small team that
  can maintain the discipline of separate age keys per environment.
- **When NOT to use:** dynamic secrets needed (DB credentials with TTL,
  one-time-use tokens), audit-on-access required, large team where
  individual key rotation becomes an ops burden.
- **Canon:** <https://github.com/getsops/sops> · <https://age-encryption.org/>

### 3.3 dotenvx

[dotenvx](https://dotenvx.com/) is the encrypted successor to `dotenv` (same
author, Scott Motte). It encrypts each value in a `.env` file with ECIES
(elliptic-curve hybrid encryption: ephemeral X25519 keys + AES-256-GCM),
producing a file whose keys remain plaintext but whose values are
ciphertext. The encrypted `.env.production` is committed to the repository;
the matching `DOTENV_PRIVATE_KEY_PRODUCTION` lives only on the runtime host
or in CI secrets.

The workflow is identical to plain `dotenv` from the application's
perspective — `dotenvx run -- node app.js` decrypts in-memory before
invoking the process, and the application sees normal environment variables.

- **When to use:** single-VPS or single-host deployments where running an
  external secret store would dwarf the app's footprint; minimal infra and
  zero cloud dependency required.
- **When NOT to use:** multi-instance deployments (each new host needs the
  private key, no native rotation story); audit-on-access required;
  Kubernetes (use ESO instead).
- **Canon:** <https://dotenvx.com/> · <https://github.com/dotenvx/dotenvx>

### 3.4 Doppler

[Doppler](https://www.doppler.com/) is a SaaS secrets manager built around
a Project / Environment / Config hierarchy that maps cleanly onto
dev / staging / production. Applications consume secrets via the Doppler
CLI (`doppler run -- pnpm dev`) or via SDKs that call the Doppler API at
boot. The dashboard is the source of truth; CI/CD systems authenticate
with service tokens and pull the current values at deploy time.

- **When to use:** centralised secrets across local dev, CI, and runtime
  with a developer-friendly UX; no appetite to operate self-hosted secret
  infrastructure.
- **When NOT to use:** air-gapped or on-prem requirements; vendor-SaaS
  intolerance (compliance, sovereignty); use cases that need dynamic
  secrets (Doppler stores values, not generates them).
- **Canon:** <https://www.doppler.com/>

### 3.5 1Password CLI

[1Password CLI](https://developer.1password.com/docs/cli/) treats secrets as
an extension of the human-credentials vault: the same `op` binary that
unlocks a developer's password vault can also resolve a secret reference
(`op://vault/item/field`) at process-startup time. Combined with **service
accounts** for non-interactive use, it gives small teams a single tool for
both human passwords and machine secrets.

- **When to use:** the team already uses 1Password for password management
  and the additional secrets footprint is small (early-stage product, a
  handful of services); humans and machines reading from the same vault is
  acceptable.
- **When NOT to use:** standalone application-runtime secrets manager at
  scale; environments where humans should not be able to read machine
  secrets; high-throughput services where every boot pulling from the
  1Password API becomes a coupling point.
- **Canon:** <https://developer.1password.com/docs/cli/>

### 3.6 HashiCorp Vault

[Vault](https://www.vaultproject.io/) is the self-hosted enterprise
reference. Three capabilities differentiate it from the SaaS options:
**dynamic secrets** (database credentials generated on demand with
configurable TTLs, then automatically revoked), **transit encryption**
(encryption-as-a-service, so applications never see the key material), and
a **policy engine** that scopes access at fine granularity. The Vault
Secrets Operator (2026) injects directly into Kubernetes pods, putting it
in the same architectural slot as ESO for K8s consumers.

Vault relicensed from MPL to BSL in August 2023; for internal use the
license is unchanged in practice — restrictions only apply to building a
competing managed-Vault service.

- **When to use:** multi-cloud or hybrid topology; dynamic secrets are
  required (per-request DB credentials, short-lived cloud IAM roles);
  dedicated DevOps/SRE capacity to operate a HA cluster.
- **When NOT to use:** small team without the operational capacity to run
  Vault HA; single-cloud deployment where the cloud-native secret manager
  covers the same ground at lower cost.
- **Canon:** <https://www.vaultproject.io/>

### 3.7 Cloud-native single-cloud comparators

For completeness, the cloud providers each ship a managed equivalent:

- **AWS Secrets Manager** — built-in rotation lambdas for RDS / DocumentDB
  / Redshift; ~$0.40 per secret per month plus API calls.
  <https://aws.amazon.com/secrets-manager/>
- **GCP Secret Manager** — versioned secrets, IAM-based access, free tier
  generous for small workloads. <https://cloud.google.com/secret-manager>
- **Azure Key Vault** — combines secret storage with HSM-backed key
  management; deep integration with Azure AD identities.
  <https://learn.microsoft.com/en-us/azure/key-vault/general/overview>

These are the simplest option when the workload runs entirely inside one
cloud. They become friction in a multi-cloud topology, which is where
Vault's appeal grows.

---

## 4. Decision matrix per environment

The matrix lists viable options per environment with their main trade-offs.
No primary stack is selected here.

### 4.1 Local development (per developer)

| Option                    | Trade-off                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Plain `.env` (status quo) | Zero overhead; zero audit; zero protection if the laptop is lost.                                  |
| dotenvx                   | Encrypted at rest; private key stays out of the repo; minimal workflow change.                     |
| Doppler dev project       | Single source of truth across the team; requires every developer to authenticate with Doppler CLI. |
| 1Password CLI             | Reuses existing 1Password vault; couples developer environment to vault availability.              |

### 4.2 CI/CD pipelines

| Option                              | Trade-off                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| GitHub OIDC → cloud secret manager  | No long-lived static tokens stored in GitHub; requires the cloud provider's OIDC trust setup.     |
| Doppler CLI with service token      | Vendor-managed audit trail; the service token itself becomes the bootstrapping secret to protect. |
| 1Password Connect / service account | Reuses the 1Password vault; same bootstrap-secret problem as Doppler.                             |
| SOPS+age decrypt step               | Self-contained inside the repo; CI must hold the age private key.                                 |

### 4.3 Staging (future Kubernetes runtime)

| Option                     | Trade-off                                                                   |
| -------------------------- | --------------------------------------------------------------------------- |
| ESO + cloud secret manager | Common abstraction; the cloud manager defines audit and rotation features.  |
| ESO + Doppler              | Same abstraction with a SaaS backend; lighter setup than Vault.             |
| ESO + Vault                | Adds dynamic secrets and transit encryption at the cost of operating Vault. |

### 4.4 Production (future Kubernetes runtime)

| Option                          | Trade-off                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ESO + cloud secret manager      | Single-cloud lock-in but lowest operational overhead; native rotation for managed databases.           |
| ESO + Vault Transit             | Multi-cloud portable; enables BYOK and dynamic DB credentials; Vault HA cluster to operate.            |
| Vault Secrets Operator (direct) | Skips the ESO indirection if Vault is already the standard; slightly tighter coupling to Vault's CRDs. |

### 4.5 Production (current VPS-style runtime)

| Option                                        | Trade-off                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| dotenvx + KMS-protected `DOTENV_PRIVATE_KEY`  | Minimal infra footprint; the private key still has to live on the host (or be fetched at boot). |
| Doppler runtime CLI                           | Zero infra to operate; requires Doppler reachability at every process start.                    |
| Cloud secret manager + boot-time fetch script | Native cloud audit; vendor lock-in; the script becomes part of the deployment surface.          |
| 1Password CLI / Connect                       | Reuses the team's vault; couples production runtime to vault availability.                      |

### 4.6 GitOps repository (manifests + config-as-code)

| Option                      | Trade-off                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| SOPS + age                  | Modern crypto; the canonical approach for GitOps secrets; requires per-environment age keys.        |
| `git-crypt`                 | Older alternative; transparent encryption per `.gitattributes`; weaker tooling story than SOPS.     |
| External Secrets references | Manifests carry only references (e.g. `vault://path/to/secret`); the actual values never enter git. |

---

## 5. Migration steps

Any of the targets above can be reached from the current `.env` state by
following the same five-step procedure. The mapping of specific secrets to
specific stores is intentionally out of scope for this document — it will
be decided in a follow-up working session.

1. **Categorise the existing secrets** by sensitivity class and rotation
   cadence (using the NIST classes documented in T0A). The output of this
   step is the _criteria_ for choosing a destination, not the final
   per-secret table.
2. **Provision the target stores.** Create accounts, projects, vaults, or
   secret-manager namespaces as needed. Configure IAM / OIDC / service
   accounts for both CI and runtime principals.
3. **Migrate secrets in order of criticality.** Database credentials and
   master encryption keys first; OAuth client secrets and provider API keys
   next; observability tokens last. Keep `.env` as a fallback during the
   per-environment cutover so a failed migration is reversible.
4. **Update CI/CD to inject from the target store.** The deploy job pulls
   from the store and either writes a transient `.env` for the runtime or
   sets environment variables on the process; either way the value never
   appears in the repository or the workflow YAML.
5. **Remove `.env` from production.** Once all secrets are sourced from the
   target store and the boot path is verified, delete the production
   `.env` file. Keep the local-dev `.env` for developer ergonomics, gated
   by the existing fitness functions that prevent its committed
   counterpart from carrying real values.

---

## 6. Verify gates per environment

Each environment has an end-to-end check that proves the delivery mechanism
is intact:

- **Local dev:** the application boots with no `.env` file present when the
  chosen target store is connected (e.g. `doppler run -- pnpm dev`). The
  Zod schema in [apps/api/src/config/env.ts](../../apps/api/src/config/env.ts)
  passes.
- **CI/CD:** the pipeline workflow YAML contains zero plaintext secret
  values (auditable via secretlint + the existing fitness functions).
  Service tokens used by the pipeline are themselves managed in the target
  store, not pasted into GitHub Actions secrets.
- **Production runtime:** restarting the process or pod re-syncs the
  current secret values from the target store with no manual intervention.
  A rotated secret propagates to the process within the store's
  reconciliation window.
- **Audit:** every read of a sensitive secret appears in the target
  store's audit trail with the principal and timestamp.

---

## 7. Operational links

- **Per-secret rotation procedure** → [T0A_SECRETS_ROTATION_RUNBOOK.md](./T0A_SECRETS_ROTATION_RUNBOOK.md)
- **Encryption-at-rest model** → [SECRETS_DATABASE_INVENTORY.md](./SECRETS_DATABASE_INVENTORY.md)
- **KMS deep-dive (AWS KMS · Vault Transit · GCP KMS · Azure Key Vault)** → SECRETS_KMS_MIGRATION.md (Batch 14)
- **BYOK / per-tenant DEK feasibility** → SECRETS_BYOK_FEASIBILITY.md (Batch 15)
- **Final canonical reference (per-secret location and procedure)** → SECRETS.md (Final batch)

---

## 8. Canon citations

| Source                    | URL                                                                  | Date |
| ------------------------- | -------------------------------------------------------------------- | ---- |
| External Secrets Operator | <https://external-secrets.io/>                                       | 2026 |
| getsops/sops              | <https://github.com/getsops/sops>                                    | 2026 |
| age-encryption            | <https://age-encryption.org/>                                        | 2026 |
| dotenvx                   | <https://dotenvx.com/> · <https://github.com/dotenvx/dotenvx>        | 2026 |
| Doppler                   | <https://www.doppler.com/>                                           | 2026 |
| 1Password CLI             | <https://developer.1password.com/docs/cli/>                          | 2026 |
| HashiCorp Vault           | <https://www.vaultproject.io/>                                       | 2026 |
| AWS Secrets Manager       | <https://aws.amazon.com/secrets-manager/>                            | 2026 |
| GCP Secret Manager        | <https://cloud.google.com/secret-manager>                            | 2026 |
| Azure Key Vault           | <https://learn.microsoft.com/en-us/azure/key-vault/general/overview> | 2026 |
