/**
 * @file securityHeaders.ts
 * @description Security headers configuration applying helmet, HSTS, CSP,
 *              X-Frame-Options, and permissions policy to Fastify responses.
 *              The API sends no CORS header: no browser calls it cross-origin,
 *              since both portals call their own `/api/backend/*` and their
 *              servers call the API. A feature that needs a cross-origin caller
 *              defines its own policy for its routes.
 * @layer infrastructure
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import helmet from "@fastify/helmet";
import { logger } from "../lib/logger.js";

export interface SecurityConfig {
  contentSecurityPolicy: {
    enabled: boolean;
    directives?: Record<string, string | string[]>;
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
   * @method register
   * @description Registers helmet and the hook that adds the custom security
   *              headers to every response the app sends through `reply.send`.
   * @param fastify - The app whose responses carry the headers
   * @returns Resolves once both are registered
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

    // Add custom security headers
    fastify.addHook("onSend", async (request, reply, payload) => {
      this.addCustomHeaders(request, reply);
      return payload;
    });
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

    // Default every response to uncacheable, and ONLY when the route has not
    // already spoken. This API serves authenticated JSON: without a directive a
    // shared intermediary may store a response keyed by URL and hand one
    // tenant's body to the next caller, which is why the ZAP baseline reports
    // "Storable and Cacheable Content" (10049) against it.
    //
    // `hasHeader` is the load-bearing half. `reply.header()` overwrites, and
    // three route families already set their own policy deliberately
    // (notifications, analytics, the webhook dashboard); silently replacing
    // theirs would trade one defect for another.
    if (!reply.hasHeader("Cache-Control")) {
      reply.header("Cache-Control", "no-store");
    }

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
   * @method validateRequest
   * @description Checks a request's user agent, header size and URL against
   *              known attack patterns.
   * @param request - The request to check
   * @returns Whether the request is clean, and the violations found
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
   * @method createSecurityMiddleware
   * @description Builds a hook that stamps the request's start time, refuses a
   *              request whose URL matches a malicious pattern with 400, and
   *              adds the custom security headers.
   * @returns The hook
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
   * @method updateConfig
   * @description Replaces the top-level sections of the configuration that the
   *              argument names; a section it omits keeps its current value.
   * @param newConfig - The sections to replace
   */
  updateConfig(newConfig: Partial<SecurityConfig>): void {
    this.config = {
      ...this.config,
      ...newConfig,
    };
  }

  /**
   * @method getConfig
   * @description Returns a shallow copy of the configuration in force.
   * @returns The current configuration
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }
}
