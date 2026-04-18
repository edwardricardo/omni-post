# OmniPost — D0: Inventario Maestro Inmutable (v2)

> **Living document.** Update in place.
> **Last verified:** 2026-04-18 (re-execution with §5.7 methodology)
> **Supersedes:** previous D0_INVENTORY.md contaminated by grep truncation (see PRE-3A/3C findings). Backup at `.D0_INVENTORY.contaminated.bak`.
> **Method:** Direct code extraction with `head_limit: 0` + count cross-check per PLAN_MAESTRO §5.7.
> **Scope:** Toda entidad del monorepo extraíble + clasificación de consumo para endpoints/hooks.

Esta es la fuente de verdad de "qué existe" y "qué está consumido" en OmniPost. Reemplaza versiones previas que tenían falsos negativos por truncación silenciosa. Consume D1-D7.

---

## 1. Endpoints

**Total backend endpoints:** 471 across 73 route/integration files.

Clasificación completa + evidencia por archivo vive en `ENDPOINT_AUDIT.md` v2. Este inventario no duplica esa matriz.

**Resumen agregado (de `ENDPOINT_AUDIT.md` §1):**

| Class                                                        |                                                 Count |
| ------------------------------------------------------------ | ----------------------------------------------------: |
| CONSUMED                                                     |                                                  ~340 |
| ORPHAN                                                       |                                                  ~100 |
| PATH_MISMATCH                                                |                                                     8 |
| AMBIGUOUS                                                    |                                                   ~23 |
| Categorías especiales (WEBHOOK, HEALTH, INTERNAL, DEAD_CODE) | ~23 (billing webhooks 2 + health 5 + saga 7 + cqrs 9) |

**Authoritative extraction command:**

```
grep -rn --include="*.ts" -E "(fastify|app|server|instance)\.(get|post|put|patch|delete|head|options)\(" apps/api/src/
```

Drift vs v1 (also 471): **none** — endpoint count is stable in the 24h since v1.

---

## 2. Database

Schema file: `infra/prisma/schema.prisma`.

### 2.1 Prisma models: 114

Top 10 by field count (full table in v1 backup if needed):

| Fields | Model                 |
| -----: | --------------------- |
|     75 | Account               |
|     46 | PublishingQueue       |
|     36 | SocialMessage         |
|     36 | Project               |
|     35 | AdminUser             |
|     31 | ProviderConnection    |
|     31 | VideoProcessingJob    |
|     28 | InstagramStory        |
|     28 | InstagramStoryProject |
|     28 | WebhookEvent          |

Remaining 104 models range from 4 (`AssetTagOnAsset`) to 26 fields.

### 2.2 Prisma enums: 54

Names: `ABTestStatus, AccountCredentialGroup, AnnouncementType, ApprovalStatus, BillingCycle, CampaignStatus, ConnectionStatus, CredentialGroup, CrmActivityType, CrmPlatform, DpoType, DsarRequestType, DsarStatus, GatewayProvider, InstagramContentType, IntegrationPlatform, InvoiceStatus, JurisdictionType, LogStatus, MediaKind, MessagePriority, NotificationType, OutboundReplyStatus, Provider, PublishingStatus, QueuePriority, ReferralStatus, ReportChartType, ReportFormat, RepurposeStatus, ReviewDecision, SegmentStatus, SocialMessageStatus, SocialMessageType, SsoProvider, StoryProjectStatus, StoryStatus, SubscriptionStatus, SwitchStatus, SyncStatus, TaskPriority, TaskStatus, TeamRole, TemplateCollaboratorRole, TemplateComponentType, TemplatePermission, TemplateUsageAction, ThreadStrategy, TrendUrgency, TweetStatus, VersionChangeType, VideoProcessingStatus, WebhookEventType, WebhookProcessingStatus`.

Values not enumerated (per rule "no volcar archivos gigantes"). D3 extracts when auditing enum sync between DB and frontend.

### 2.3 Migrations: 5

