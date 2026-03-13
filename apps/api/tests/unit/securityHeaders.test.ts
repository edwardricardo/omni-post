#!/usr/bin/env tsx
/**
 * Unit Tests for securityHeaders (SecurityManager)
 * Testing security headers, CSP, CORS, and request validation
 *
 * Coverage Target: 95%+
 */

import { describe, it, expect } from "vitest";
import { SecurityManager, SecurityConfigs } from "../../src/security/securityHeaders.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    id: `req-${Date.now()}`,
    method: "GET",
    url: "/api/test",
    headers: {
      "user-agent": "Mozilla/5.0 (Test Browser)",
    },
    ip: "192.168.1.100",
    socket: { remoteAddress: "192.168.1.100" },
    ...overrides,
  } as FastifyRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
type MockReply = Pick<
  FastifyReply,
  "statusCode" | "getHeader" | "header" | "removeHeader" | "code" | "send" | "sent"
> & {
  body: any;
  getAllHeaders: () => Record<string, string | number>;
};

function createMockReply(): MockReply & FastifyReply {
  const headers: Record<string, string | number> = {};

  const reply: MockReply = {
    statusCode: 200,
    getHeader: (name: string) => headers[name.toLowerCase()],
    header(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
      return reply;
    },
    code(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: any) {
      reply.sent = true;
      reply.body = body;
      return reply;
    },
    sent: false,
    body: null as any,
    getAllHeaders: () => headers,
  };

  return reply as MockReply & FastifyReply;
}

// ============================================================================
// Test Setup
// ============================================================================

let securityManager: SecurityManager;

// ============================================================================
// Main Test Suite
// ============================================================================

