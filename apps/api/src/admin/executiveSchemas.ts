/**
 * Admin Executive Schemas
 *
 * Zod validation schemas for executive dashboard and compliance endpoints.
 * Centralizes all input validation for executive metrics, compliance audit logs,
 * GDPR data requests, and account update operations.
 *
 * @module admin/executiveSchemas
 */
import { z } from "zod";
import { IdSchema } from "@packages/api-common";

/**
 * Query schema for compliance audit logs with pagination
 */
export const ComplianceAuditLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  action: z.string().optional(),
  resource: z.string().optional(),
  userId: IdSchema.optional(),
  success: z.coerce.boolean().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  sortBy: z.enum(["createdAt", "action", "resource"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Query schema for GDPR data requests
 */
export const GdprQuerySchema = z.object({
  accountId: IdSchema.optional(),
  requestType: z.enum(["export", "deletion"]).optional(),
  status: z.enum(["pending", "completed", "failed"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * Params schema for account ID
 */
export const AccountIdParamsSchema = z.object({
  id: IdSchema,
});

/**
 * Body schema for updating account settings
 */
export const UpdateAccountBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  subscription: z.enum(["BASIC", "PROFESSIONAL", "ENTERPRISE"]).optional(),
  maxProjects: z.number().int().positive().optional(),
  isOnTrial: z.boolean().optional(),
  trialEndDate: z.string().datetime().optional(),
  autoRenewal: z.boolean().optional(),
  billingCycle: z.enum(["monthly", "yearly"]).optional(),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
});

/**
 * Query schema for executive metrics filtering
 */
export const ExecutiveMetricsQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
});
