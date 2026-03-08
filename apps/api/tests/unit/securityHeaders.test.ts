#!/usr/bin/env tsx
/**
 * Unit Tests for securityHeaders (SecurityManager)
 * Testing security headers, CSP, CORS, and request validation
 *
 * Coverage Target: 95%+
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

      assert.ok(config);
      assert.strictEqual(config.contentSecurityPolicy.enabled, true);
      assert.strictEqual(config.cors.enabled, true);
      assert.strictEqual(config.hsts.enabled, true);
      assert.strictEqual(config.xssProtection, true);
      assert.strictEqual(config.noSniff, true);
      assert.strictEqual(config.frameOptions, "DENY");
    });

    it("should initialize with custom config", () => {
      securityManager = new SecurityManager({
        frameOptions: "SAMEORIGIN",
        xssProtection: false,
      });

      const config = securityManager.getConfig();
      assert.strictEqual(config.frameOptions, "SAMEORIGIN");
      assert.strictEqual(config.xssProtection, false);
    });

    it("should update config at runtime", () => {
      securityManager = new SecurityManager();

      securityManager.updateConfig({
        frameOptions: "SAMEORIGIN",
      });

      const config = securityManager.getConfig();
      assert.strictEqual(config.frameOptions, "SAMEORIGIN");
    });

    it("should have development config preset", () => {
      const devConfig = SecurityConfigs.development;

      assert.strictEqual(devConfig.contentSecurityPolicy.enabled, false);
      assert.strictEqual(devConfig.cors.enabled, true);
      assert.strictEqual(devConfig.hsts.enabled, false);
    });

    it("should have production config preset", () => {
      const prodConfig = SecurityConfigs.production;

      assert.strictEqual(prodConfig.contentSecurityPolicy.enabled, true);
      assert.strictEqual(prodConfig.cors.enabled, true);
      assert.strictEqual(prodConfig.hsts.enabled, true);
      assert.strictEqual(prodConfig.hsts.preload, true);
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
      assert.ok(csp);
      assert.ok(typeof csp === "string");
      assert.ok(csp.includes("default-src"));
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
      assert.ok(csp.includes("default-src 'self'"));
      assert.ok(csp.includes("script-src 'self' https://trusted.cdn.com"));
      assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
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
      assert.ok(csp.includes("upgrade-insecure-requests"));
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
      assert.strictEqual(csp, undefined);
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
      assert.ok(policy);
      assert.ok(policy.includes("geolocation=(self)"));
      assert.ok(policy.includes("microphone=()"));
      assert.ok(policy.includes("camera=()"));
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
      assert.ok(policy.includes("payment=()"));
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
      assert.ok(policy.includes("geolocation=(self"));
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

      assert.strictEqual(reply.getHeader("x-content-type-options"), "nosniff");
    });

    it("should apply X-Download-Options header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("x-download-options"), "noopen");
    });

    it("should apply X-Permitted-Cross-Domain-Policies header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("x-permitted-cross-domain-policies"), "none");
    });

    it("should apply Cross-Origin headers", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("cross-origin-embedder-policy"), "require-corp");
      assert.strictEqual(reply.getHeader("cross-origin-opener-policy"), "same-origin");
      assert.strictEqual(reply.getHeader("cross-origin-resource-policy"), "cross-origin");
    });

    it("should remove X-Powered-By header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();
      reply.header("X-Powered-By", "Express");

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("x-powered-by"), undefined);
    });

    it("should remove Server header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();
      reply.header("Server", "nginx/1.0");

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("server"), undefined);
    });

    it("should add X-API-Version header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      assert.strictEqual(reply.getHeader("x-api-version"), "1.0");
    });

    it("should add X-Response-Time header", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest();
      (request as any).startTime = Date.now();
      const reply = createMockReply();

      const middleware = securityManager.createSecurityMiddleware();
      middleware(request, reply);

      const responseTime = reply.getHeader("x-response-time");
      assert.ok(responseTime);
      assert.ok(typeof responseTime === "string");
      assert.ok(responseTime.includes("ms"));
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

      assert.strictEqual(validation.isValid, true);
      assert.strictEqual(validation.violations.length, 0);
    });

    it("should detect suspicious user agents", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "sqlmap/1.0" },
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Suspicious user agent detected"));
    });

    it("should detect nmap user agent", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "Nmap Scripting Engine" },
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Suspicious user agent detected"));
    });

    it("should detect nikto user agent", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        headers: { "user-agent": "Nikto/2.1.5" },
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
    });

    it("should detect directory traversal in URL", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/files/../../../etc/passwd",
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Malicious URL pattern detected"));
    });

    it("should detect encoded directory traversal", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/files/%2e%2e/%2e%2e/etc/passwd",
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Malicious URL pattern detected"));
    });

    it("should detect XSS attempts in URL", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/search?q=<script>alert('xss')</script>",
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Malicious URL pattern detected"));
    });

    it("should detect javascript: protocol", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/redirect?url=javascript:alert('xss')",
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
    });

    it("should detect data URLs", () => {
      securityManager = new SecurityManager();
      const request = createMockRequest({
        url: "/api/image?src=data:image/png;base64,iVBORw0KG",
      });

      const validation = securityManager.validateRequest(request);

      assert.strictEqual(validation.isValid, false);
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

      assert.strictEqual(validation.isValid, false);
      assert.ok(validation.violations.includes("Oversized headers detected"));
    });
  });

  // ============================================================================
  // Test Group 6: Security Middleware Integration
  // ============================================================================

  describe("Security Middleware Integration", () => {
    it("should create security middleware", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      assert.ok(middleware);
      assert.strictEqual(typeof middleware, "function");
    });

    it("should allow valid requests through middleware", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      assert.strictEqual((request as any).startTime > 0, true);
      assert.strictEqual(reply.sent, false);
    });

    it("should block malicious URL patterns", async () => {
      securityManager = new SecurityManager();
      const middleware = securityManager.createSecurityMiddleware();

      const request = createMockRequest({
        url: "/api/../../../etc/passwd",
      });
      const reply = createMockReply();

      await middleware(request, reply);

      assert.strictEqual(reply.sent, true);
      assert.strictEqual(reply.statusCode, 400);
      assert.ok(reply.body?.error);
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
      assert.strictEqual((request as any).startTime > 0, true);
    });
  });

  // ============================================================================
  // Test Group 7: CORS Configuration
  // ============================================================================

  describe("CORS Configuration", () => {
    it("should have default CORS origins", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.ok(config.cors.allowedOrigins.includes("http://localhost:3000"));
      assert.ok(config.cors.allowedOrigins.includes("http://localhost:3100"));
      assert.ok(config.cors.allowedOrigins.includes("http://localhost:3200"));
    });

    it("should have default CORS methods", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.ok(config.cors.allowedMethods.includes("GET"));
      assert.ok(config.cors.allowedMethods.includes("POST"));
      assert.ok(config.cors.allowedMethods.includes("PUT"));
      assert.ok(config.cors.allowedMethods.includes("DELETE"));
      assert.ok(config.cors.allowedMethods.includes("PATCH"));
    });

    it("should have default CORS headers", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.ok(config.cors.allowedHeaders.includes("Content-Type"));
      assert.ok(config.cors.allowedHeaders.includes("Authorization"));
    });

    it("should allow credentials by default", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.strictEqual(config.cors.allowCredentials, true);
    });

    it("should have 24-hour max age", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.strictEqual(config.cors.maxAge, 86400);
    });
  });

  // ============================================================================
  // Test Group 8: HSTS Configuration
  // ============================================================================

  describe("HSTS Configuration", () => {
    it("should enable HSTS by default", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.strictEqual(config.hsts.enabled, true);
      assert.strictEqual(config.hsts.maxAge, 31536000); // 1 year
      assert.strictEqual(config.hsts.includeSubDomains, true);
      assert.strictEqual(config.hsts.preload, true);
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
      assert.strictEqual(config.hsts.enabled, false);
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
      assert.strictEqual(config.hsts.maxAge, 15552000);
    });
  });

  // ============================================================================
  // Test Group 9: Frame Options
  // ============================================================================

  describe("Frame Options", () => {
    it("should default to DENY", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.strictEqual(config.frameOptions, "DENY");
    });

    it("should allow SAMEORIGIN", () => {
      securityManager = new SecurityManager({
        frameOptions: "SAMEORIGIN",
      });

      const config = securityManager.getConfig();
      assert.strictEqual(config.frameOptions, "SAMEORIGIN");
    });

    it("should allow ALLOW-FROM", () => {
      securityManager = new SecurityManager({
        frameOptions: "ALLOW-FROM",
      });

      const config = securityManager.getConfig();
      assert.strictEqual(config.frameOptions, "ALLOW-FROM");
    });
  });

  // ============================================================================
  // Test Group 10: Referrer Policy
  // ============================================================================

  describe("Referrer Policy", () => {
    it("should default to strict-origin-when-cross-origin", () => {
      securityManager = new SecurityManager();
      const config = securityManager.getConfig();

      assert.strictEqual(config.referrerPolicy, "strict-origin-when-cross-origin");
    });

    it("should allow custom referrer policy", () => {
      securityManager = new SecurityManager({
        referrerPolicy: "no-referrer",
      });

      const config = securityManager.getConfig();
      assert.strictEqual(config.referrerPolicy, "no-referrer");
    });
  });
});
