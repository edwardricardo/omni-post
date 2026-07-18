/**
 * @file enhancedValidator.ts
 * @description Enhanced input validation and sanitization with SQL injection, XSS,
 *              and command injection detection using DOMPurify and pattern matching.
 * @layer infrastructure
 */
import { randomUUID } from "node:crypto";
import DOMPurify from "isomorphic-dompurify";
import validator from "validator";
import type { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import { logger } from "../lib/logger.js";
import { resolveClientIp } from "./resolveClientIp.js";

type RiskLevel = "low" | "medium" | "high" | "critical";

interface ValidationResult {
  isValid: boolean;
  sanitized?: unknown;
  threats: string[];
  risk: RiskLevel;
}

// Enhanced security patterns for common attack vectors
const SECURITY_PATTERNS = {
  // SQL Injection patterns
  SQL_INJECTION: [
    /(select\s+.*\s+from\s+|insert\s+into\s+|update\s+.*\s+set\s+|delete\s+from\s+)/i,
    /union\s+(all\s+)?select/i,
    /information_schema/i,
    /pg_sleep/i,
    /waitfor\s+delay/i,
    /benchmark\s*\(/i,
  ],

  // XSS patterns
  XSS: [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
    /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?>/gi,
    /<link[\s\S]*?>/gi,
    /<meta[\s\S]*?>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
    /<img[\s\S]*?onerror[\s\S]*?>/gi,
    /<svg[\s\S]*?onload[\s\S]*?>/gi,
  ],

  // NoSQL Injection patterns
  NOSQL_INJECTION: [/\$where/i, /\$ne/i, /\$gt/i, /\$lt/i, /\$regex/i, /\$or/i, /\$and/i],

  // Command Injection patterns
  COMMAND_INJECTION: [
    /;\s*(rm|del|format|fdisk)/i,
    /\|\s*(wget|curl|nc|netcat)/i,
    /\$\(.*\)/,
    /`.*`/,
    /&&/,
    /\|\|/,
  ],

  // Path Traversal patterns
  PATH_TRAVERSAL: [/\.\.\//g, /\.\.\\+/g, /%2e%2e%2f/gi, /%2e%2e\\+/gi],

  // LDAP Injection patterns
  LDAP_INJECTION: [/\*\)|\|\)|&\)|!\)/, /\(\*|\(\||\(&|\(!/],
};

// Common dangerous strings
const DANGEROUS_STRINGS = [
  "eval(",
  "Function(",
  "setTimeout(",
  "setInterval(",
  "new Function",
  "require(",
  "process.env",
  "__dirname",
  "__filename",
];

interface ValidationConfig {
  enableXSSProtection: boolean;
  enableSQLInjectionProtection: boolean;
  enableCommandInjectionProtection: boolean;
  enablePathTraversalProtection: boolean;
  enableNoSQLInjectionProtection: boolean;
  enableLDAPInjectionProtection: boolean;
  maxStringLength: number;
  allowedFileExtensions: string[];
  blockedUserAgents: string[];
  enableContentTypeValidation: boolean;
  enableReferrerValidation: boolean;
  trustedDomains: string[];
}

export class EnhancedValidator {
  private config: ValidationConfig;
  private scheduler: BackgroundTaskScheduler;
  private suspiciousAttempts: Map<string, number> = new Map();
  private readonly taskId: string;

  constructor(scheduler: BackgroundTaskScheduler, config: Partial<ValidationConfig> = {}) {
    this.scheduler = scheduler;
    this.config = {
      enableXSSProtection: true,
      enableSQLInjectionProtection: true,
      enableCommandInjectionProtection: true,
      enablePathTraversalProtection: true,
      enableNoSQLInjectionProtection: true,
      enableLDAPInjectionProtection: true,
      maxStringLength: 10000,
      allowedFileExtensions: [".jpg", ".jpeg", ".png", ".gif", ".pdf", ".txt", ".csv"],
      blockedUserAgents: ["sqlmap", "nikto", "w3af", "burp"],
      enableContentTypeValidation: true,
      enableReferrerValidation: false,
      trustedDomains: [],
      ...config,
    };
    this.taskId = `enhanced-validator-cleanup-${randomUUID()}`;

    // Clean up suspicious attempts every hour.
    this.scheduler.register(this.taskId, () => this.cleanupSuspiciousAttempts(), 60 * 60 * 1000);
  }

  // Main validation function for request data
  validateInput(input: unknown, context: string = "general"): ValidationResult {
    const threats: string[] = [];
    const risk: RiskLevel = "low";

    if (typeof input === "string") {
      return this.validateString(input, context);
    }

    if (Array.isArray(input)) {
      return this.validateArray(input, context);
    }

    if (typeof input === "object" && input !== null) {
      return this.validateObject(input as Record<string, unknown>, context);
    }

    return { isValid: true, sanitized: input, threats, risk };
  }

  private validateString(input: string, context: string): ValidationResult {
    const threats: string[] = [];
    let risk: RiskLevel = "low";

    // Length validation
    if (input.length > this.config.maxStringLength) {
      threats.push("EXCESSIVE_LENGTH");
      risk = "medium";
      return { isValid: false, threats, risk };
    }

    // SQL Injection detection
    if (this.config.enableSQLInjectionProtection) {
      for (const pattern of SECURITY_PATTERNS.SQL_INJECTION) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("SQL_INJECTION");
          risk = "critical";
        }
      }
    }

    // XSS detection
    if (this.config.enableXSSProtection) {
      for (const pattern of SECURITY_PATTERNS.XSS) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("XSS_ATTEMPT");
          risk = "high";
        }
      }
    }

    // NoSQL Injection detection
    if (this.config.enableNoSQLInjectionProtection) {
      for (const pattern of SECURITY_PATTERNS.NOSQL_INJECTION) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("NOSQL_INJECTION");
          risk = "high";
        }
      }
    }

    // Command Injection detection
    if (this.config.enableCommandInjectionProtection) {
      for (const pattern of SECURITY_PATTERNS.COMMAND_INJECTION) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("COMMAND_INJECTION");
          risk = "critical";
        }
      }
    }

    // Path Traversal detection
    if (this.config.enablePathTraversalProtection) {
      for (const pattern of SECURITY_PATTERNS.PATH_TRAVERSAL) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("PATH_TRAVERSAL");
          risk = "high";
        }
      }
    }

    // LDAP Injection detection
    if (this.config.enableLDAPInjectionProtection) {
      for (const pattern of SECURITY_PATTERNS.LDAP_INJECTION) {
        pattern.lastIndex = 0;
        if (pattern.test(input)) {
          threats.push("LDAP_INJECTION");
          risk = "high";
        }
      }
    }

    // Dangerous string detection
    for (const dangerousString of DANGEROUS_STRINGS) {
      if (input.includes(dangerousString)) {
        threats.push("DANGEROUS_FUNCTION");
        risk = "high";
      }
    }

    // If threats detected, return validation failure
    if (threats.length > 0) {
      return { isValid: false, threats, risk };
    }

    // Sanitize string based on context
    const sanitized = this.sanitizeString(input, context);

    return { isValid: true, sanitized, threats, risk };
  }

  private validateObject(obj: Record<string, unknown>, context: string): ValidationResult {
    const threats: string[] = [];
    let maxRisk: RiskLevel = "low";
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Validate the key itself
      const keyValidation = this.validateString(key, "object_key");
      if (!keyValidation.isValid) {
        threats.push(...keyValidation.threats);
        maxRisk = this.getMaxRisk(maxRisk, keyValidation.risk);
        continue;
      }

      // Validate the value
      const valueValidation = this.validateInput(value, context);
      if (!valueValidation.isValid) {
        threats.push(...valueValidation.threats);
        maxRisk = this.getMaxRisk(maxRisk, valueValidation.risk);
        continue;
      }

      const sanitizedKey = (keyValidation.sanitized as string) || key;
      sanitized[sanitizedKey] = valueValidation.sanitized;
    }

    return {
      isValid: threats.length === 0,
      sanitized: threats.length === 0 ? sanitized : undefined,
      threats,
      risk: maxRisk,
    };
  }

  private validateArray(arr: unknown[], context: string): ValidationResult {
    const threats: string[] = [];
    let maxRisk: RiskLevel = "low";
    const sanitized: unknown[] = [];

    for (const item of arr) {
      const itemValidation = this.validateInput(item, context);
      if (!itemValidation.isValid) {
        threats.push(...itemValidation.threats);
        maxRisk = this.getMaxRisk(maxRisk, itemValidation.risk);
        continue;
      }
      sanitized.push(itemValidation.sanitized);
    }

    return {
      isValid: threats.length === 0,
      ...(threats.length === 0 ? { sanitized } : {}),
      threats,
      risk: maxRisk,
    };
  }

  public sanitizeString(input: string, context: string): string {
    let sanitized = input;

    switch (context) {
      case "html":
        // Use DOMPurify for HTML content
        sanitized = DOMPurify.sanitize(input, {
          ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "ol", "ul", "li"],
          ALLOWED_ATTR: [],
        });
        break;

      case "url":
        // Validate and sanitize URLs
        if (validator.isURL(input)) {
          sanitized = validator.escape(input);
        } else {
          sanitized = "";
        }
        break;

      case "email":
        // Validate and normalize email
        if (validator.isEmail(input)) {
          sanitized = validator.normalizeEmail(input) || input;
        } else {
          sanitized = "";
        }
        break;

      case "filename":
        // Sanitize filename
        sanitized = input.replace(/[^a-zA-Z0-9._-]/g, "_");
        break;

      case "object_key":
        // Sanitize object keys
        sanitized = input.replace(/[^a-zA-Z0-9_]/g, "_");
        break;

      default:
        // General sanitization - escape HTML entities
        sanitized = validator.escape(input);
        break;
    }

    return sanitized;
  }

  public getMaxRisk(current: string, newRisk: string): "low" | "medium" | "high" | "critical" {
    const riskLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const currentLevel = riskLevels[current as keyof typeof riskLevels] || 1;
    const newLevel = riskLevels[newRisk as keyof typeof riskLevels] || 1;

    const maxLevel = Math.max(currentLevel, newLevel);
    return Object.keys(riskLevels)[maxLevel - 1] as "low" | "medium" | "high" | "critical";
  }

  // Validate HTTP request
  validateRequest(req: FastifyRequest): {
    isValid: boolean;
    threats: string[];
    risk: "low" | "medium" | "high" | "critical";
    blockedReason?: string;
  } {
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    // Check User-Agent
    const userAgent = req.headers["user-agent"] || "";
    for (const blockedUA of this.config.blockedUserAgents) {
      if (userAgent.toLowerCase().includes(blockedUA.toLowerCase())) {
        threats.push("BLOCKED_USER_AGENT");
        risk = "high";
        return {
          isValid: false,
          threats,
          risk,
          blockedReason: `Blocked user agent: ${blockedUA}`,
        };
      }
    }

    // Validate Content-Type for POST/PUT requests
    if (this.config.enableContentTypeValidation) {
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        const contentType = req.headers["content-type"];
        if (
          !contentType ||
          (!contentType.includes("application/json") &&
            !contentType.includes("application/x-www-form-urlencoded") &&
            !contentType.includes("multipart/form-data"))
        ) {
          threats.push("INVALID_CONTENT_TYPE");
          risk = "medium";
        }
      }
    }

    // Validate Referrer if enabled
    if (this.config.enableReferrerValidation && this.config.trustedDomains.length > 0) {
      const referrer = req.headers.referer || req.headers.referrer;
      if (referrer) {
        const isValidReferrer = this.config.trustedDomains.some((domain) =>
          referrer.includes(domain)
        );
        if (!isValidReferrer) {
          threats.push("UNTRUSTED_REFERRER");
          risk = "medium";
        }
      }
    }

    // Validate request size
    const contentLength = parseInt(req.headers["content-length"] || "0");
    if (contentLength > 100 * 1024 * 1024) {
      // 100MB limit
      threats.push("EXCESSIVE_REQUEST_SIZE");
      risk = "high";
    }

    // Track suspicious attempts
    const clientIP = this.getClientIP(req);
    if (threats.length > 0) {
      this.trackSuspiciousAttempt(clientIP, threats);
    }

    return {
      isValid: threats.length === 0,
      threats,
      risk,
    };
  }

  // File upload validation
  validateFileUpload(
    filename: string,
    mimeType: string,
    size: number
  ): {
    isValid: boolean;
    threats: string[];
    risk: "low" | "medium" | "high" | "critical";
  } {
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    // Validate file extension
    const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
    if (!this.config.allowedFileExtensions.includes(ext)) {
      threats.push("INVALID_FILE_EXTENSION");
      risk = "high";
    }

    // Validate filename for path traversal
    const filenameValidation = this.validateString(filename, "filename");
    if (!filenameValidation.isValid) {
      threats.push(...filenameValidation.threats);
      risk = this.getMaxRisk(risk, filenameValidation.risk);
    }

    // Validate file size (10MB limit)
    if (size > 10 * 1024 * 1024) {
      threats.push("EXCESSIVE_FILE_SIZE");
      risk = "medium";
    }

    // Validate MIME type consistency
    const expectedMimes: Record<string, string[]> = {
      ".jpg": ["image/jpeg"],
      ".jpeg": ["image/jpeg"],
      ".png": ["image/png"],
      ".gif": ["image/gif"],
      ".pdf": ["application/pdf"],
      ".txt": ["text/plain"],
      ".csv": ["text/csv", "application/csv"],
    };

    if (expectedMimes[ext] && !expectedMimes[ext].includes(mimeType)) {
      threats.push("MIME_TYPE_MISMATCH");
      risk = "high";
    }

    return { isValid: threats.length === 0, threats, risk };
  }

  private getClientIP(req: FastifyRequest): string {
    // Canonical resolver: suspicious-attempt tracking is an IP-keyed security
    // decision, so it MUST NOT trust the spoofable leftmost X-Forwarded-For /
    // standalone X-Real-IP. See SECURITY_CANON.md §Rate Limiting.
    return resolveClientIp(req);
  }

  private trackSuspiciousAttempt(clientIP: string, threats: string[]): void {
    const current = this.suspiciousAttempts.get(clientIP) || 0;
    this.suspiciousAttempts.set(clientIP, current + threats.length);

    // Log if threshold exceeded
    if (current + threats.length > 10) {
      logger.warn(
        { clientIP, threats, attemptCount: current + threats.length },
        "High suspicious activity detected"
      );
    }
  }

  private cleanupSuspiciousAttempts(): void {
    // Clean up old entries to prevent memory leaks
    if (this.suspiciousAttempts.size > 10000) {
      this.suspiciousAttempts.clear();
    }
  }

  /**
   * Cleanup method — unregisters the scheduled cleanup task and clears the
   * in-memory attempts map. Safe to call multiple times. The scheduler's
   * shutdownAll() also clears the task; explicit destroy() is only required
   * when disposing the validator mid-process (e.g., in tests).
   */
  public destroy(): void {
    this.scheduler.unregister(this.taskId);
    this.suspiciousAttempts.clear();
  }

  // Fastify plugin
  getPlugin() {
    const self = this;
    return async function enhancedValidatorPlugin(fastify: FastifyInstance) {
      fastify.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
        // Validate the request itself
        const requestValidation = self.validateRequest(request);

        if (!requestValidation.isValid) {
          reply.code(400);
          return reply.send({
            ok: false,
            error: "SECURITY_VALIDATION_FAILED",
            message: "Request blocked due to security validation failure",
            threats: requestValidation.threats,
            risk: requestValidation.risk,
          });
        }

        // Validate request body if present
        if (request.body && typeof request.body === "object") {
          const bodyValidation = self.validateInput(request.body, "general");

          if (!bodyValidation.isValid) {
            reply.code(400);
            return reply.send({
              ok: false,
              error: "INPUT_VALIDATION_FAILED",
              message: "Request body contains potentially malicious content",
              threats: bodyValidation.threats,
              risk: bodyValidation.risk,
            });
          }

          // Replace body with sanitized version
          request.body = bodyValidation.sanitized;
        }

        // Validate query parameters
        if (request.query && typeof request.query === "object") {
          const queryValidation = self.validateInput(request.query, "general");

          if (!queryValidation.isValid) {
            reply.code(400);
            return reply.send({
              ok: false,
              error: "QUERY_VALIDATION_FAILED",
              message: "Query parameters contain potentially malicious content",
              threats: queryValidation.threats,
              risk: queryValidation.risk,
            });
          }

          // Replace query with sanitized version
          request.query = queryValidation.sanitized;
        }
      });
    };
  }
}
