/**
 * @file secureSchemas.ts
 * @description Centralized security-focused Zod schemas for API endpoint validation
 *              with advanced threat detection and input sanitization.
 * @layer infrastructure
 */

import { z } from "zod/v4";
import validator from "validator";
import { SecureSchemas as _BaseSecureSchemas } from "../security/inputValidation.js";

// Enhanced base primitives with comprehensive validation
export const SecurityValidatedSchemas = {
  // ============================================================================
  // BASIC DATA TYPES WITH SECURITY VALIDATION
  // ============================================================================

  /**
   * Secure email validation with additional security checks
   */
  email: z
    .string()
    .min(5)
    .max(320) // RFC 5321 limit
    .email("Invalid email format")
    .refine(
      (email) => {
        // Additional email security checks
        return (
          !email.includes("<script") &&
          !email.includes("javascript:") &&
          !/[<>"/]/.test(email) &&
          validator.isEmail(email)
        );
      },
      { message: "Email contains potentially dangerous characters" }
    )
    .transform((email) => validator.normalizeEmail(email) || email),

  /**
   * Strong password validation with security requirements
   */
  password: z
    .string()
    .min(12, "Password must be at least 12 characters long")
    .max(128, "Password too long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      "Password must contain uppercase, lowercase, number, and special character"
    )
    .refine(
      (password) => {
        // Check for common weak patterns
        const weakPatterns = [/123456/, /password/i, /qwerty/i, /admin/i, /letmein/i, /welcome/i];
        return !weakPatterns.some((pattern) => pattern.test(password));
      },
      { message: "Password contains common weak patterns" }
    ),

  /**
   * Secure username validation
   */
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username can only contain letters, numbers, underscore, and dash")
    .refine(
      (username) => {
        // Block reserved/system usernames
        const reservedNames = [
          "admin",
          "administrator",
          "root",
          "system",
          "api",
          "test",
          "user",
          "guest",
          "anonymous",
          "null",
          "undefined",
          "console",
          "window",
          "document",
          "eval",
          "function",
        ];
        return !reservedNames.includes(username.toLowerCase());
      },
      { message: "Username is reserved or not allowed" }
    ),

  /**
   * Secure UUID validation
   */
  uuid: z
    .string()
    .uuid("Invalid UUID format")
    .refine((uuid) => uuid.length === 36 && validator.isUUID(uuid), {
      message: "Invalid UUID format",
    }),

  /**
   * Secure URL validation with protocol and domain restrictions
   */
  url: z
    .string()
    .url("Invalid URL format")
    .max(2048)
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          const allowedProtocols = ["http:", "https:"];
          const blockedDomains = ["javascript", "data", "file", "ftp"];

          return (
            allowedProtocols.includes(parsed.protocol) &&
            !blockedDomains.some((domain) => parsed.hostname.includes(domain)) &&
            !parsed.hostname.includes("localhost") // Block localhost in production
          );
        } catch {
          return false;
        }
      },
      { message: "URL protocol not allowed or domain blocked" }
    ),

  /**
   * Secure file path validation
   */
  filePath: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (path) => {
        // Block path traversal attempts
        const dangerousPatterns = [
          /\.\./,
          /\/\.\.\//,
          /%2e%2e/i,
          /\\\.\.\\+/,
          /\/etc\/passwd/i,
          /\/proc\//i,
          /\/sys\//i,
          /\/dev\//i,
        ];
        return !dangerousPatterns.some((pattern) => pattern.test(path));
      },
      { message: "File path contains dangerous patterns" }
    ),

  /**
   * Secure filename validation for uploads
   */
  filename: z
    .string()
    .min(1)
    .max(255)
    .refine(
      (filename) => {
        // Allow only safe characters in filenames
        return /^[a-zA-Z0-9._-]+$/.test(filename) && !filename.startsWith(".");
      },
      { message: "Filename contains invalid characters" }
    )
    .refine(
      (filename) => {
        // Block dangerous file extensions
        const dangerousExtensions = [
          ".exe",
          ".bat",
          ".com",
          ".cmd",
          ".scr",
          ".pif",
          ".vbs",
          ".js",
          ".jar",
          ".app",
          ".deb",
          ".pkg",
          ".dmg",
          ".sh",
          ".ps1",
          ".php",
          ".asp",
          ".aspx",
          ".jsp",
          ".py",
          ".rb",
          ".pl",
          ".cgi",
        ];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
        return !dangerousExtensions.includes(ext);
      },
      { message: "File extension not allowed for security reasons" }
    ),

  // ============================================================================
  // SOCIAL MEDIA CONTENT VALIDATION
  // ============================================================================

  /**
   * Post content with comprehensive XSS protection
   */
  postContent: z
    .string()
    .min(1, "Post content cannot be empty")
    .max(10000, "Post content too long")
    .refine(
      (content) => {
        // Comprehensive XSS pattern detection
        const xssPatterns = [
          /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
          /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
          /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
          /<embed[\s\S]*?>/gi,
          /<link[\s\S]*?>/gi,
          /<meta[\s\S]*?>/gi,
          /javascript:/gi,
          /vbscript:/gi,
          /data:text\/html/gi,
          /on\\w+\\s*=/gi,
          /<svg[\s\S]*?onload[\s\S]*?>/gi,
          /<img[\s\S]*?onerror[\s\S]*?>/gi,
        ];
        return !xssPatterns.some((pattern) => pattern.test(content));
      },
      { message: "Content contains potentially dangerous script elements" }
    ),

  /**
   * Post title with length and content validation
   */
  postTitle: z
    .string()
    .min(1, "Title cannot be empty")
    .max(280, "Title too long")
    .refine(
      (title) => {
        // Basic XSS protection for titles
        return !/<[^>]*>/g.test(title) && !title.includes("javascript:");
      },
      { message: "Title contains invalid characters" }
    ),

  /**
   * Hashtag validation
   */
  hashtag: z
    .string()
    .min(1)
    .max(50)
    .regex(
      /^#[a-zA-Z0-9_]+$/,
      "Hashtag must start with # and contain only alphanumeric characters and underscore"
    ),

  /**
   * Media URL validation for social platforms
   */
  mediaUrl: z
    .string()
    .url()
    .max(2048)
    .refine(
      (url) => {
        try {
          const parsed = new URL(url);
          // Only allow HTTPS for media URLs
          return parsed.protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "Media URLs must use HTTPS protocol" }
    ),

  // ============================================================================
  // PLATFORM-SPECIFIC VALIDATION
  // ============================================================================

  /**
   * Provider/Channel ID validation
   */
  channelId: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, "Channel ID contains invalid characters"),

  /**
   * Provider name validation
   */
  providerName: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, "Provider name contains invalid characters")
    .refine(
      (name) => {
        const validProviders = [
          "twitter",
          "facebook",
          "instagram",
          "linkedin",
          "youtube",
          "tiktok",
        ];
        return validProviders.includes(name.toLowerCase());
      },
      { message: "Unknown or unsupported provider" }
    ),

  /**
   * OAuth token validation (for provider credentials)
   */
  oauthToken: z
    .string()
    .min(10)
    .max(2048)
    .refine(
      (token) => {
        // Basic token format validation
        return /^[A-Za-z0-9._-]+$/.test(token);
      },
      { message: "Invalid token format" }
    ),

  // ============================================================================
  // ADMINISTRATIVE VALIDATION
  // ============================================================================

  /**
   * User role validation
   */
  userRole: z.enum(["SUPER_ADMIN", "ADMIN", "SUPPORT", "USER"]),

  /**
   * Tenant tier validation
   */
  tenantTier: z.enum(["BASIC", "PRO", "ENTERPRISE", "ADMIN"]),

  /**
   * IP address validation
   */
  ipAddress: z
    .string()
    .refine((ip) => validator.isIP(ip), { message: "Invalid IP address format" }),

  /**
   * Phone number validation
   */
  phoneNumber: z.string().regex(/^\\+?[1-9]\\d{1,14}$/, "Invalid phone number format"),

  // ============================================================================
  // SEARCH AND QUERY VALIDATION
  // ============================================================================

  /**
   * Search query validation
   */
  searchQuery: z
    .string()
    .min(1)
    .max(100)
    .refine(
      (query) => {
        // Block SQL injection patterns in search
        const sqlPatterns = [
          /union\s+select/i,
          /drop\s+table/i,
          /delete\s+from/i,
          /insert\s+into/i,
          /update\s+set/i,
          /--/,
          /\/\*/,
        ];
        return !sqlPatterns.some((pattern) => pattern.test(query));
      },
      { message: "Search query contains invalid patterns" }
    ),

  /**
   * Sort field validation
   */
  sortField: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Invalid sort field")
    .refine(
      (field) => {
        // Whitelist allowed sort fields
        const allowedFields = [
          "createdAt",
          "updatedAt",
          "name",
          "email",
          "status",
          "title",
          "publishedAt",
          "scheduledAt",
          "views",
          "likes",
          "comments",
        ];
        return allowedFields.includes(field);
      },
      { message: "Sort field not allowed" }
    ),

  /**
   * Sort order validation
   */
  sortOrder: z.enum(["asc", "desc"]),

  /**
   * Pagination validation
   */
  pagination: z.object({
    page: z.number().int().min(1).max(1000).default(1),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).optional(),
  }),

  // ============================================================================
  // DATE AND TIME VALIDATION
  // ============================================================================

  /**
   * ISO date string validation
   */
  isoDate: z
    .string()
    .datetime({ message: "Invalid ISO date format" })
    .refine(
      (date) => {
        const parsed = new Date(date);
        return !isNaN(parsed.getTime());
      },
      { message: "Invalid date value" }
    ),

  /**
   * Future date validation (for scheduling)
   */
  futureDate: z
    .string()
    .datetime()
    .refine(
      (date) => {
        const parsed = new Date(date);
        return parsed.getTime() > Date.now();
      },
      { message: "Date must be in the future" }
    ),

  // ============================================================================
  // FILE UPLOAD VALIDATION
  // ============================================================================

  /**
   * File upload metadata validation
   */
  fileUpload: z.object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/\-+.]*$/),
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024), // 10MB limit
    checksum: z.string().optional(),
  }),

  /**
   * Image metadata validation
   */
  imageMetadata: z.object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    format: z.enum(["jpeg", "png", "gif", "webp"]),
  }),
};

