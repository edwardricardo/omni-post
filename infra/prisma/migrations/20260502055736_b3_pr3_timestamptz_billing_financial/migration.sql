-- B3 PR-3: billing/financial family — DateTime → TIMESTAMPTZ(6) migration.
--
-- Affected models (12): Account, AccountSubscription, Invoice,
-- GatewaySwitchEvent, SubscriptionPriceHistory, AccountPricingTier,
-- ProviderPricingTier, ProviderBundle, Referral, ReferralCode,
-- AccountCredential, PlatformCredential.
--
-- 43 columns flipped. Trial periods, billing dates, invoice periods,
-- subscription lifecycle, gateway switch coordination — all UTC instants
-- where dropping timezone offset is a real data-integrity bug for
-- multi-tenant accounts spanning timezones.
--
-- Canon: PG 9.2+ no-rewrite optimization with session timezone = UTC.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIMEZONE = 'UTC';

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "trialStartDate" TYPE TIMESTAMPTZ(6) USING "trialStartDate" AT TIME ZONE 'UTC',
ALTER COLUMN "trialEndDate" TYPE TIMESTAMPTZ(6) USING "trialEndDate" AT TIME ZONE 'UTC',
ALTER COLUMN "lastBillingDate" TYPE TIMESTAMPTZ(6) USING "lastBillingDate" AT TIME ZONE 'UTC',
ALTER COLUMN "nextBillingDate" TYPE TIMESTAMPTZ(6) USING "nextBillingDate" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "gatewaySwitchAt" TYPE TIMESTAMPTZ(6) USING "gatewaySwitchAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AccountCredential" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AccountPricingTier" ALTER COLUMN "effectiveFrom" TYPE TIMESTAMPTZ(6) USING "effectiveFrom" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AccountSubscription" ALTER COLUMN "currentPeriodStart" TYPE TIMESTAMPTZ(6) USING "currentPeriodStart" AT TIME ZONE 'UTC',
ALTER COLUMN "currentPeriodEnd" TYPE TIMESTAMPTZ(6) USING "currentPeriodEnd" AT TIME ZONE 'UTC',
ALTER COLUMN "trialEndsAt" TYPE TIMESTAMPTZ(6) USING "trialEndsAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "GatewaySwitchEvent" ALTER COLUMN "requestedAt" TYPE TIMESTAMPTZ(6) USING "requestedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "scheduledFor" TYPE TIMESTAMPTZ(6) USING "scheduledFor" AT TIME ZONE 'UTC',
ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(6) USING "completedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "cancelledAt" TYPE TIMESTAMPTZ(6) USING "cancelledAt" AT TIME ZONE 'UTC',
ALTER COLUMN "reminderSentAt" TYPE TIMESTAMPTZ(6) USING "reminderSentAt" AT TIME ZONE 'UTC',
ALTER COLUMN "suspendedAt" TYPE TIMESTAMPTZ(6) USING "suspendedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "extendedUntil" TYPE TIMESTAMPTZ(6) USING "extendedUntil" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "periodStart" TYPE TIMESTAMPTZ(6) USING "periodStart" AT TIME ZONE 'UTC',
ALTER COLUMN "periodEnd" TYPE TIMESTAMPTZ(6) USING "periodEnd" AT TIME ZONE 'UTC',
ALTER COLUMN "paidAt" TYPE TIMESTAMPTZ(6) USING "paidAt" AT TIME ZONE 'UTC',
ALTER COLUMN "nextRetryAt" TYPE TIMESTAMPTZ(6) USING "nextRetryAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PlatformCredential" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ProviderBundle" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ProviderPricingTier" ALTER COLUMN "effectiveFrom" TYPE TIMESTAMPTZ(6) USING "effectiveFrom" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Referral" ALTER COLUMN "convertedAt" TYPE TIMESTAMPTZ(6) USING "convertedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ReferralCode" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "SubscriptionPriceHistory" ALTER COLUMN "effectiveAt" TYPE TIMESTAMPTZ(6) USING "effectiveAt" AT TIME ZONE 'UTC',
ALTER COLUMN "notifiedAt" TYPE TIMESTAMPTZ(6) USING "notifiedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';