describe("SecurityManager Tests", () => {
  // ============================================================================
  // Test Group 1: Initialization and Configuration
  // ============================================================================

  describe("Initialization and Configuration", () => {
    it("should initialize with default config", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config).toBeTruthy();
      expect(config.contentSecurityPolicy.enabled).toBe(true);
      expect(config.cors.enabled).toBe(true);
      expect(config.hsts.enabled).toBe(true);
      expect(config.xssProtection).toBe(true);
      expect(config.noSniff).toBe(true);
      expect(config.frameOptions).toBe("DENY");
    });

    it("should initialize with custom config", () => {
      securityManager = new SecurityManager({
        frameOptions: "SAMEORIGIN",
        xssProtection: false,
      });

      const config = securityManager.getConfig();
      expect(config.frameOptions).toBe("SAMEORIGIN");
      expect(config.xssProtection).toBe(false);
    });

    it("should update config at runtime", () => {
      securityManager = new SecurityManager();

      securityManager.updateConfig({
        frameOptions: "SAMEORIGIN",
      });

      const config = securityManager.getConfig();
      expect(config.frameOptions).toBe("SAMEORIGIN");
    });

    it("should have development config preset", () => {
      const devConfig = SecurityConfigs.development;

      expect(devConfig.contentSecurityPolicy.enabled).toBe(false);
      expect(devConfig.cors.enabled).toBe(true);
      expect(devConfig.hsts.enabled).toBe(false);
    });

    it("should have production config preset", () => {
      const prodConfig = SecurityConfigs.production;

      expect(prodConfig.contentSecurityPolicy.enabled).toBe(true);
      expect(prodConfig.cors.enabled).toBe(true);
      expect(prodConfig.hsts.enabled).toBe(true);
      expect(prodConfig.hsts.preload).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 2: CSP Header Building
  // ============================================================================

  describe("CSP Header Building", () => {
    it("should build CSP header with default directives", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      // Access private method via middleware
      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const csp = reply.getHeader("content-security-policy");
      expect(csp).toBeTruthy();
      expect(typeof csp === "string").toBeTruthy();
      expect(csp.includes("default-src")).toBeTruthy();
    });

    it("should build CSP with custom directives", () => {
      securityManager = new SecurityManager({
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://trusted.cdn.com"],
            "style-src": ["'self'", "'unsafe-inline'"],
          },
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const csp = reply.getHeader("content-security-policy") as string;
      expect(csp.includes("default-src 'self'")).toBeTruthy();
      expect(csp.includes("script-src 'self' https://trusted.cdn.com")).toBeTruthy();
      expect(csp.includes("style-src 'self' 'unsafe-inline'")).toBeTruthy();
    });

    it("should handle empty directive arrays", () => {
      securityManager = new SecurityManager({
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "upgrade-insecure-requests": [],
          },
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const csp = reply.getHeader("content-security-policy") as string;
      expect(csp.includes("upgrade-insecure-requests")).toBeTruthy();
    });

    it("should disable CSP when configured", () => {
      securityManager = new SecurityManager({
        contentSecurityPolicy: {
          enabled: false,
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const csp = reply.getHeader("content-security-policy");
      expect(csp).toBe(undefined);
    });
  });

  // ============================================================================
  // Test Group 3: Permissions Policy Header
  // ============================================================================

  describe("Permissions Policy Header", () => {
    it("should build Permissions-Policy header", () => {
      securityManager = new SecurityManager({
        permissionsPolicy: {
          geolocation: ["self"],
          microphone: [],
          camera: [],
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const policy = reply.getHeader("permissions-policy") as string;
      expect(policy).toBeTruthy();
      expect(policy.includes("geolocation=(self)")).toBeTruthy();
      expect(policy.includes("microphone=()")).toBeTruthy();
      expect(policy.includes("camera=()")).toBeTruthy();
    });

    it("should handle empty allowlist", () => {
      securityManager = new SecurityManager({
        permissionsPolicy: {
          payment: [],
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const policy = reply.getHeader("permissions-policy") as string;
      expect(policy.includes("payment=()")).toBeTruthy();
    });

    it("should handle multiple sources", () => {
      securityManager = new SecurityManager({
        permissionsPolicy: {
          geolocation: ["self", "https://maps.example.com"],
        },
      });

      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const policy = reply.getHeader("permissions-policy") as string;
      expect(policy.includes("geolocation=(self")).toBeTruthy();
    });
  });

  // ============================================================================
  // Test Group 4: Security Headers Application
  // ============================================================================

  describe("Security Headers Application", () => {
    it("should apply X-Content-Type-Options header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("x-content-type-options")).toBe("nosniff");
    });

    it("should apply X-Download-Options header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("x-download-options")).toBe("noopen");
    });

    it("should apply X-Permitted-Cross-Domain-Policies header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("x-permitted-cross-domain-policies")).toBe("none");
    });

    it("should apply Cross-Origin headers", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("cross-origin-embedder-policy")).toBe("require-corp");
      expect(reply.getHeader("cross-origin-opener-policy")).toBe("same-origin");
      expect(reply.getHeader("cross-origin-resource-policy")).toBe("cross-origin");
    });

    it("should remove X-Powered-By header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();
      reply.header("X-Powered-By", "Express");

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("x-powered-by")).toBe(undefined);
    });

    it("should remove Server header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();
      reply.header("Server", "nginx/1.0");

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("server")).toBe(undefined);
    });

    it("should add X-API-Version header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      expect(reply.getHeader("x-api-version")).toBe("1.0");
    });

    it("should add X-Response-Time header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      (request as any).startTime = Date.now();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const responseTime = reply.getHeader("x-response-time");
      expect(responseTime).toBeTruthy();
      expect(typeof responseTime === "string").toBeTruthy();
      expect(responseTime.includes("ms")).toBeTruthy();
    });
  });

  // ============================================================================
  // Test Group 5: Request Validation
  // ============================================================================

  describe("Request Validation", () => {
    it("should validate normal request successfully", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(true);
      expect(validation.violations.length).toBe(0);
    });

    it("should detect suspicious user agents", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "sqlmap/1.0" },
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Suspicious user agent detected")).toBeTruthy();
    });

    it("should detect nmap user agent", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "Nmap Scripting Engine" },
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Suspicious user agent detected")).toBeTruthy();
    });

    it("should detect nikto user agent", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "Nikto/2.1.5" },
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
    });

    it("should detect directory traversal in URL", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/files/../../../etc/passwd",
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Malicious URL pattern detected")).toBeTruthy();
    });

    it("should detect encoded directory traversal", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/files/%2e%2e/%2e%2e/etc/passwd",
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Malicious URL pattern detected")).toBeTruthy();
    });

    it("should detect XSS attempts in URL", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/search?q=<script>alert('xss')</script>",
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Malicious URL pattern detected")).toBeTruthy();
    });

    it("should detect javascript: protocol", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/redirect?url=javascript:alert('xss')",
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
    });

    it("should detect data URLs", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/image?src=data:image/png;base64,iVBORw0KG",
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
    });

    it("should detect oversized headers", () => {
      securityManager = new SecurityManager();
      const largeHeader = "x".repeat(9000);
      const request = createMockRequest({
        headers: {
          "x-custom-header": largeHeader,
          "user-agent": "Test",
        },
      });

      const validation = securityManager.validateRequest(request);

      expect(validation.isValid).toBe(false);
      expect(validation.violations.includes("Oversized headers detected")).toBeTruthy();
    });
  });

  // ============================================================================
  // Test Group 6: Security Middleware Integration
  // ============================================================================

  describe("Security Middleware Integration", () => {
    it("should create security middleware", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      expect(middleware).toBeTruthy();
      expect(typeof middleware).toBe("function");
    });

    it("should allow valid requests through middleware", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect((request as any).startTime > 0).toBe(true);
      expect(reply.sent).toBe(false);
    });

    it("should block malicious URL patterns", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      const request = createMockRequest({
        url: "/api/../../../etc/passwd",
      });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.sent).toBe(true);
      expect(reply.statusCode).toBe(400);
      expect(reply.body?.error).toBeTruthy();
    });

    it("should warn about suspicious user agents", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      const request = createMockRequest({
        headers: { "user-agent": "curl/7.0" },
      });
      const reply = createMockReply();

      await middleware(request, reply);

      // Should warn but not block (not a serious violation)
      expect((request as any).startTime > 0).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 7: CORS Configuration
  // ============================================================================

  describe("CORS Configuration", () => {
    it("should have default CORS origins", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.cors.allowedOrigins.includes("http://localhost:3000")).toBeTruthy();
      expect(config.cors.allowedOrigins.includes("http://localhost:3100")).toBeTruthy();
      expect(config.cors.allowedOrigins.includes("http://localhost:3200")).toBeTruthy();
    });

    it("should have default CORS methods", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.cors.allowedMethods.includes("GET")).toBeTruthy();
      expect(config.cors.allowedMethods.includes("POST")).toBeTruthy();
      expect(config.cors.allowedMethods.includes("PUT")).toBeTruthy();
      expect(config.cors.allowedMethods.includes("DELETE")).toBeTruthy();
      expect(config.cors.allowedMethods.includes("PATCH")).toBeTruthy();
    });

    it("should have default CORS headers", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.cors.allowedHeaders.includes("Content-Type")).toBeTruthy();
      expect(config.cors.allowedHeaders.includes("Authorization")).toBeTruthy();
    });

    it("should allow credentials by default", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.cors.allowCredentials).toBe(true);
    });

    it("should have 24-hour max age", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.cors.maxAge).toBe(86400);
    });
  });

  // ============================================================================
  // Test Group 8: HSTS Configuration
  // ============================================================================

  describe("HSTS Configuration", () => {
    it("should enable HSTS by default", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.hsts.enabled).toBe(true);
      expect(config.hsts.maxAge).toBe(31536000); // 1 year
      expect(config.hsts.includeSubDomains).toBe(true);
      expect(config.hsts.preload).toBe(true);
    });

    it("should allow disabling HSTS", () => {
      securityManager = new SecurityManager({
        hsts: {
          enabled: false,
          maxAge: 0,
          includeSubDomains: false,
          preload: false,
        },
      });

      const config = securityManager.getConfig();
      expect(config.hsts.enabled).toBe(false);
    });

    it("should allow custom HSTS maxAge", () => {
      securityManager = new SecurityManager({
        hsts: {
          enabled: true,
          maxAge: 15552000, // 6 months
          includeSubDomains: true,
          preload: false,
        },
      });

      const config = securityManager.getConfig();
      expect(config.hsts.maxAge).toBe(15552000);
    });
  });

  // ============================================================================
  // Test Group 9: Frame Options
  // ============================================================================

  describe("Frame Options", () => {
    it("should default to DENY", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.frameOptions).toBe("DENY");
    });

    it("should allow SAMEORIGIN", () => {
      securityManager = new SecurityManager({
        frameOptions: "SAMEORIGIN",
      });

      const config = securityManager.getConfig();
      expect(config.frameOptions).toBe("SAMEORIGIN");
    });

    it("should allow ALLOW-FROM", () => {
      securityManager = new SecurityManager({
        frameOptions: "ALLOW-FROM",
      });

      const config = securityManager.getConfig();
      expect(config.frameOptions).toBe("ALLOW-FROM");
    });
  });

  // ============================================================================
  // Test Group 10: Referrer Policy
  // ============================================================================

  describe("Referrer Policy", () => {
    it("should default to strict-origin-when-cross-origin", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      expect(config.referrerPolicy).toBe("strict-origin-when-cross-origin");
    });

    it("should allow custom referrer policy", () => {
      securityManager = new SecurityManager({
        referrerPolicy: "no-referrer",
      });

      const config = securityManager.getConfig();
      expect(config.referrerPolicy).toBe("no-referrer");
    });
  });
});
