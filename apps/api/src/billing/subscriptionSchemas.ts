/**
 * @file subscriptionSchemas.ts
 * @description Zod validation schemas for subscription-related requests.
 *   Supports both new provider-based model and legacy tier-based model.
 * @layer infrastructure
 */

import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import { SecureSchemas } from "../security/inputValidation.js";

// ═══════════════════════════════════════════════════════════════
// New provider-based schemas
// ═══════════════════════════════════════════════════════════════

const StatusSchema = z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED", "GRANDFATHERED"]);
const BillingCycleSchema = z.enum(["monthly", "yearly"]);

export const ParamsWithAccountIdSchema = z.object({
  accountId: IdSchema,
});

/** Change subscription: switch providers, bundle, or cancel */
export const ChangeSubscriptionSchema = z.object({
  providers: z.array(z.string()).optional(),
  bundleId: z.string().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

/** Start trial for an account */
export const StartTrialSchema = z.object({
  bundleId: z.string().optional(),
  providers: z.array(z.string()).optional(),
  trialDays: z.number().int().min(1).max(90).default(14),
});

/** Filter subscriptions by status/type */
export const SubscriptionFiltersSchema = z.object({
  status: StatusSchema.optional(),
  planType: z.enum(["bundle", "custom"]).optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "pricePerMonth", "status"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const BulkOperationSchema = z.object({
  accountIds: z.array(IdSchema).min(1).max(50),
});

export const ExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  status: StatusSchema.optional(),
  startDate: z.string().pipe(z.coerce.date()).optional(),
  endDate: z.string().pipe(z.coerce.date()).optional(),
});

// ═══════════════════════════════════════════════════════════════
// Legacy tier-based schemas (kept for backward compatibility)
// ═══════════════════════════════════════════════════════════════

/** @deprecated Use ChangeSubscriptionSchema instead */
const TierSchema = z.enum(["BASIC", "PRO", "ENTERPRISE"]);

/** @deprecated Use ParamsWithAccountIdSchema */
export const ParamsWithTierSchema = z.object({
  tier: TierSchema,
});

/** @deprecated Use ChangeSubscriptionSchema */
export const LegacySubscriptionChangeSchema = z.object({
  newTier: TierSchema,
  billingCycle: BillingCycleSchema,
  effectiveDate: z.string().pipe(z.coerce.date()).optional(),
  reason: z.string().optional(),
});

/** @deprecated Use BulkOperationSchema */
export const BulkUpgradeSchema = z.object({
  accountIds: z.array(IdSchema).min(1).max(50),
  newTier: TierSchema,
  billingCycle: BillingCycleSchema,
  reason: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════
// Shared schemas (used by both models)
// ═══════════════════════════════════════════════════════════════

export const ValidateLimitsSchema = z.object({
  operation: z.enum(["CREATE_PROJECT", "ADD_TEAM_MEMBER", "UPLOAD_MEDIA"]),
  amount: z.number().min(1).default(1),
});

export const SuspendSubscriptionSchema = z.object({
  reason: SecureSchemas.userName,
});

export const EndTrialSchema = z.object({
  reason: SecureSchemas.userName,
});

export const ConvertTrialSchema = z.object({
  billingCycle: BillingCycleSchema.default("monthly"),
});

export const ExpiringTrialsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).optional().default(1),
});

// Re-export SubscriptionChangeSchema as the old name for callers that haven't migrated
export { LegacySubscriptionChangeSchema as SubscriptionChangeSchema };
