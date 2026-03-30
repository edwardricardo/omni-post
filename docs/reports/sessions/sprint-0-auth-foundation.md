# Sprint 0 Report — Auth Foundation

Date: 2026-03-29

## Batches Summary

| Batch | Feature                     | Status | Tests Added |
| ----- | --------------------------- | ------ | ----------- |
| 1     | Account model completion    | ✅     | 42          |
| 2     | CustomerUser authentication | ✅     | 46          |

## Batch 1 — Account Completion

### Fields added to Account

| Field             | Type            | Default | Purpose               |
| ----------------- | --------------- | ------- | --------------------- |
| slug              | String? @unique | —       | Tenant URL identifier |
| timezone          | String          | UTC     | Scheduling context    |
| locale            | String          | en      | UI language           |
| phone             | String?         | —       | Owner contact         |
| maxTeamMembers    | Int             | 5       | Tier limit            |
| maxStorageBytes   | BigInt          | 5GB     | Tier limit            |
| maxRecurringPosts | Int             | 5       | Tier limit            |

Migration: complete_account_tenant_model

### TIER_LIMITS updated

| Limit                 | BASIC | PRO  | ENTERPRISE |
| --------------------- | ----- | ---- | ---------- |
| maxProjects           | 3     | 10   | Unlimited  |
| maxChannelsPerProject | 3     | 10   | Unlimited  |
| maxPostsPerDay        | 10    | 100  | Unlimited  |
| maxTeamMembers        | 5     | 15   | Unlimited  |
| maxStorageBytes       | 5GB   | 50GB | Unlimited  |
| maxRecurringPosts     | 5     | 20   | Unlimited  |

New domain methods: setSlug(), canAddTeamMember(), canAddStorage(), canAddRecurringPost()
Tests: 42

## Batch 2 — CustomerUser Auth

New Prisma model: CustomerUser
Migration: add_customer_user

### Auth architecture (BEFORE vs AFTER)

| Aspect                                  | Before (broken)         | After (correct)                                |
| --------------------------------------- | ----------------------- | ---------------------------------------------- |
| Customer login                          | Against AdminUser table | Against CustomerUser table                     |
| accountId in token                      | NO                      | YES — always present                           |
| Token type discriminator                | None                    | `type: "customer"` vs admin tokens             |
| JWT secret                              | Shared with admin       | Separate: CUSTOMER_JWT_SECRET                  |
| Cookie name                             | admin-session (shared)  | customer-session (separate)                    |
| Session isolation                       | None                    | Complete — different tables, different secrets |
| Can admin token access customer routes? | Yes (security hole)     | No — middleware rejects non-customer tokens    |

### Use cases created

| Use Case                    | Type    | UoW                                |
| --------------------------- | ------- | ---------------------------------- |
| RegisterCustomerUseCase     | Command | ✅ (atomic Account + CustomerUser) |
| LoginCustomerUseCase        | Command | —                                  |
| RefreshCustomerTokenUseCase | Command | —                                  |
| LogoutCustomerUseCase       | Command | —                                  |
| RequestPasswordResetUseCase | Command | ✅                                 |
| ResetPasswordUseCase        | Command | ✅                                 |

### Routes created

| Method | Path                                  | Auth         | Purpose                    |
| ------ | ------------------------------------- | ------------ | -------------------------- |
| POST   | /auth/customer/register               | Public       | Self-service signup        |
| POST   | /auth/customer/login                  | Public       | Customer login             |
| POST   | /auth/customer/logout                 | customerAuth | Logout                     |
| POST   | /auth/customer/refresh                | Public       | Token refresh              |
| POST   | /auth/customer/request-password-reset | Public       | Request reset email        |
| POST   | /auth/customer/reset-password         | Public       | Reset with token           |
| GET    | /auth/customer/me                     | customerAuth | Get current user + account |

### Decision made

Registration flow: **Option A (login inmediato)** — user registers and gets JWT immediately. Email verification fields exist in schema but are not enforced. Can be activated later.

Tests: 46 (24 entity + 22 use cases + middleware)

## Totals

| Metric         | Before | After | Delta             |
| -------------- | ------ | ----- | ----------------- |
| Tests passing  | 6,907  | 6,995 | +88               |
| Test files     | 327    | 330   | +3                |
| Prisma models  | 85     | 86    | +1 (CustomerUser) |
| Account fields | 18     | 25    | +7                |

## Build and Test

| Check                   | Result                           |
| ----------------------- | -------------------------------- |
| TypeScript build        | 0 errors, 9/9 tasks              |
| All tests               | 330 files, 6995 passed, 0 failed |
| ESLint                  | 0 errors, 0 warnings             |
| Admin auth unchanged    | ✅ (97 requireAdmin usages)      |
| Architecture boundaries | Clean                            |

## Next Step: Sprint 0C — App Separation

With correct auth in place:

- apps/client uses CustomerUser auth (customer-session cookie)
- apps/admin uses AdminUser auth (admin-session cookie)
- Ready to migrate 26 pages + 13 component groups from admin → client
