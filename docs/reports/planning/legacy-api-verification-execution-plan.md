# Legacy API Verification -- Complete Execution Plan

> Generated: 2026-04-03
> Scope: All 5 deferred items from the previous audit
> Principle: "@deprecated is NOT a fix. Documented in backlog is NOT a fix."

---

## Verified Baseline (no action needed)

| Item                          | Status                                                |
| ----------------------------- | ----------------------------------------------------- |
| EventStore `$queryRaw` safety | FIXED -- 17 `Prisma.sql` instances, 0 unsafe patterns |
| Billing DI                    | 3 use cases registered with Prisma adapters           |
| DashboardService plan field   | Returns plan from AccountSubscription                 |
| Test suite                    | 351 files, 7146 passing                               |

---

## Execution Order (dependency-safe)

| Step | Item                                                       | Risk   | Est. files changed              |
| ---- | ---------------------------------------------------------- | ------ | ------------------------------- |
| 1    | D3: EventStore N+1 batch insert                            | Low    | 1 + 1 test                      |
| 2    | D5: Password reset email                                   | Low    | 2 + 1 test + 1 DI               |
| 3    | D4: Register 10 orphan use cases                           | Medium | ~25 new + 3 DI                  |
| 4    | D2: RegisterCustomerUseCase arch fix                       | Medium | 3 + 1 test + 1 DI               |
| 5    | D1: Remove 47 Account.subscription refs + schema migration | High   | 11+ source + schema + migration |

Each step ends with `pnpm build && pnpm test` checkpoint.

---

## D3: EventStore N+1 Batch Insert

### Problem

`apps/api/src/events/EventStore.ts` lines 101-111: a `for` loop issues one `$executeRaw` INSERT per event. With N events this produces N round-trips inside a single transaction.

### Solution

Replace the loop with a single raw SQL INSERT using multiple VALUES tuples.

### File: `apps/api/src/events/EventStore.ts`

**Current** (lines 101-111):

```typescript
for (const evt of eventsToInsert) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO ${this.tableRef} (...) VALUES (...)`);
}
```

**Target:**

```typescript
// Build a single INSERT with N value tuples using Prisma.join
const valueSets = eventsToInsert.map(
  (evt) =>
    Prisma.sql`(${evt.id}, ${evt.stream_id}, ${evt.event_type}, ${evt.event_data},
    ${evt.metadata}, ${evt.version}, ${evt.sequence}, ${evt.timestamp},
    ${evt.correlation_id}, ${evt.causation_id})`
);

await tx.$executeRaw(
  Prisma.sql`INSERT INTO ${this.tableRef} (
    id, stream_id, event_type, event_data, metadata,
    version, sequence, timestamp, correlation_id, causation_id
  ) VALUES ${Prisma.join(valueSets)}`
);
```

### Key detail

`Prisma.join(arr)` produces comma-separated SQL fragments -- safe against injection. Each `Prisma.sql` template literal is a parameterized fragment, so all values are bound parameters.

### Test

Existing tests in the EventStore test file should continue to pass. Add a specific test that appends 5+ events in one call and asserts a single INSERT was issued (mock `$executeRaw` and assert call count === 1 for the INSERT, excluding the version/sequence SELECTs).

### Files to modify

- `apps/api/src/events/EventStore.ts` (lines 101-111)
- Corresponding test file (add batch insert assertion)

---

## D5: Password Reset Email

### Problem

`apps/api/src/application/customer-auth/RequestPasswordResetUseCase.ts` line 60: `// TODO: Send email with reset link via EmailPort`. The use case generates a token but never sends the email.

### Solution

1. Add `EmailPort` as a constructor dependency (optional, after `unitOfWork`)
2. After persisting the reset token, call `emailPort.send()` with the reset link
3. Update DI registration to inject the EmailPort

### File: `apps/api/src/application/customer-auth/RequestPasswordResetUseCase.ts`

**Changes:**