// ============================================================================
// COMPOSITE SCHEMAS FOR COMMON USE CASES
// ============================================================================

export const CompositeSchemas = {
  /**
   * User registration schema
   */
  userRegistration: z.object({
    email: SecurityValidatedSchemas.email,
    password: SecurityValidatedSchemas.password,
    name: z.string().min(1).max(100),
    role: SecurityValidatedSchemas.userRole.optional(),
  }),

  /**
   * User login schema
   */
  userLogin: z.object({
    email: SecurityValidatedSchemas.email,
    password: z.string().min(1), // Don't validate structure for login
    mfaToken: z
      .string()
      .regex(/^[0-9A-F]{6,8}$/i)
      .optional(),
  }),

  /**
   * Post creation schema
   */
  postCreation: z.object({
    title: SecurityValidatedSchemas.postTitle.optional(),
    content: SecurityValidatedSchemas.postContent,
    mediaUrls: z.array(SecurityValidatedSchemas.mediaUrl).max(10).optional(),
    hashtags: z.array(SecurityValidatedSchemas.hashtag).max(20).optional(),
    scheduledAt: SecurityValidatedSchemas.futureDate.optional(),
  }),

  /**
   * Channel configuration schema
   */
  channelConfig: z.object({
    channelId: SecurityValidatedSchemas.channelId,
    provider: SecurityValidatedSchemas.providerName,
    credentials: z.object({
      accessToken: SecurityValidatedSchemas.oauthToken,
      refreshToken: SecurityValidatedSchemas.oauthToken.optional(),
      expiresAt: SecurityValidatedSchemas.isoDate.optional(),
    }),
  }),

  /**
   * Search and filter schema
   */
  searchAndFilter: z.object({
    query: SecurityValidatedSchemas.searchQuery.optional(),
    sortBy: SecurityValidatedSchemas.sortField.default("createdAt"),
    sortOrder: SecurityValidatedSchemas.sortOrder.default("desc"),
    ...SecurityValidatedSchemas.pagination.shape,
  }),
};

// ============================================================================
// VALIDATION HELPER FUNCTIONS
// ============================================================================

/**
 * Validate and sanitize request data
 */
export function validateRequestData<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  try {
    const result = schema.safeParse(data);

    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      return { success: false, errors };
    }
  } catch (error) {
    return {
      success: false,
      errors: [`Validation error: ${error instanceof Error ? error.message : "Unknown error"}`],
    };
  }
}

/**
 * Create middleware for route-specific validation
 */
export function createRouteValidation<T>(schema: z.ZodSchema<T>) {
  return (data: unknown) => validateRequestData(schema, data);
}