- `00000000000000_baseline`
- `20260414014352_add_ai_token_usage`
- `20260415000000_add_invoice_dunning`
- `20260415033511_add_account_onboarding`
- `20260415040000_ux_polish_avatar_invite_announcements`

### 2.4 Seeds: 1

**File:** `infra/prisma/seed.ts` (post-PRE-3B, ~544 lines).

**Tables seeded:**

- `AIPromptTemplate` (system prompt templates)
- `Role` + `RolePermission` (3 system roles: SUPER_ADMIN, ADMIN, SUPPORT with updated permission arrays including `dashboard:view` + `post:manage`)
- `AdminUser` (1: `admin@omnipost.local` with `roleId: "role-super-admin"`)
- `ProviderPricingTier` (3 tiers: 1-3, 4-7, 8+)
- `AccountPricingTier` (3 tiers: 1, 2-5, 6+ accounts)
- `ProviderBundle` (3 bundles: Starter, Growth, Agency Full)

**Validation checkpoint 3 (§5.7 grep):** `grep -nE '"dashboard:view"|"post:manage"' infra/prisma/seed.ts | wc -l` = **6 hits** (2 perms × 3 roles). PRE-3B persisted correctly. ✅

---

## 3. Auth & RBAC

### 3.1 Permission enum: 17 values

