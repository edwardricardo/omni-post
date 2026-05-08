/**
 * @file schemas.ts
 * @description Common Zod schema helpers shared across route handlers — UUID,
 *              pagination, ISO date, email, URL, password, provider, post
 *              status, and user role validators. Pure validation primitives
 *              with no framework dependency.
 * @layer infrastructure
 */
import { z } from "zod";

/** UUID validation schema */
export const IdSchema = z.string().uuid({ message: "Invalid UUID format" });

/** Pagination query schema */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/** ISO 8601 datetime schema */
export const IsoDateSchema = z.string().datetime({ message: "Invalid ISO 8601 date format" });

/** Optional ISO 8601 datetime schema */
export const OptionalIsoDateSchema = IsoDateSchema.optional();

/** RFC 5322 email address schema */
export const EmailSchema = z.string().email({ message: "Invalid email format" });

/** Non-empty string schema */
export const NonEmptyStringSchema = z.string().min(1, { message: "String cannot be empty" });

/** Absolute URL schema */
export const UrlSchema = z.string().url({ message: "Invalid URL format" });

/** Positive integer schema */
export const PositiveIntSchema = z.number().int().positive();

/** Provider enum schema (commonly used by posts / channels routes) */
export const ProviderSchema = z.enum(["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"]);

/** Post status enum schema */
export const PostStatusSchema = z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "FAILED"]);

/** Strong password schema — min 8 chars, at least one uppercase + one digit */
export const PasswordSchema = z
  .string()
  .min(8, { message: "Password must be at least 8 characters" })
  .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter" })
  .regex(/[0-9]/, { message: "Password must contain at least one number" });

/** User role enum schema */
export const UserRoleSchema = z.enum(["ADMIN", "USER", "MODERATOR"]);
