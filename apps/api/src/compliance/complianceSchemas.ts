/**
 * @file complianceSchemas.ts
 * @description Zod validation schemas for compliance endpoints.
 * @layer infrastructure
 */

import { z } from "zod";

export const updateGdprSettingsSchema = z.object({
  privacyPolicyUrl: z.string().url().nullable().optional(),
  cookiePolicyUrl: z.string().url().nullable().optional(),
  termsOfServiceUrl: z.string().url().nullable().optional(),
  dpoType: z.enum(["INTERNAL", "EXTERNAL"]).optional(),
  dpoEmail: z.string().email().nullable().optional(),
  dpoUrl: z.string().url().nullable().optional(),
  dataRetentionDays: z.number().int().min(30).max(3650).optional(),
  auditLogRetentionDays: z.number().int().min(30).max(3650).optional(),
  enableAutoDataDeletion: z.boolean().optional(),
  dsarResponseDays: z.number().int().min(15).max(45).optional(),
  defaultJurisdiction: z.enum(["GDPR", "LGPD", "CCPA", "PIPEDA", "OTHER"]).optional(),
  enableRightToErasure: z.boolean().optional(),
  enableDataExport: z.boolean().optional(),
  enableDataAccess: z.boolean().optional(),
  enableBreachNotification: z.boolean().optional(),
});

export const updateSecuritySettingsSchema = z.object({
  require2FA: z.boolean().optional(),
  sessionTimeoutMinutes: z.number().int().min(15).max(10080).optional(),
  maxLoginAttempts: z.number().int().min(3).max(20).optional(),
  passwordMinLength: z.number().int().min(6).max(128).optional(),
  requireUppercase: z.boolean().optional(),
  requireSpecialChar: z.boolean().optional(),
  ipAllowlistEnabled: z.boolean().optional(),
  ipAllowlist: z.array(z.string()).optional(),
});

export const dsarFiltersSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "EXPIRED"]).optional(),
  type: z.enum(["EXPORT", "DELETION", "ACCESS"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const submitDsarSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  type: z.enum(["EXPORT", "DELETION", "ACCESS"]),
  jurisdiction: z.enum(["GDPR", "LGPD", "CCPA", "PIPEDA", "OTHER"]).optional(),
  accountId: z.string().optional(),
});

export const createBreachSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  discoveredAt: z.string(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  dataTypesAffected: z.array(z.string()).min(1),
  affectedUserCount: z.number().int().min(0).optional(),
});

export const breachFiltersSchema = z.object({
  resolved: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

export const rejectDsarSchema = z.object({
  reason: z.string().min(1),
});

export const completeDsarSchema = z.object({
  exportUrl: z.string().url().optional(),
});