Source: [apps/api/src/auth/rbacService.ts:20-57](apps/api/src/auth/rbacService.ts#L20-L57).

| Key               | Value               | Category  |
| ----------------- | ------------------- | --------- |
| USER_READ         | `user:read`         | User Mgmt |
| USER_MANAGE       | `user:manage`       | User Mgmt |
| USER_MANAGE_ROLES | `user:manage_roles` | User Mgmt |
| DASHBOARD_VIEW    | `dashboard:view`    | Dashboard |
| ACCOUNT_READ      | `account:read`      | Account   |
| ACCOUNT_MANAGE    | `account:manage`    | Account   |
| BILLING_READ      | `billing:read`      | Billing   |
| BILLING_MANAGE    | `billing:manage`    | Billing   |
| POST_MANAGE       | `post:manage`       | Posts     |
| PRICING_MANAGE    | `pricing:manage`    | Pricing   |
| ANALYTICS_READ    | `analytics:read`    | Analytics |
| ANALYTICS_EXPORT  | `analytics:export`  | Analytics |
| SYSTEM_CONFIGURE  | `system:configure`  | System    |
| SYSTEM_MONITOR    | `system:monitor`    | System    |
| AUDIT_READ        | `audit:read`        | Audit     |
| AUDIT_EXPORT      | `audit:export`      | Audit     |
| WEBHOOK_MANAGE    | `webhook:manage`    | Webhooks  |

### 3.2 System roles: 3

Source: [infra/prisma/seed.ts:332-397](infra/prisma/seed.ts#L332-L397) (post-PRE-3B).

| Role        | Level |                                                                                                                   Permissions (post-PRE-3B) |
| ----------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------: |
| SUPER_ADMIN |   100 |                                                                                                       17 (all, via seed + runtime override) |
| ADMIN       |    50 |                                                                                 13 (including DASHBOARD_VIEW + POST_MANAGE added by PRE-3B) |
| SUPPORT     |    10 | 7 (including DASHBOARD_VIEW + POST_MANAGE added by PRE-3B; still open whether semantically correct for SUPPORT — see `LATERAL_FINDINGS.md`) |

### 3.3 Runtime override

[apps/api/src/auth/rbacService.ts:110](apps/api/src/auth/rbacService.ts#L110):

```typescript
if (roleName === "SUPER_ADMIN") return Object.values(Permission);
```

SUPER_ADMIN always receives the full enum at runtime, bypassing DB state. Defensive against seed/DB drift.

### 3.4 Auth middlewares: 8

- `requireAdminAuth` ([adminAuthMiddleware.ts:55](apps/api/src/admin/auth/adminAuthMiddleware.ts#L55))
- `requireSuperAdmin` ([adminAuthMiddleware.ts:182](apps/api/src/admin/auth/adminAuthMiddleware.ts#L182))
- `requireAdmin` ([adminAuthMiddleware.ts:189](apps/api/src/admin/auth/adminAuthMiddleware.ts#L189))
- `requireClientAuth` ([customerAuthMiddleware.ts:36](apps/api/src/auth/customerAuthMiddleware.ts#L36))
- `requirePermission(...perms)` ([rbacMiddleware.ts:36](apps/api/src/auth/rbacMiddleware.ts#L36))
- `requireAllPermissions(...perms)` ([rbacMiddleware.ts:69](apps/api/src/auth/rbacMiddleware.ts#L69))
- `requireOwnershipOrPermission(...)` ([rbacMiddleware.ts:108](apps/api/src/auth/rbacMiddleware.ts#L108))
- `requireContextPermission(...)` ([rbacMiddleware.ts:156](apps/api/src/auth/rbacMiddleware.ts#L156))

Non-auth infra middlewares: `auditMiddleware`, `integrationAuthMiddleware`, `autoCacheMiddleware`, `correlationMiddleware`, `metricsMiddleware`, `csrfMiddleware`, `ipAllowlistMiddleware`.

---

## 4. Frontend

### 4.1 Folder structure

**apps/admin/**: `app/`, `components/`, `hooks/`, `i18n/`, `lib/`, `messages/`, `providers/`, `reports/`, `scripts/`, `stories/`, `tests/`, `types/`.

**apps/client/**: `app/`, `components/`, `coverage/`, `hooks/`, `lib/`, `providers/`, `public/`, `reports/`, `stories/`, `storybook-static/`, `tests/`, `types/`.

### 4.2 Hooks

**apps/admin:** 30 hook files, all under `hooks/api/` (plus `hooks/useChartColors.ts`).

**apps/client:** 44 hook files across 3 folders:

- `hooks/api/` (31 files) — new standard, proxied
- `hooks/` (3 files, non-HTTP) — `useAIContentGenerator`, `useFocusTrap`, `useNotificationStream`
- `lib/hooks/` (5 files) — legacy, uses `/api/*` generic rewrite. 3 of these (`useABTests`, `useTemplates`, `useTemplateVersions`) **confirmed CONSUMED by `TemplateManagementDashboard.tsx` — validation case 1 ✅**
- `lib/api/hooks.ts` (1 file, 9 hooks) — post/project hooks
- `components/{ai,instagram}/hooks/` (4 files) — component-local hooks

See `CLIENT_LIB_HOOKS_AUDIT.md` for detailed consumer analysis.

### 4.3 Components

- apps/admin total `.tsx`: **86** (14 component folders)
- apps/client total `.tsx`: **225** (22 component folders)

Top folders by count:

- `apps/client/components/ai/`: 25
- `apps/client/components/content/`: 21
- `apps/client/components/templates/`: 21
- `apps/client/components/scheduling/`: 16
- `apps/client/components/analytics/`: 10
- `apps/admin/components/settings/`: 11
- `apps/admin/components/ui/`: 10

### 4.4 Next.js pages / routes

- **apps/admin:** 25 files (`page.tsx`, `layout.tsx`, `route.ts`).
- **apps/client:** 48 files.

See v1 backup for full list — D0-v2 doesn't re-enumerate since structure unchanged from v1.

### 4.5 API clients

- `apps/admin/lib/apiClient.ts` (admin central client, ~460 lines, consumed by many admin hooks)
- `apps/client/lib/api/client.ts` (client central client)
- `apps/client/lib/auth/authApi.ts` (client-side auth helper)
- `apps/admin/lib/auth/backend-client.ts` (admin-side auth backend wrapper)

### 4.6 Validation checkpoint 1 ✅

Direct grep:

```
grep -n "useTemplates|useABTests|useTemplateVersions" apps/client/app/dashboard/templates/TemplateManagementDashboard.tsx
```

Returns:

- Line 16: `import { useTemplates } from "@/lib/hooks/useTemplates";`
- Line 17: `import { useABTests } from "@/lib/hooks/useABTests";`
- Line 19: `import { useTemplateVersions } from "@/lib/hooks/useTemplateVersions";`
- Line 59: `} = useTemplates(projectId);`
- Line 69: `} = useABTests(projectId);`
- Line 77: `} = useTemplateVersions(selectedTemplate?.id, projectId);`

All 3 imports + all 3 invocations detected. Methodology works.

---

## 5. Shared code

### 5.1 Packages: 9 top-level, 36 total

| Top-level                 | pnpm name              | Nested                                                                                                                                                                                                       |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/adapters/`      | —                      | 13 (cache-redis, crm-hubspot, crm-salesforce, db-prisma, dead-letter-queue, external-apis, fallback-strategies, queue-bullmq, storage-azure, storage-cloudinary, storage-do-spaces, storage-gcs, storage-s3) |
| `packages/api-common/`    | `@packages/api-common` | —                                                                                                                                                                                                            |
| `packages/core/`          | `@core/engine`         | threading                                                                                                                                                                                                    |
| `packages/monitoring/`    | —                      | circuit-breaker, health-checks                                                                                                                                                                               |
| `packages/observability/` | —                      | logger, opentelemetry                                                                                                                                                                                        |
| `packages/ports/`         | `@ports/core`          | —                                                                                                                                                                                                            |
| `packages/providers/`     | —                      | bluesky, facebook, instagram, linkedin, pinterest, shared, snapchat, telegram, \_template, threads, tiktok, x, youtube (13, 12 real + shared + \_template)                                                   |
| `packages/shared/`        | `@shared/types`        | —                                                                                                                                                                                                            |
| `packages/ui/`            | `@packages/ui`         | —                                                                                                                                                                                                            |

### 5.2 Types files

Locations: `apps/admin/lib/auth/types.ts`, `apps/api/src/{ai,analytics/*, application/*, billing/subscription, infrastructure/container, orchestration/sync}/types.ts`, plus `packages/shared/src/` (cross-app types).

### 5.3 Validation schemas

Zod-based. Schemas co-located with routes (e.g., `templateSchemas.ts`, `auditSchemas.ts`). Not individually enumerated — D3 extracts when cross-checking validation vs Prisma models.

---

## 6. Configuration

### 6.1 Config files (27)

Root: `tsconfig.base.json`, `tsconfig.json`, `turbo.json`, `pnpm-workspace.yaml`, `eslint.config.cjs`, `stryker.config.mjs`.

Per-app (admin/api/client/workers): `tsconfig.json`, `vitest.config.ts`, `stryker.config.mjs`, plus `next.config.mjs` for admin/client.

Per-package (api-common/core): same pattern. Pure-type packages (ports, shared, ui) only have `tsconfig.json`.

### 6.2 Environment variables (3 templates)

| File                            | Var count |
| ------------------------------- | --------: |
| `/.env.example`                 |        10 |
| `apps/api/.env.example`         |        52 |
| `apps/admin/.env.local.example` |         3 |

**Total unique declared:** 65 (pre-dedup).

### 6.3 Root `package.json` scripts

31 scripts including test/lint/format/typecheck/build, per-app dev commands, db:up/migrate/seed/studio, and 10 perf:\* scripts for k6 load tests. Per-app scripts not enumerated — D6 extracts on demand.

---

## 7. Tests

### 7.1 Counts

- **Total test files** (`*.test.ts`, `*.test.tsx`, `*.spec.*`, excluding node_modules + .stryker-tmp): **528**
- Integration-named (`*.integration.test.*`): 13
- E2E / Playwright: 4

### 7.2 Distribution

| Location     | Tests |
| ------------ | ----: |
| apps/api     |   400 |
| apps/admin   |    18 |
| apps/client  |    16 |
| apps/workers |     5 |
| packages/\*  |   118 |

### 7.3 Stryker state

Reports at `apps/api/reports/`:

- `mutation/batch-1.html` (2026-03-15)
- `mutation/batch-2.html` (2026-03-16)
- `stryker-incremental.json` (2026-03-24)

---

## 8. External integrations

### 8.1 OAuth / SSO

Files under `apps/api/src/auth/`: `providerOAuth.ts` (entrypoint), `providerOAuthFlow.ts`, `providerOAuthConfigs.ts`, `enhancedOAuthProvider.ts` (wrapper), `samlRoutes.ts`, `oidcRoutes.ts`.

### 8.2 Webhooks entrantes

- **Billing:** `billingWebhookRoutes.ts` — Stripe + Paddle (2 endpoints)
- **Social (8 processors):** facebook, instagram, linkedin, snapchat, telegram, tiktok, x, youtube
- Abstract base: `AbstractWebhookProcessor.ts`

### 8.3 APIs externas

| Service                                    | Location                                                      |
| ------------------------------------------ | ------------------------------------------------------------- |
| Anthropic                                  | `apps/api/src/ai/providers/anthropic.ts`                      |
| OpenAI                                     | `apps/api/src/ai/providers/openai.ts`                         |
| Stripe                                     | `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts` |
| Resend                                     | `apps/api/src/infrastructure/adapters/ResendEmailAdapter.ts`  |
| Sentry                                     | `apps/api/src/observability/sentryInit.ts`                    |
| Cloudinary, Azure Blob, DO Spaces, GCS, S3 | `packages/adapters/storage-*/`                                |
| HubSpot, Salesforce                        | `packages/adapters/crm-*/`                                    |

### 8.4 Social channels

12 platform providers in `packages/providers/`: bluesky, facebook, instagram, linkedin, pinterest, snapchat, telegram, threads, tiktok, x, youtube + shared utilities + `_template` skeleton.

---

## 9. Validación metodológica

D0-v2 explicitly re-tests the methodology via 4 independent validation cases from PRE-3A/B/C. All 4 detected ✅.

### 9.1 Case 1 — TemplateManagementDashboard consumes 3 hooks

**Detection method:** direct grep of hook names across `apps/client`, no head_limit. See §4.6 above and `ENDPOINT_AUDIT.md §2.69`.

**Result:** 6 hits (3 imports + 3 invocations) all matching PRE-3A evidence.

### 9.2 Case 2 — FALSE_NEGATIVE pattern independently reproduced

D0-v2 independently re-derived consumer data via bulk fetch() grep across admin+client. Classification per file in `ENDPOINT_AUDIT.md §2` confirms:

| Archivo                     | Expected (PRE-3C)     | D0-v2 detected                                                            |
| --------------------------- | --------------------- | ------------------------------------------------------------------------- |
| `accountLifecycleRoutes.ts` | 10 CONSUMED, 6 ORPHAN | ✅ (§2.2)                                                                 |
| `outboxAdminRoutes.ts`      | 3/3 CONSUMED          | ✅ (§2.56)                                                                |
| `adminUserRoutes.ts`        | 5+ CONSUMED           | ✅ (§2.3, 6 CONSUMED — one more found because PUT/:id was verified fresh) |
| `auditRoutes.ts`            | 2 CONSUMED, 6 ORPHAN  | ✅ (§2.20)                                                                |

### 9.3 Case 3 — 8 SAML/OIDC PATH_MISMATCH

**Detection method:** for each `/api/backend/saml/*` or `/api/backend/oidc/*` consumer hit, compute effective Fastify URL after `/api/backend/` strip, compare to backend route registration. Mismatch → PATH_MISMATCH.

**Result:** 8 endpoints flagged in `ENDPOINT_AUDIT.md §4`. Matches PRE-3C §10.5 exactly. ✅

### 9.4 Case 4 — Seed post-PRE-3B state

**Detection command:** `grep -nE '"dashboard:view"|"post:manage"' infra/prisma/seed.ts | wc -l` → **6 hits** (2 perms × 3 roles). PRE-3B correctly persisted. ✅

### 9.5 Methodology self-check PASSED

All 4 cases detected without manual prompting. §5.7 method is working as intended. D1 arranca con baseline limpia.
