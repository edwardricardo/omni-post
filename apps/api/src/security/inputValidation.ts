import { z, ZodSchema } from "zod";

// Security validation rules
export class SecurityValidator {
  private static readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /(-{2}|\/\*|\*\/)/,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
    /(['";])/,
    /(\bxp_\w+)/i,
    /(DROP\s+TABLE)/i,
    /(;\s*DROP)/i,
    /('\s*;\s*DROP)/i,
    /('\s*OR\s*'\w*'\s*=\s*'\w*)/i,
  ];

  private static readonly XSS_PATTERNS = [
    /<script[^>]*>.*?<\/script>/gi,
    /<script[^>]*>/gi,
    /<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /<object[^>]*>.*?<\/object>/gi,
    /<embed[^>]*>/gi,
    /<link[^>]*>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /onload\s*=/gi,
    /onclick\s*=/gi,
    /onerror\s*=/gi,
    /onmouseover\s*=/gi,
    /onfocus\s*=/gi,
    /onblur\s*=/gi,
    /alert\s*\(/gi,
    /<.*on\w+\s*=/gi,
  ];

  private static readonly PATH_TRAVERSAL_PATTERNS = [
    /\.\./,
    /\/\.\.\//,
    /\\\.\.\\/,
    /%2e%2e/i,
    /%252e%252e/i,
    /\.\.%2f/i,
    /\.\.%5c/i,
    /\.\.\/etc\/passwd/i,
    /\.\.\\etc\\passwd/i,
    /\.\.\/.*/,
  ];

  private static readonly COMMAND_INJECTION_PATTERNS = [
    /[;&|`$(){}[\]]/,
    /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|wget|curl|nc|ncat|telnet|ssh|scp|rsync)\b/i,
    /(>|>>|<|\||&)/,
    /(\$\(|`)/,
    /(;\s*ls\s)/i,
    /(test;\s*ls)/i,
    /(ls\s*-la)/i,
  ];

  static validateString(value: string, context: string): { isValid: boolean; threats: string[] } {
    const threats: string[] = [];

    // SQL Injection check
    if (this.SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
      threats.push("SQL_INJECTION");
    }

    // XSS check
    if (this.XSS_PATTERNS.some((pattern) => pattern.test(value))) {
      threats.push("XSS");
    }

    // Path traversal check
    if (this.PATH_TRAVERSAL_PATTERNS.some((pattern) => pattern.test(value))) {
      threats.push("PATH_TRAVERSAL");
    }

    // Command injection check
    if (this.COMMAND_INJECTION_PATTERNS.some((pattern) => pattern.test(value))) {
      threats.push("COMMAND_INJECTION");
    }

    // Length validation based on context
    const maxLengths: Record<string, number> = {
      email: 320,
      name: 256,
      title: 512,
      body: 10000,
      url: 2048,
      uuid: 36,
      channelId: 100,
      default: 1000,
    };

    const maxLength = maxLengths[context] || maxLengths.default;
    if (maxLength && value.length > maxLength) {
      threats.push("EXCESSIVE_LENGTH");
    }

    // Null byte check
    if (value.includes("\0")) {
      threats.push("NULL_BYTE");
    }

    // Unicode control character check
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f-\u009f]/.test(value) && !context.includes("body")) {
      threats.push("CONTROL_CHARACTERS");
    }

    return { isValid: threats.length === 0, threats };
  }

  static sanitizeString(value: string): string {
    return (
      value
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, "") // Remove control characters
        .replace(/\0/g, "") // Remove null bytes
        .trim()
    );
  }
}

// Enhanced Zod schemas with security validation
export const createSecureSchema = <T>(baseSchema: ZodSchema<T>) => {
  return baseSchema.superRefine((data: unknown, ctx) => {
    const validateRecursively = (obj: unknown, path: string[] = []) => {
      if (typeof obj === "string") {
        const contextKey = path[path.length - 1] || "default";
        const validation = SecurityValidator.validateString(obj, contextKey);

        if (!validation.isValid) {
          validation.threats.forEach((threat) => {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Security threat detected: ${threat}`,
              path: path,
            });
          });
        }
      } else if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
          validateRecursively(item, [...path, index.toString()]);
        });
      } else if (obj && typeof obj === "object") {
        Object.entries(obj).forEach(([key, value]) => {
          validateRecursively(value, [...path, key]);
        });
      }
    };

    validateRecursively(data);
  });
};

// Enhanced validation schemas
export const SecureSchemas = {
  // User input with stricter validation
  userEmail: z
    .string()
    .email()
    .max(320)
    .superRefine((email, ctx) => {
      const validation = SecurityValidator.validateString(email, "email");
      if (!validation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Security threat detected in email: ${validation.threats.join(", ")}`,
        });
      }
    }),

  userName: z
    .string()
    .min(1)
    .max(256)
    .superRefine((name, ctx) => {
      const validation = SecurityValidator.validateString(name, "name");
      if (!validation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Security threat detected in name: ${validation.threats.join(", ")}`,
        });
      }
    }),

  postBody: z
    .string()
    .min(1)
    .max(10000)
    .superRefine((body, ctx) => {
      const validation = SecurityValidator.validateString(body, "body");
      if (!validation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Security threat detected in content: ${validation.threats.join(", ")}`,
        });
      }
    }),

  url: z
    .string()
    .url()
    .max(2048)
    .transform((url, ctx) => {
      // Additional URL validation
      try {
        const parsed = new URL(url);
        const allowedProtocols = ["http:", "https:"];
        if (!allowedProtocols.includes(parsed.protocol)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid URL or unsupported protocol",
          });
          return z.NEVER;
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid URL format",
        });
        return z.NEVER;
      }
      return url;
    }),

  uuid: z.string().uuid(),

  // Media validation with stricter checks
  mediaUrl: z
    .string()
    .url()
    .max(2048)
    .transform((url, ctx) => {
      try {
        const parsed = new URL(url);
        const allowedProtocols = ["http:", "https:"];
        const allowedHosts = process.env.ALLOWED_MEDIA_HOSTS?.split(",") || [];

        if (!allowedProtocols.includes(parsed.protocol)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid media URL protocol",
          });
          return z.NEVER;
        }

        if (
          allowedHosts.length > 0 &&
          !allowedHosts.some((host) => parsed.hostname.endsWith(host))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Unauthorized media host",
          });
          return z.NEVER;
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid media URL format",
        });
        return z.NEVER;
      }
      return url;
    }),

  // File path validation
  filePath: z
    .string()
    .max(255)
    .superRefine((path, ctx) => {
      const validation = SecurityValidator.validateString(path, "filePath");
      if (!validation.isValid || path.includes("..")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid file path or security threat detected: ${validation.threats.join(", ")}`,
        });
      }
    }),

  // Channel ID validation
  channelId: z
    .string()
    .min(1)
    .max(100)
    .superRefine((channelId, ctx) => {
      const validation = SecurityValidator.validateString(channelId, "channelId");
      if (!validation.isValid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid channel ID or security threat detected: ${validation.threats.join(", ")}`,
        });
      }
    }),
};
