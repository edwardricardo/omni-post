/**
 * Subscription Validation Schemas
 *
 * Zod schemas for subscription-related request validation.
 */

import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import { SecureSchemas } from "../security/inputValidation.js";

// Core schemas
const TierSchema = z.enum(["BASIC", "PRO", "ENTERPRISE"]);
const BillingCycleSchema = z.enum(["monthly", "yearly"]);

// Parameter schemas
export const ParamsWithAccountIdSchema = z.object({
  accountId: IdSchema,
});

export const ParamsWithTierSchema = z.object({
  tier: TierSchema,
});

// Request body schemas
export const SubscriptionChangeSchema = z.object({
  newTier: TierSchema,
  billingCycle: BillingCycleSchema,
  effectiveDate: z.string().pipe(z.coerce.date()).optional(),
  reason: z.string().optional(),
});

export const ValidateLimitsSchema = z.object({
  operation: z.enum(["CREATE_PROJECT", "ADD_TEAM_MEMBER", "UPLOAD_MEDIA"]),
  amount: z.number().min(1).default(1),
});

export const SuspendSubscriptionSchema = z.object({
  reason: SecureSchemas.userName,
});

export const BulkUpgradeSchema = z.object({
  accountIds: z.array(IdSchema).min(1).max(50),
  newTier: TierSchema,
  billingCycle: BillingCycleSchema,
  reason: z.string().optional(),
});

// Query schemas
export const SubscriptionFiltersSchema = z.object({
  tier: TierSchema.optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "email", "subscription"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const ExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  tier: TierSchema.optional(),
  startDate: z.string().pipe(z.coerce.date()).optional(),
  endDate: z.string().pipe(z.coerce.date()).optional(),
});

// Trial schemas
export const StartTrialSchema = z.object({
  tier: TierSchema.default("PRO"),
  trialDurationDays: z.number().min(1).max(30).default(7),
  autoRenewal: z.boolean().default(false),
  billingCycle: BillingCycleSchema.default("monthly"),
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
