# Register of processing activities

The skeleton of OmniPost's record of processing activities, laid out on the elements of GDPR art. 30(1), with each element either filled from the code or marked as a decision still to take.

- **What it is.** A register of facts kept with the code: what the application stores, sets and sends, each fact citing an inventory page, a document or a code path.
- **What it is not.** It is not a privacy notice, terms of service or a data processing agreement, and it is not legal advice: it holds no legal reasoning, and nothing here decides a purpose, a legal basis or a retention period.
- **How it is verified.** A `generated` section points at an inventory page that `pnpm check:legal` regenerates and compares byte for byte; the commit that last regenerated a page is its verification date. A `linked` section points at the document that is the source of truth, and this page does not restate it. How the register grows: [README](README.md).

## At a glance

| #   | Section                                                                | GDPR art. 30(1) | Status                             |
| --- | ---------------------------------------------------------------------- | --------------- | ---------------------------------- |
| 1   | [Identity of the controller](#1-identity-of-the-controller)            | (a)             | `pending decision (owner: Edward)` |
| 2   | [Purposes of processing](#2-purposes-of-processing)                    | (b)             | `pending decision (owner: Edward)` |
| 3   | [Legal bases per purpose](#3-legal-bases-per-purpose)                  | —               | `pending decision (owner: Edward)` |
| 4   | [Categories of data subjects](#4-categories-of-data-subjects)          | (c)             | `generated`                        |
| 5   | [Categories of personal data](#5-categories-of-personal-data)          | (c)             | `generated`                        |
| 6   | [Recipients and subprocessors](#6-recipients-and-subprocessors)        | (d)             | `generated`                        |
| 7   | [Transfers to third countries](#7-transfers-to-third-countries)        | (e)             | `pending decision (owner: Edward)` |
| 8   | [Retention and erasure](#8-retention-and-erasure)                      | (f)             | `linked`                           |
| 9   | [Security measures](#9-technical-and-organisational-security-measures) | (g)             | `linked`                           |
| 10  | [Cookies and browser storage](#10-cookies-and-browser-storage)         | —               | `generated`                        |
| 11  | [OAuth permissions per provider](#11-oauth-permissions-per-provider)   | —               | `generated`                        |
| 12  | [Consent and acceptance evidence](#12-consent-and-acceptance-evidence) | —               | `pending decision (owner: Edward)` |
| 13  | [Commercial and billing rules](#13-commercial-and-billing-rules)       | —               | `linked`                           |

A dash in the art. 30(1) column marks a section the register keeps although that paragraph does not list it.

### Status legend

| Status                             | Meaning                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `generated`                        | Points at an inventory page under `inventories/`; a generator writes it, nobody edits it.       |
| `linked`                           | Points at an existing document that is the source of truth for the element.                     |
| `pending decision (owner: Edward)` | Empty until Edward decides; one line names the decision that fills it.                          |
| `upcoming (unit <name>)`           | A generator in its own unit of Master Plan §5.10 fills it when it lands; nothing is listed now. |

### Decisions that span every section

**Status:** `pending decision (owner: Edward)`

- **Frameworks beyond the GDPR.** Which other privacy frameworks the register answers to. The Admin compliance settings already hold a `defaultJurisdiction` value (`GDPR`, `LGPD`, `CCPA`, `PIPEDA` or `OTHER`, default `GDPR`); that setting is configuration, not this decision.
- **Final language of the register.** The register is written in English today.

## 1. Identity of the controller

**Status:** `pending decision (owner: Edward)`

Decision: the controller's name and contact details, its representative and data protection officer, and the role OmniPost holds (controller or processor) in each processing activity.

Fact: the Admin compliance settings (`GdprSettings`, edited through `apps/admin/components/compliance/GdprSettingsForm.tsx`) store a DPO type and contact (`dpoType`, `dpoEmail`, `dpoUrl`) and the URLs of the privacy policy, the cookie policy and the terms of service. They are deployment settings, not this decision.

## 2. Purposes of processing

**Status:** `pending decision (owner: Edward)`

Decision: the list of purposes for which the application processes personal data. LEGAL-1 inventories them; sections 3 and 12 depend on that list.

## 3. Legal bases per purpose

**Status:** `pending decision (owner: Edward)`

Decision: the legal basis of each purpose in section 2, once that list exists.

## 4. Categories of data subjects

**Status:** `generated` — [personal-data inventory](inventories/personal-data.generated.md), column Subject

The personal-data classification ([`classification/personal-data.json`](classification/personal-data.json)) assigns every `personal` field one of four subjects, shown in the page's Subject column. The current figures are the page's Summary table.

| Subject         | Whose data, as the classification uses it                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `customer-user` | The tenant account and the users of the client portal (`Account`, `CustomerUser`, `ProjectMember`, …)   |
| `admin-user`    | The operators of the Admin portal (`AdminUser`, `AdminSession`, `AdminLoginAttempt`, …)                 |
| `third-party`   | People who use neither portal (`CrmContact`, `Mention`, `SocialMessage`, `LinkClick`, `DsarRequest`, …) |
| `organisation`  | An organisation that may be a natural person                                                            |

## 5. Categories of personal data

**Status:** `generated` — [personal-data inventory](inventories/personal-data.generated.md)

The generator reads `infra/prisma/schema.prisma`, takes every field whose name may hold personal data, and joins it with [`classification/personal-data.json`](classification/personal-data.json). Each field is classified `personal`, `not-personal` or `pending`, and a `personal` field also carries a category and a subject (section 4). The current figures are the page's Summary table.

The category vocabulary, in the generator's order: `identifier`, `contact`, `credential`, `technical`, `content`, `financial`, `behavioural`, `special`. The page's Category column assigns each `personal` field one of them.

The `pending` rows are listed on the page with Status `pending`, each with a note saying why it may or may not concern a natural person. Resolving them is a decision (owner: Edward). The classification's `pendingBaseline` holds their count: it cannot rise, and a fall lowers the baseline in the same change.

## 6. Recipients and subprocessors

**Status:** `generated` — [subprocessors inventory](inventories/subprocessors.generated.md)

The generator reads the root `package.json` and every `package.json` under `apps/`, `packages/` and `infra/`, skipping `node_modules`, `dist` and `.next`, and takes each direct dependency named in a `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies` block that is not a workspace package; a `catalog:` specifier still names its package. It joins each name with [`classification/subprocessors.json`](classification/subprocessors.json), keyed by the package name as declared, scoped names included, and marks it production or dev-only from the blocks and manifests that declare it. Versions are not read and the lockfile is not parsed: a recipient is what a manifest declares, so the lockfile source the plan named was dropped.

Each name is classified `service` (it talks to a third-party service that may receive personal data, or ships the product's telemetry to one), `library` (no third-party endpoint of its own) or `pending`. A service row states the vendor, the purpose, what turns it on (an environment variable, an Admin credential or an account's configuration), the data it sends and its production path (`yes`, `no` or `build-time only`). A service the code reaches by `fetch`, which no dependency traces, is added with `"manual": true`, such as the Resend email API. The page leads with the services, then lists the social providers of the `Provider` enum that no service dependency reaches, whose OAuth permissions are in section 11, then the `pending` rows. The current figures are the page's Summary table.

The classification's `pendingBaseline` holds the count of `pending` rows: it cannot rise, and a fall lowers the baseline in the same change.

## 7. Transfers to third countries

**Status:** `pending decision (owner: Edward)`

Decision: which transfers outside the EEA exist and the safeguard each relies on; it reads the recipient list of section 6.

## 8. Retention and erasure

**Status:** `linked`

| Source                                                                                               | What it settles                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [Retention calendar](../compliance/RETENTION_CALENDAR.md)                                            | The retention window per data type, the `GdprSettings` field that drives it and the job that enforces it.                                      |
| [`DataRetentionService.ts`](../../packages/core/compliance/src/DataRetentionService.ts)              | The daily sweep: deletes audit logs past `auditLogRetentionDays` and expires overdue DSAR requests, only while `enableAutoDataDeletion` is on. |
| [`DeletionRecordDegrader.ts`](../../apps/api/src/infrastructure/retention/DeletionRecordDegrader.ts) | The daily sweep that replaces a tombstone's plaintext name with a keyed digest once its retention window closes.                               |

Soft-deletable models carry a `deletedAt` mark, and a hard delete of an account or a project writes a `DeletionRecord` tombstone in the same transaction, which keeps the deleted name in plaintext until `retainUntil` and is then reduced to its keyed digest by `DeletionRecordDegrader`.

Pending within this section: the retention period per data class (owner: Edward). The calendar records the windows the code applies today.

## 9. Technical and organisational security measures

**Status:** `linked`

| Source                                                                  | What it settles                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [ADR-0034: Credential model](../technical/ADR-0034-credential-model.md) | Where each credential lives, the one encryption seam, key custody, hashed verifiers and rotation; its `## Legal impact` section states the art. 32 and breach-notification position. |
| [Security canon](../security/SECURITY_CANON.md)                         | Secrets read only through validated env modules with no fallbacks, client-IP derivation behind proxies, and the dependency CVE floors.                                               |
| [Multi-tenant guards](../security/MULTI_TENANT_GUARDS.md)               | Tenant isolation in three layers (the Prisma tenant guard, PostgreSQL row-level security, the raw-query fitness check) and the global tables outside it.                             |

## 10. Cookies and browser storage

**Status:** `generated` — [cookies and browser storage inventory](inventories/cookies-and-storage.generated.md)

The generator scans the source of the API, both portals and `packages/ui` for every cookie and every `localStorage` / `sessionStorage` key, and joins each name with [`classification/cookies-and-storage.json`](classification/cookies-and-storage.json) as `<app>:<kind>:<name>`. Each row is classified `essential`, `functional`, `analytics`, `marketing` or `pending`, with the lifetime the code gives it. A cookie a dependency sets, which no call site names, is a manual addition, such as the `NEXT_LOCALE` cookie that next-intl sets in each portal. The current figures are the page's Summary table.

Each lifetime is stated as the code sets it, not as its comment says. Reading them that way surfaced two defects, tracked in the [Master Plan](../product/MASTER_PLAN_ES.md) as **DEF-52** (the lifetime of the API's `refreshToken` cookie) and **DEF-53** (the lifetime of `admin-session` when the Admin backend proxy renews it).

Pending within this section: whether any of these needs consent, under the consent policy of section 12 (owner: Edward).

## 11. OAuth permissions per provider

**Status:** `generated` — [OAuth scopes inventory](inventories/oauth-scopes.generated.md)

The generator reads four sources: the scopes each connect flow requests in `apps/api/src/auth/providerOAuthConfigs.ts` (`login`), each provider adapter's `requiredScopes` (`adapter`), the `requiredScopes` of `PROVIDER_CONFIGS` in `packages/shared/src/providers/providerConfig.ts`, which the product shows the user (`shared`), and the scope literal of the HubSpot and Salesforce authorize routes in `apps/api/src/crm/crmRoutes.ts` (`crm`). It joins each scope with [`classification/oauth-scopes.json`](classification/oauth-scopes.json) as `<provider>:<scope>`, spelled as its source writes it; the providers are the `Provider` enum of `infra/prisma/schema.prisma` and the two CRMs. Each entry lists in `sources` the sources that declare the scope, and `pnpm check:legal` fails when that list differs from the scan, so a new mismatch, or one that heals, is acknowledged in the classification. A mismatch is a provider's scope that one of `login`, `adapter` and `shared` does not declare.

Each row is classified `required` (a shipped feature needs it), `optional` (a gated or partial feature asks for it), `unused` (declared or requested, but no code path uses it) or `pending`, and its Grants column states, in the provider's terms, what the scope lets the product read or do. The page leads with its Mismatches section and lists the declarations it does not scan, each with the reason. The current figures are the page's Summary table.

The mismatches the page lists are tracked as defects in the [Master Plan](../product/MASTER_PLAN_ES.md) once recorded.

## 12. Consent and acceptance evidence

**Status:** `pending decision (owner: Edward)`

Decision: LEGAL-5 — how acceptance of the terms, the privacy notice and the DPA is recorded per version, and whether `ConsentRecord` stays for purposes whose basis is consent or is removed. It waits for the purposes of section 2.

Fact: the `ConsentRecord` model exists in `infra/prisma/schema.prisma` (user, account, consent type and version, acceptance time, IP address, user agent, withdrawal). No application code reads or writes it; its only code reference is its entry in `TENANT_SCOPED_MODELS` (`infra/prisma/src/extensions/tenantGuard.ts`), and the migration `20260527000000_add_rls_tenant_isolation` names it.

## 13. Commercial and billing rules

**Status:** `linked`

| ADR                                                                                | Title                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [ADR-0024](../technical/ADR-0024-billing-currency-and-price-catalog.md)            | Billing currency — USD accounting, fixed per-currency price lists, FX for reporting only    |
| [ADR-0025](../technical/ADR-0025-payment-gateway-selection-and-country-routing.md) | Payment gateways — configured in Admin, routed by billing country                           |
| [ADR-0026](../technical/ADR-0026-non-payment-lifecycle.md)                         | Non-payment lifecycle — OmniPost owns the cut-off, one billing-access state machine         |
| [ADR-0027](../technical/ADR-0027-consumer-sales-and-tax-handling.md)               | Consumer sales and tax handling — consumers allowed, Paddle for Europe, evidence on Stripe  |
| [ADR-0028](../technical/ADR-0028-storage-configuration-and-media-access.md)        | Media storage — configured once in Admin, private buckets, signed reads, degraded on outage |
| [ADR-0029](../technical/ADR-0029-media-upload-limits.md)                           | Media upload limits — global caps, the strictest target network, verified after upload      |
| [ADR-0030](../technical/ADR-0030-pricing-model.md)                                 | Pricing model — per connected channel, per workspace, prepaid terms without exit fees       |
