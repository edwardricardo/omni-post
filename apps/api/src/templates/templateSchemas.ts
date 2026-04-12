/**
 * @file templateSchemas.ts
 * @description Zod validation schemas for template management endpoints covering CRUD,
 *              versioning, A/B testing, analytics, and platform-specific limit queries.
 * @layer infrastructure
 */
import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import { SecureSchemas } from "../security/inputValidation.js";

// ============================================================================
// Params Schemas
// ============================================================================

/** Route params for project-scoped operations */
export const ProjectIdParamsSchema = z.object({
  projectId: IdSchema,
});

/** Route params for template-scoped operations */
export const TemplateIdParamsSchema = z.object({
  projectId: IdSchema,
  templateId: IdSchema,
});

/** Route params for version-scoped operations */
export const VersionIdParamsSchema = z.object({
  projectId: IdSchema,
  templateId: IdSchema,
  versionId: IdSchema,
});

/** Route params for A/B test operations */
export const TestIdParamsSchema = z.object({
  projectId: IdSchema,
  testId: IdSchema,
});

/** Route params for platform-specific operations */
export const PlatformParamsSchema = z.object({
  platform: z.string().min(1),
});

// ============================================================================
// Query Schemas
// ============================================================================

/** Query params for listing templates with filters */
export const GetTemplatesQuerySchema = z.object({
  category: z.string().optional(),
  platform: z.string().optional(),
  tags: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/** Query params for template analytics */
export const AnalyticsQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  templateIds: z.string().optional(),
});

/** Query params for filtering A/B tests by status */
export const ABTestStatusQuerySchema = z.object({
  status: z.enum(["DRAFT", "RUNNING", "PAUSED", "COMPLETED", "STOPPED"]).optional(),
});

// ============================================================================
// Body Schemas
// ============================================================================

/** Request body for creating a new template */
export const CreateTemplateBodySchema = z
  .object({
    name: SecureSchemas.userName,
    description: z.string().optional(),
    category: z.string().optional(),
    content: SecureSchemas.postBody,
    variables: z.record(z.string(), z.any()).optional(),
    platforms: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
  })
  .passthrough();

/** Request body for updating an existing template */
export const UpdateTemplateBodySchema = z
  .object({
    name: SecureSchemas.userName.optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    content: SecureSchemas.postBody.optional(),
    variables: z.record(z.string(), z.any()).optional(),
    platforms: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    isPublic: z.boolean().optional(),
  })
  .passthrough();

/** Request body for duplicating a template with a new name */
export const DuplicateTemplateBodySchema = z.object({
  name: SecureSchemas.userName,
});

/** Request body for compiling a template with context data */
export const CompileTemplateBodySchema = z.object({
  context: z.record(z.string(), z.any()),
  platforms: z.array(z.string()).optional(),
  abTestConfig: z.any().optional(),
});

/** Request body for creating a new template version */
export const CreateVersionBodySchema = z
  .object({
    content: SecureSchemas.postBody,
    changes: z.string().optional(),
    variables: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

/** Request body for tracking template usage events */
export const TrackUsageBodySchema = z.object({
  action: z.enum(["VIEW", "USE", "COMPILE", "LIKE", "SHARE"]),
  context: z.record(z.string(), z.any()).optional(),
  variantId: z.string().optional(),
});

/** Request body for creating a new A/B test */
export const CreateABTestBodySchema = z.object({
  name: SecureSchemas.userName,
  description: z.string().optional(),
  templateId: z.string(),
  config: z
    .object({
      variants: z.array(z.any()),
      allocation: z.record(z.string(), z.number()).optional(),
      metrics: z.array(z.string()).optional(),
      duration: z.number().optional(),
    })
    .passthrough(),
});