1. Add import: `import type { EmailPort } from "../../domain/repositories/EmailPort.js";`
2. Update constructor:

   ```typescript
   constructor(
     private readonly customerUserRepo: CustomerUserRepository,
     private readonly unitOfWork?: UnitOfWork,
     private readonly emailPort?: EmailPort  // NEW -- after UoW per convention
   ) {}
   ```

   Note: UoW is conventionally last-optional. Since EmailPort is also optional (for test compat), place it after UoW. Alternatively, make EmailPort the second param and UoW the last. Check the project convention -- CLAUDE.md says UoW is "LAST param, optional for tests". So EmailPort should come before UoW:

   ```typescript
   constructor(
     private readonly customerUserRepo: CustomerUserRepository,
     private readonly emailPort?: EmailPort,
     private readonly unitOfWork?: UnitOfWork
   ) {}
   ```

3. Replace TODO on line 60 with:

   ```typescript
   // Send reset email (outside transaction -- email is not rollback-safe)
   if (this.emailPort) {
     const clientUrl = process.env.CLIENT_URL ?? "http://localhost:3002";
     const resetLink = `${clientUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(input.email)}`;
     await this.emailPort.send({
       to: [input.email],
       subject: "Reset your password",
       body: `Click the following link to reset your password: ${resetLink}\n\nThis link expires in 1 hour.`,
       html: `<p>Click <a href="${resetLink}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p>`,
     });
   }
   ```

   IMPORTANT: The email send must be OUTSIDE the `doWork` / `executeInTransaction` block. Per CLAUDE.md: "Never put external API calls (provider APIs, email, etc.) inside the transaction -- only DB writes." Move the email send after the transaction succeeds but before the final return.

4. Restructure execute() flow:
   - `doWork` persists the token (DB write, inside transaction)
   - After transaction completes successfully, send email (outside transaction)
   - Return the ok message regardless of email outcome (anti-enumeration)

### File: `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts`

**Change the RequestPasswordResetUseCase registration** (lines 76-84):

```typescript
container.register<RequestPasswordResetUseCase>(
  TOKENS.RequestPasswordResetUseCase,
  () =>
    new RequestPasswordResetUseCase(
      container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
      container.resolve<EmailPort>(TOKENS.EmailPort), // NEW
      container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
    ),
  true
);
```

`TOKENS.EmailPort` already exists in `types.ts` (line 254). The `ResendEmailAdapter` is already registered in `setupServices.ts` (or should be -- verify). If not registered, add:

```typescript
container.register<EmailPort>(TOKENS.EmailPort, () => new ResendEmailAdapter(), true);
```

### Test

Add unit test: mock EmailPort, call execute with a valid email that exists, assert `emailPort.send` was called with correct `to`, `subject`, and a body containing the reset token.

### Files to modify

- `apps/api/src/application/customer-auth/RequestPasswordResetUseCase.ts`
- `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts`
- Possibly `apps/api/src/infrastructure/container/setupServices.ts` (if EmailPort not yet registered)
- Test file for RequestPasswordResetUseCase

---

## D4: Register 10 Orphan Use Cases in DI

### Problem

10 use cases exist in the application layer with proper port interfaces defined inline, but they are not registered in the DI container and have no Prisma adapter implementations.

### Strategy per use case

1. Add TOKENS in `types.ts` for the use case (and its port adapter if needed)
2. Create a Prisma adapter class implementing the port interface
3. Register in a new or existing `setup*.ts` file
4. Each adapter goes in `apps/api/src/infrastructure/repositories/` (or `adapters/` for non-DB ports)

### 4.1: ApproveRepurposeVariantUseCase

**Port:** `ApproveVariantPort` (defined in the use case file)

**New file:** `apps/api/src/infrastructure/repositories/PrismaApproveVariantAdapter.ts`

```typescript
// Implements ApproveVariantPort using Prisma
// - loadVariant: prisma.repurposeVariant.findUnique({ include: { proposal: true } })
// - setVariantApproved: prisma.repurposeVariant.update({ status: "APPROVED", postId })
// - createDraftPost: prisma.post.create({ status: "DRAFT", ... }) -> returns post.id
```

**Tokens:** `TOKENS.ApproveRepurposeVariantUseCase` (new in types.ts)

**DI setup:** New file `setupRepurposeUseCases.ts` (will hold all 4 repurpose use cases)

### 4.2: RejectRepurposeVariantUseCase

**Port:** `RejectVariantPort` (defined in use case file)

**New file:** `apps/api/src/infrastructure/repositories/PrismaRejectVariantAdapter.ts`

```typescript
// - loadVariant: prisma.repurposeVariant.findUnique({ include: { proposal: true } })
// - setVariantRejected: prisma.repurposeVariant.update({ status: "REJECTED" })
// - allVariantsRejected: prisma.repurposeVariant.count({ where: { proposalId, status: { not: "REJECTED" } } }) === 0
// - setProposalRejected: prisma.repurposeProposal.update({ status: "REJECTED" })
```

**Tokens:** `TOKENS.RejectRepurposeVariantUseCase`

### 4.3: DetectRepurposeCandidatesUseCase

**Ports:** `RepurposeDetectionPort` + `RepurposeJobDispatcher`

**New files:**

- `PrismaRepurposeDetectionAdapter.ts` -- queries analytics + posts for high performers, creates proposals
- `BullMQRepurposeJobDispatcher.ts` -- dispatches a BullMQ job to generate variants (or use QueuePort)

**Tokens:** `TOKENS.DetectRepurposeCandidatesUseCase`

### 4.4: GenerateRepurposeVariantsUseCase

**Ports:** `RepurposeVariantPort` + `NotificationPort` (+ depends on `GeneratePlatformVariantsUseCase` already registered as `TOKENS.GeneratePlatformVariantsUseCase`)

**New file:** `PrismaRepurposeVariantAdapter.ts`

```typescript
// - loadProposal: prisma.repurposeProposal.findUnique()
// - getPostContent: prisma.post.findUnique().content
// - getConnectedPlatforms: prisma.channel.findMany({ where: { projectId, status: "ACTIVE" } }).provider
// - createVariant: prisma.repurposeVariant.create()
```

Notification port: use existing `CreateNotificationUseCase` via TOKENS, or create a thin adapter that delegates.

**Tokens:** `TOKENS.GenerateRepurposeVariantsUseCase`

### 4.5: ConvertReferralUseCase

**Port:** `ConvertReferralRepository`

**New file:** `PrismaConvertReferralRepository.ts`

```typescript
// - findPendingByAccountId: prisma.referral.findFirst({ where: { referredAccountId, status: "PENDING" } })
// - setConverted: prisma.referral.update({ status: "CONVERTED", convertedAt })
// - incrementConversions: prisma.referralCode.update({ conversions: { increment: 1 } })
```

The `grantReward` dependency is `GrantReferralRewardUseCase` -- wire via TOKENS.

**Tokens:** `TOKENS.ConvertReferralUseCase`

**DI setup:** New file `setupReferralUseCases.ts` (will hold all 4 referral use cases)

### 4.6: GrantReferralRewardUseCase

**Port:** `GrantRewardRepository` + optional `EmailPort`

**New file:** `PrismaGrantRewardRepository.ts`

```typescript
// - findReferralById: prisma.referral.findUnique()
// - findReferrerAccountId: prisma.referralCode.findUnique({ where: { id } }).accountId
// - findSubscription: prisma.accountSubscription.findUnique({ where: { accountId } })
// - extendSubscription: prisma.accountSubscription.update({ currentPeriodEnd: newEnd })
// - extendTrial: prisma.accountSubscription.update({ trialEndsAt: newTrialEnd })
// - setRewardGranted: prisma.referral.update({ rewardGranted: true })
```

**Tokens:** `TOKENS.GrantReferralRewardUseCase`

### 4.7: TrackReferralSignupUseCase

**Port:** `ReferralRepository`

**New file:** `PrismaReferralRepository.ts`

```typescript
// - findCodeByCode: prisma.referralCode.findUnique({ where: { code } })
// - createReferral: prisma.referral.create({ referralCodeId, referredEmail, referredAccountId })
// - incrementUsageCount: prisma.referralCode.update({ usageCount: { increment: 1 } })
```

**Tokens:** `TOKENS.TrackReferralSignupUseCase`

### 4.8: GetOrCreateReferralCodeUseCase

**Port:** `ReferralCodeRepository`

**New file:** `PrismaReferralCodeRepository.ts`

```typescript
// - findByAccountId: prisma.referralCode.findUnique({ where: { accountId } })
// - create: prisma.referralCode.create({ accountId, code })
```

**Tokens:** `TOKENS.GetOrCreateReferralCodeUseCase`

### 4.9: TriageInboxMessageUseCase

**Ports:** `TriageMessagePort` + `TriageAIPort` + optional `TriageCrmPort`

**New files:**

- `PrismaTriageMessageAdapter.ts` -- loads SocialMessage, gets conversation context, updates triage fields
- For `TriageAIPort`: reuse existing AIService via a thin adapter wrapping `TOKENS.AIService`
- For `TriageCrmPort`: thin adapter wrapping `PrismaCrmContactRepository`

**Tokens:** `TOKENS.TriageInboxMessageUseCase`

**DI setup:** Add to existing `setupInboxUseCases.ts`

### 4.10: ScoreTrendRelevanceUseCase

**Ports:** `ScoreTrendAIPort` + optional `ScoreTrendContextPort`

**New files:**

- `ScoreTrendAIAdapter.ts` -- delegates to `TOKENS.AIService`
- `PrismaScoreTrendContextAdapter.ts` -- gets brand voice from BrandVoice table, gets performance insights from analytics

**Tokens:** `TOKENS.ScoreTrendRelevanceUseCase`

**DI setup:** New file `setupTrendUseCases.ts`

### Summary: New TOKENS to add to `types.ts`

```typescript
// Repurpose (D4 -- orphan use case registration)
ApproveRepurposeVariantUseCase: Symbol.for("ApproveRepurposeVariantUseCase"),
RejectRepurposeVariantUseCase: Symbol.for("RejectRepurposeVariantUseCase"),
DetectRepurposeCandidatesUseCase: Symbol.for("DetectRepurposeCandidatesUseCase"),
GenerateRepurposeVariantsUseCase: Symbol.for("GenerateRepurposeVariantsUseCase"),

