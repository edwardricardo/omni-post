/**
 * @file securityHeaders.ts
 * @description Security headers configuration applying helmet, CORS, HSTS, CSP,
 *              X-Frame-Options, and permissions policy to Fastify responses.
 * @layer infrastructure
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { logger } from "../lib/logger.js";

export interface SecurityConfig {
  contentSecurityPolicy: {
    enabled: boolean;
    directives?: Record<string, string | string[]>;
  };
  cors: {
    enabled: boolean;
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders: string[];
    allowCredentials: boolean;
    maxAge: number;
  };
  hsts: {
    enabled: boolean;
    maxAge: number;
    includeSubDomains: boolean;
    preload: boolean;
  };
  xssProtection: boolean;
  noSniff: boolean;
  frameOptions: "DENY" | "SAMEORIGIN" | "ALLOW-FROM";
  referrerPolicy: string;
  permissionsPolicy: Record<string, string[]>;
}

export class SecurityManager {
  private config: SecurityConfig;

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = {
      contentSecurityPolicy: {
        enabled: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "https:"],
          "font-src": ["'self'", "https:", "data:"],
          "connect-src": ["'self'", "https:", "wss:", "ws:"],
          "media-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "upgrade-insecure-requests": [],
        },
      },
      cors: {
        enabled: true,
        allowedOrigins: [
          "http://localhost:3000",
          "http://localhost:3100",
          "http://localhost:3200",
          "https://localhost:3000",
          "https://localhost:3100",
          "https://localhost:3200",
        ],
        allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "Authorization",
          "X-Requested-With",
          "Accept",
          "Origin",
          "Cache-Control",
          "X-File-Name",
        ],
        allowCredentials: true,
        maxAge: 86400, // 24 hours
      },
      hsts: {
        enabled: true,
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      xssProtection: true,
      noSniff: true,
      frameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      permissionsPolicy: {
        geolocation: ["self"],
        microphone: ["none"],
        camera: ["none"],
        payment: ["self"],
        usb: ["none"],
        accelerometer: ["none"],
        gyroscope: ["none"],
        magnetometer: ["none"],
      },
      ...config,
    };
  }

  /**
   * Register security plugins with Fastify
   */
  async register(fastify: FastifyInstance<any, any, any, any, ZodTypeProvider>): Promise<void> {
    // Register helmet for basic security headers
    await fastify.register(helmet, {
      // Disable some helmet defaults we'll handle manually
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,

      // Configure HSTS
      hsts: this.config.hsts.enabled
        ? {
            maxAge: this.config.hsts.maxAge,
            includeSubDomains: this.config.hsts.includeSubDomains,
            preload: this.config.hsts.preload,
          }
        : false,

      // Configure other headers
      noSniff: this.config.noSniff,
      frameguard: {
        action: this.config.frameOptions.toLowerCase() as "deny" | "sameorigin",
      },
      xssFilter: this.config.xssProtection,
      referrerPolicy: {
        policy: this.config.referrerPolicy as
          | "no-referrer"
          | "no-referrer-when-downgrade"
          | "origin"
          | "origin-when-cross-origin"
          | "same-origin"
          | "strict-origin"
          | "strict-origin-when-cross-origin"
          | "unsafe-url",
      },
    });

    // Register CORS
    if (this.config.cors.enabled) {
      await fastify.register(cors, {
        origin: this.config.cors.allowedOrigins,
        methods: this.config.cors.allowedMethods,
        allowedHeaders: this.config.cors.allowedHeaders,
        credentials: this.config.cors.allowCredentials,
        maxAge: this.config.cors.maxAge,
      });
    }

    // Add custom security headers
    fastify.addHook("onSend", async (request, reply, payload) => {
      this.addCustomHeaders(request, reply);
      return payload;
    });
  }

  /**
   * Handle CORS origin validation
   */
  private handleCorsOrigin(
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ): void {
    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Check if origin is in allowed list
    const isAllowed = this.config.cors.allowedOrigins.some((allowedOrigin) => {
      if (allowedOrigin === "*") return true;
      if (allowedOrigin === origin) return true;

      // Support wildcard subdomains
      if (allowedOrigin.startsWith("*.")) {
        const domain = allowedOrigin.slice(2);
        return origin.endsWith(domain);
      }

      return false;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      logger.warn({ origin }, "CORS: Blocked origin");
      callback(new Error(`CORS: Origin ${origin} not allowed`), false);
    }
  }

  /**
   * Add custom security headers
   */
  private addCustomHeaders(request: FastifyRequest, reply: FastifyReply): void {
    // Content Security Policy
    if (this.config.contentSecurityPolicy.enabled) {
      const cspValue = this.buildCSPHeader();
      reply.header("Content-Security-Policy", cspValue);
    }

    // Permissions Policy
    if (Object.keys(this.config.permissionsPolicy).length > 0) {
      const permissionsValue = this.buildPermissionsPolicyHeader();
      reply.header("Permissions-Policy", permissionsValue);
    }

    // Custom headers for API security
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Download-Options", "noopen");
    reply.header("X-Permitted-Cross-Domain-Policies", "none");
    reply.header("Cross-Origin-Embedder-Policy", "require-corp");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");

    // Remove server information
    reply.removeHeader("X-Powered-By");
    reply.removeHeader("Server");

    // Add custom server header
    reply.header("X-API-Version", "1.0");
    reply.header("X-Response-Time", `${Date.now() - (request.startTime || Date.now())}ms`);
  }

  /**
   * Build Content Security Policy header value
   */
  private buildCSPHeader(): string {
    if (!this.config.contentSecurityPolicy.directives) {
      return "default-src 'self'";
    }

    const directives = this.config.contentSecurityPolicy.directives;
    const cspParts: string[] = [];

    for (const [directive, values] of Object.entries(directives)) {
      if (Array.isArray(values) && values.length > 0) {
        cspParts.push(`${directive} ${values.join(" ")}`);
      } else if (
        (typeof values === "boolean" && values === true) ||
        (Array.isArray(values) && values.length === 0)
      ) {
        cspParts.push(directive);
      }
    }

    return cspParts.join("; ");
  }

  /**
   * Build Permissions Policy header value
   */
  private buildPermissionsPolicyHeader(): string {
    const policies: string[] = [];

    for (const [feature, allowlist] of Object.entries(this.config.permissionsPolicy)) {
      if (allowlist.length === 0) {
        policies.push(`${feature}=()`);
      } else {
        const values = allowlist
          .map((value) => (value === "self" ? "self" : `"${value}"`))
          .join(" ");
        policies.push(`${feature}=(${values})`);
      }
    }

    return policies.join(", ");
  }

  /**
   * Validate request for security issues
   */
  validateRequest(request: FastifyRequest): {
    isValid: boolean;
    violations: string[];
  } {
    const violations: string[] = [];

    // Check for common attack patterns
    const userAgent = request.headers["user-agent"] || "";
    const suspiciousPatterns = [
      /sqlmap/i,
      /nmap/i,
      /nikto/i,
      /masscan/i,
      /curl\/7\.[0-9]/i, // Basic curl without custom user agent
    ];

    if (suspiciousPatterns.some((pattern) => pattern.test(userAgent))) {
      violations.push("Suspicious user agent detected");
    }

    // Check for oversized headers
    const maxHeaderSize = 8192; // 8KB
    const headerSize = JSON.stringify(request.headers).length;
    if (headerSize > maxHeaderSize) {
      violations.push("Oversized headers detected");
    }

    // Check for malicious URL patterns
    const url = request.url;
    const maliciousPatterns = [
      /\.\./, // Directory traversal
      /%2e%2e/i, // Encoded directory traversal
      /<script/i, // XSS attempts
      /javascript:/i, // JavaScript protocol
      /data:.*base64/i, // Data URLs
    ];

    if (maliciousPatterns.some((pattern) => pattern.test(url))) {
      violations.push("Malicious URL pattern detected");
    }

    return {
      isValid: violations.length === 0,
      violations,
    };
  }

  /**
   * Create security validation middleware
   */
  createSecurityMiddleware() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Add start time for response time calculation
      request.startTime = Date.now();

      // Validate request
      const validation = this.validateRequest(request);

      if (!validation.isValid) {
        logger.warn(
          {
            ip: request.ip,
            url: request.url,
            userAgent: request.headers["user-agent"],
            violations: validation.violations,
          },
          "Security validation failed"
        );

        // For serious violations, block the request
        const seriousViolations = ["Malicious URL pattern detected"];
        if (validation.violations.some((v) => seriousViolations.includes(v))) {
          reply.code(400).send({
            error: "Bad Request",
            message: "Invalid request format",
          });
          return;
        }
      }

      // Apply security headers
      this.addCustomHeaders(request, reply);
    };
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<SecurityConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * Get current security configuration
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}

/**
 * Pre-configured security setups
 */
export const SecurityConfigs = {
  development: {
    contentSecurityPolicy: {
      enabled: false, // Disabled for easier development
    },
    cors: {
      enabled: true,
      allowedOrigins: ["*"],
      allowCredentials: false,
    },
    hsts: {
      enabled: false,
    },
  },

  production: {
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "https:", "data:"],
        "connect-src": ["'self'", "https:", "wss:"],
        "font-src": ["'self'", "https:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
    cors: {
      enabled: true,
      allowedOrigins: [
        process.env.CLIENT_URL || "https://app.yourapp.com",
        process.env.ADMIN_URL || "https://admin.yourapp.com",
      ],
      allowCredentials: true,
    },
    hsts: {
      enabled: true,
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  },
} as const;
