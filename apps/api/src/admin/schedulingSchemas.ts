/**
 * @file schedulingSchemas.ts
 * @description Zod validation schemas for scheduling management endpoints including
 *              post queries, rescheduling, slot creation, and optimal time analysis.
 * @layer infrastructure
 */
import { z } from "zod";
import { IdSchema } from "@packages/api-common";

/**
 * Query schema for fetching scheduled posts with filters
 */
export const ScheduledPostsQuerySchema = z.object({
  projectId: IdSchema.optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(["scheduledAt", "createdAt", "updatedAt"]).default("scheduledAt"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

/**
 * Params schema for post ID
 */
export const PostIdParamsSchema = z.object({
  id: IdSchema,
});

/**
 * Body schema for rescheduling a post
 */
export const ReschedulePostBodySchema = z.object({
  scheduledAt: z.string().datetime(),
  timezone: z.string().default("UTC"),
  updateChannels: z.boolean().default(true),
});

/**
 * Query schema for available scheduling slots
 */
export const SchedulingSlotsQuerySchema = z.object({
  projectId: IdSchema,
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  timezone: z.string().default("UTC"),
});

/**
 * Query schema for optimal posting times
 */
export const OptimalTimesQuerySchema = z.object({
  projectId: IdSchema,
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  lookbackDays: z.coerce.number().int().min(7).max(365).default(30),
  timezone: z.string().default("UTC"),
});

/**
 * Query schema for scheduling rules
 */
export const SchedulingRulesQuerySchema = z.object({
  projectId: IdSchema,
  provider: z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]).optional(),
  isActive: z.coerce.boolean().optional(),
});

/**
 * Body schema for creating a schedule slot
 */
export const CreateScheduleSlotBodySchema = z.object({
  projectId: IdSchema,
  dayOfWeek: z.coerce.number().int().min(0).max(6), // 0 = Sunday, 6 = Saturday
  hour: z.coerce.number().int().min(0).max(23),
  minute: z.coerce.number().int().min(0).max(59).default(0),
  timezone: z.string().default("UTC"),
  providers: z.array(z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"])).min(1),
  isActive: z.boolean().default(true),
});

/**
 * Body schema for bulk creating schedule slots
 */
export const BulkCreateScheduleSlotsBodySchema = z.object({
  projectId: IdSchema,
  slots: z
    .array(
      z.object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        hour: z.coerce.number().int().min(0).max(23),
        minute: z.coerce.number().int().min(0).max(59).default(0),
        providers: z.array(z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"])).min(1),
      })
    )
    .min(1),
  timezone: z.string().default("UTC"),
  isActive: z.boolean().default(true),
});