// Referral (D4)
ConvertReferralUseCase: Symbol.for("ConvertReferralUseCase"),
GrantReferralRewardUseCase: Symbol.for("GrantReferralRewardUseCase"),
TrackReferralSignupUseCase: Symbol.for("TrackReferralSignupUseCase"),
GetOrCreateReferralCodeUseCase: Symbol.for("GetOrCreateReferralCodeUseCase"),

// Inbox Triage + Trend Scoring (D4)
TriageInboxMessageUseCase: Symbol.for("TriageInboxMessageUseCase"),
ScoreTrendRelevanceUseCase: Symbol.for("ScoreTrendRelevanceUseCase"),
```

### New DI setup files

1. `setupRepurposeUseCases.ts` -- registers 4 repurpose use cases + adapters
2. `setupReferralUseCases.ts` -- registers 4 referral use cases + adapters
3. `setupTrendUseCases.ts` -- registers ScoreTrendRelevanceUseCase

TriageInboxMessageUseCase added to existing `setupInboxUseCases.ts`.

### Wire into `setupUseCases.ts`

Add imports and calls for the 3 new setup files.

### New Prisma adapter files (in `apps/api/src/infrastructure/repositories/`)

1. `PrismaApproveVariantAdapter.ts`
2. `PrismaRejectVariantAdapter.ts`
3. `PrismaRepurposeDetectionAdapter.ts`
4. `PrismaRepurposeVariantAdapter.ts`
5. `PrismaConvertReferralRepository.ts`
6. `PrismaGrantRewardRepository.ts`
7. `PrismaReferralRepository.ts`
8. `PrismaReferralCodeRepository.ts`
9. `PrismaTriageMessageAdapter.ts`
10. `PrismaScoreTrendContextAdapter.ts`

### New adapter files (in `apps/api/src/infrastructure/adapters/`)

1. `ScoreTrendAIAdapter.ts` (wraps AIService)
2. `TriageAIAdapter.ts` (wraps AIService)
3. `TriageCrmAdapter.ts` (wraps CrmContactRepository)
4. `BullMQRepurposeJobDispatcher.ts` (wraps QueuePort)
5. `RepurposeNotificationAdapter.ts` (wraps CreateNotificationUseCase)

### Tests

Each existing test file for these use cases already uses mocked ports. No changes needed to existing tests. New integration tests for the Prisma adapters are recommended but can follow in a later sprint.

---

## D2: RegisterCustomerUseCase Architecture Fix

### Problem

`apps/api/src/application/customer-auth/RegisterCustomerUseCase.ts` line 16:

```typescript
import { prisma } from "@infra/prisma";
```

This violates hexagonal architecture. The application layer must not import infrastructure directly.

Line 124 uses `prisma.accountSubscription.create()` directly to create the trial subscription.

### Solution

1. Define a port interface for subscription creation
2. Create a Prisma adapter implementing it
3. Inject via constructor; remove the direct prisma import

### Step 1: Port interface

Add to `apps/api/src/domain/repositories/AccountSubscriptionPort.ts` (new file):

```typescript
export interface AccountSubscriptionPort {
  createTrialSubscription(params: {
    accountId: string;
    trialEndsAt: Date;
    maxProjects?: number;
    billingCycle?: string;
  }): Promise<void>;
}
```

### Step 2: Prisma adapter

Add `apps/api/src/infrastructure/repositories/PrismaAccountSubscriptionAdapter.ts`:

```typescript
import type { PrismaClient } from "@infra/prisma";
import type { AccountSubscriptionPort } from "../../domain/repositories/AccountSubscriptionPort.js";

export class PrismaAccountSubscriptionAdapter implements AccountSubscriptionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async createTrialSubscription(params: {
    accountId: string;
    trialEndsAt: Date;
    maxProjects?: number;
    billingCycle?: string;
  }): Promise<void> {
    await this.prisma.accountSubscription.create({
      data: {
        accountId: params.accountId,
        status: "TRIALING",
        pricePerMonth: 0,
        maxProjects: params.maxProjects ?? 3,
        trialEndsAt: params.trialEndsAt,
        billingCycle: (params.billingCycle as "MONTHLY" | "YEARLY") ?? "MONTHLY",
      },
    });
  }
}
```

### Step 3: Update RegisterCustomerUseCase

1. **Remove** line 16: `import { prisma } from "@infra/prisma";`
2. **Add** import: `import type { AccountSubscriptionPort } from "../../domain/repositories/AccountSubscriptionPort.js";`
3. **Update constructor:**
   ```typescript
   constructor(
     private readonly customerUserRepo: CustomerUserRepository,
     private readonly accountRepo: AccountRepositoryPort,
     private readonly subscriptionPort: AccountSubscriptionPort,  // NEW
     private readonly unitOfWork?: UnitOfWork
   ) {}
   ```
4. **Replace** lines 121-133 (direct prisma call) with:
   ```typescript
   const trialEndsAt = new Date();
   trialEndsAt.setDate(trialEndsAt.getDate() + 14);
   await this.subscriptionPort.createTrialSubscription({
     accountId: account.id.toString(),
     trialEndsAt,
   });
   ```

### Step 4: Update DI registration

In `setupCustomerAuthUseCases.ts`, add the new dependency:

```typescript
import { PrismaAccountSubscriptionAdapter } from "../repositories/PrismaAccountSubscriptionAdapter.js";
// ...
container.register<RegisterCustomerUseCase>(
  TOKENS.RegisterCustomerUseCase,
  () =>
    new RegisterCustomerUseCase(
      container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
      container.resolve<AccountRepositoryPort>(TOKENS.AccountRepository),
      new PrismaAccountSubscriptionAdapter(container.resolve(TOKENS.PrismaClient)), // NEW
      container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
    ),
  true
);
```

Optionally register the adapter itself with a token if other use cases need it.

### Test update

Existing tests for RegisterCustomerUseCase mock the repos. Add a mock for `AccountSubscriptionPort` with `createTrialSubscription: vi.fn()` and verify it is called with the correct accountId.

### Files to modify

- `apps/api/src/application/customer-auth/RegisterCustomerUseCase.ts`
- `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts`
- New: `apps/api/src/domain/repositories/AccountSubscriptionPort.ts`
- New: `apps/api/src/infrastructure/repositories/PrismaAccountSubscriptionAdapter.ts`
- Test file for RegisterCustomerUseCase

---

## D1: Remove 47 Account.subscription References + Schema Migration

### Problem

The legacy `Account.subscription` field (enum `SubscriptionTier { BASIC PRO ENTERPRISE }`) is superseded by the `AccountSubscription` model with provider-based pricing. 47 references remain across 11 files, all marked `@deprecated`.

### Strategy

This is a multi-phase removal. Each sub-phase can be committed independently.

### Phase 1: Domain entity cleanup

**File: `apps/api/src/domain/entities/Account.ts`**

1. Remove `SUBSCRIPTION_TIER` const, `SubscriptionTierValue` type, `TIER_LIMITS` const
2. Remove `_subscription` private field and its getter
3. Remove `subscription` from `AccountProps`, `CreateAccountInput`, `toJSON()`, `reconstitute()`
4. For `_maxProjects`, `_maxTeamMembers`, `_maxStorageBytes`, `_maxRecurringPosts` -- these currently default from `TIER_LIMITS[this._subscription]`. Replace with explicit defaults (e.g., the BASIC tier values as hardcoded defaults, since AccountSubscription now owns limits)
5. Keep the getter `get maxProjects()` etc. -- these are still valid, they just no longer derive from subscription tier

**Impact:** Every file importing `SubscriptionTierValue` or `SUBSCRIPTION_TIER` from Account.ts will break. Fix in subsequent phases.

### Phase 2: Prisma schema migration

**File: `infra/prisma/schema.prisma`**

1. Remove `subscription SubscriptionTier @default(BASIC)` from Account model
2. Remove `enum SubscriptionTier { BASIC PRO ENTERPRISE }`
3. Create migration: `pnpm db:up && npx prisma migrate dev --name remove-legacy-subscription-tier`

**Data migration:** The `AccountSubscription` table already exists with per-account records. The migration SQL should be safe since no data needs to be moved (it was already migrated when AccountSubscription was introduced). The column drop is a simple `ALTER TABLE "Account" DROP COLUMN "subscription"`.

### Phase 3: Infrastructure layer (PrismaAccountRepository)

**File: `apps/api/src/infrastructure/repositories/PrismaAccountRepository.ts`**

1. Remove `subscription: row.subscription as SubscriptionTierValue` from `toDomain()` (line 41)
2. Remove `subscription: account.subscription as "BASIC" | "PRO" | "ENTERPRISE"` from save/update methods (lines 112, 131)
3. Update the `toDomain` row type to remove the `subscription` field

### Phase 4: Mapper cleanup

**File: `apps/api/src/mappers/AccountMapper.ts`**

1. Remove `getSubscriptionPlan(account.subscription)` (line 90)
2. Remove `subscription: account.subscription` from response DTOs (lines 100, 123)
3. Line 266: `account.subscription !== "ENTERPRISE"` -- replace with a check against `AccountSubscription.maxProjects` (the account entity still has `maxProjects` as a direct field)

### Phase 5: Billing services

**File: `apps/api/src/billing/subscription/SubscriptionManagementService.ts`** (7 refs)

This service has a dual-mode design supporting both legacy and new models. The entire legacy code path must be removed:

- Remove `changeLegacySubscription` method (line 118+)
- Remove all `account.subscription` reads in filtering/mapping
- Replace `account.subscription` in stats with joins to `AccountSubscription`

**File: `apps/api/src/billing/subscription/TrialManagementService.ts`** (8 refs)

All references use `account.subscription` for tier display/comparison:

- Replace with `accountSubscription.bundle?.name` or a `planName` field
- For tier-based logic, use `AccountSubscription.status` and feature flags

**File: `apps/api/src/billing/subscription/SubscriptionPlanService.ts`** (2 refs)

Remove deprecated `getAccountLimits` method that reads `account.subscription`.

**File: `apps/api/src/infrastructure/billing/StripePaymentAdapter.ts`** (4 refs)

Lines 132-137: These are Stripe webhook event name mappings (`customer.subscription.created`, etc.) -- these reference Stripe's API field names, NOT `Account.subscription`. **These are false positives and should NOT be changed.** The grep matched `.subscription.` in Stripe event names. Verify and skip.

### Phase 6: Route handlers

**File: `apps/api/src/accounts/accountRoutes.ts`** (8 refs)

1. Remove `subscription` from response objects (lines 121, 174, 211, 284)
2. Remove subscription update logic (lines 259-269) -- subscription changes must go through `ChangeAccountSubscriptionUseCase`
3. Remove `SubscriptionTier` type import and `SUBSCRIPTION_DEFAULTS` usage

**File: `apps/api/src/admin/ExecutiveAccountHandlers.ts`** (3 refs)

1. Remove `subscription` from admin update (lines 85-86)
2. Remove `subscription` from response (line 159)

**File: `apps/api/src/admin/ExecutiveComplianceHandlers.ts`** (2 refs)

Remove `subscription: account.subscription` from compliance response objects (lines 211, 220).

### Phase 7: Dashboard service

**File: `apps/api/src/admin/dashboardService.ts`** (4 refs)

1. Lines 46-60: Replace `prisma.account.groupBy({ by: ["subscription"] })` with:

   ```typescript
   const subscriptionStats = await prisma.accountSubscription.groupBy({
     by: ["status"],
     _count: { id: true },
   });
   ```

   Return status-based distribution (TRIALING, ACTIVE, PAST_DUE, etc.) instead of tier-based.

2. Lines 124, 215: Replace `subscription: account.subscription` in account listings with a join to AccountSubscription:

   ```typescript
   include: { accountSubscription: { select: { status: true, bundleId: true } } }
   ```

3. Line 273: Same pattern as line 58 -- replace `.subscription.toLowerCase()` with `.status.toLowerCase()`

### Phase 8: RegisterCustomerUseCase cleanup

After D2 is complete, the `Account.create()` call in `RegisterCustomerUseCase` passes `subscription: input.plan`. Once the `subscription` field is removed from the entity, remove this parameter from the input DTO and the `Account.create()` call.

### Verification checklist

After all phases:

1. `grep -rn "Account\.subscription\|account\.subscription\|\.subscription\b" apps/api/src/ --include="*.ts"` should return only:
   - Stripe webhook event name mappings (false positives)
   - `AccountSubscription` model references (the new model)
2. `grep -rn "SubscriptionTier\b" apps/api/src/ infra/prisma/ --include="*.ts" --include="*.prisma"` should return 0
3. `pnpm build` passes
4. `pnpm test` -- all 7146+ tests pass
5. `pnpm lint` -- zero errors

---

## Risk Mitigation

### D1 rollback strategy

If D1 causes widespread test failures:

1. The Prisma migration can be rolled back with `prisma migrate resolve` + manual `ALTER TABLE "Account" ADD COLUMN "subscription" varchar DEFAULT 'BASIC'`
2. Git revert of the code changes
3. Approach incrementally: do Phase 1-2 first, fix all compile errors, then Phase 3-7

### D4 isolation

Each orphan use case registration is independent. If one adapter is problematic, the others can still be merged. Register with stub adapters (like the UpdatePricingConfigUseCase pattern in setupBillingUseCases.ts) as a last resort, but only temporarily.

### Build checkpoints

| After        | Run                       | Expected                                   |
| ------------ | ------------------------- | ------------------------------------------ |
| D3           | `pnpm build && pnpm test` | All pass                                   |
| D5           | `pnpm build && pnpm test` | All pass                                   |
| D4           | `pnpm build && pnpm test` | All pass (new tokens, no route wiring yet) |
| D2           | `pnpm build && pnpm test` | All pass                                   |
| D1 Phase 1-2 | `pnpm build`              | Expect compile errors in 11 files          |
| D1 Phase 3-7 | `pnpm build && pnpm test` | All pass                                   |
| D1 Phase 8   | `pnpm build && pnpm test` | Final all-clear                            |

---

## Critical Files for Implementation

1. `apps/api/src/events/EventStore.ts` -- D3 batch insert fix
2. `apps/api/src/application/customer-auth/RequestPasswordResetUseCase.ts` -- D5 email send
3. `apps/api/src/application/customer-auth/RegisterCustomerUseCase.ts` -- D2 arch fix
4. `apps/api/src/infrastructure/container/types.ts` -- D4 new tokens for 10 use cases
5. `apps/api/src/domain/entities/Account.ts` -- D1 subscription field removal
6. `infra/prisma/schema.prisma` -- D1 enum + column removal
7. `apps/api/src/infrastructure/container/setupUseCases.ts` -- D4 wire new setup modules
