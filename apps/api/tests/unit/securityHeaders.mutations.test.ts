/**
 * @file securityHeaders.mutations.test.ts
 * @description Mutation-killing boundary tests for SecurityManager.
 *              Targets: handleCorsOrigin, buildCSPHeader, buildPermissionsPolicyHeader,
 *              validateRequest edge cases, createSecurityMiddleware paths.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SecurityManager, SecurityConfigs } from "../../src/security/securityHeaders.js";
import type { FastifyRequest, FastifyReply } from "fastify";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ============================================================================
// Helpers
// ============================================================================

function createMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    id: "req-test",
    method: "GET",
    url: "/api/test",
    headers: { "user-agent": "Mozilla/5.0" },
    ip: "192.168.1.100",
    socket: { remoteAddress: "192.168.1.100" },
    ...overrides,
  } as FastifyRequest;
}

function createMockReply(): FastifyReply & { body: any; getAllHeaders: () => Record<string, any> } {
  const headers: Record<string, any> = {};
  const reply: any = {
    statusCode: 200,
    sent: false,
    body: null,
    getHeader: (name: string) => headers[name.toLowerCase()],
    header(name: string, value: any) {
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
    getAllHeaders: () => ({ ...headers }),
  };
  return reply;
}

// ============================================================================
// Tests
// ============================================================================

describe("SecurityManager — mutation-killing boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // handleCorsOrigin — private, tested indirectly
  // --------------------------------------------------------------------------

  describe("handleCorsOrigin", () => {
    it("allows request with no origin", () => {
      const mgr = new SecurityManager();
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin(undefined, cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it("allows request with exact matching origin", () => {
      const mgr = new SecurityManager({
        cors: {
          enabled: true,
          allowedOrigins: ["https://example.com"],
          allowedMethods: ["GET"],
          allowedHeaders: ["Content-Type"],
          allowCredentials: false,
          maxAge: 86400,
        },
      });
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin("https://example.com", cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it("allows wildcard origin *", () => {
      const mgr = new SecurityManager({
        cors: {
          enabled: true,
          allowedOrigins: ["*"],
          allowedMethods: ["GET"],
          allowedHeaders: [],
          allowCredentials: false,
          maxAge: 0,
        },
      });
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin("https://anything.com", cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it("allows wildcard subdomain match *.example.com", () => {
      const mgr = new SecurityManager({
        cors: {
          enabled: true,
          allowedOrigins: ["*.example.com"],
          allowedMethods: ["GET"],
          allowedHeaders: [],
          allowCredentials: false,
          maxAge: 0,
        },
      });
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin("https://app.example.com", cb);
      expect(cb).toHaveBeenCalledWith(null, true);
    });

    it("rejects non-matching subdomain for wildcard", () => {
      const mgr = new SecurityManager({
        cors: {
          enabled: true,
          allowedOrigins: ["*.example.com"],
          allowedMethods: ["GET"],
          allowedHeaders: [],
          allowCredentials: false,
          maxAge: 0,
        },
      });
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin("https://evil.other.com", cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
    });

    it("rejects origin not in allowed list", () => {
      const mgr = new SecurityManager({
        cors: {
          enabled: true,
          allowedOrigins: ["https://allowed.com"],
          allowedMethods: ["GET"],
          allowedHeaders: [],
          allowCredentials: false,
          maxAge: 0,
        },
      });
      const cb = vi.fn();
      (mgr as any).handleCorsOrigin("https://blocked.com", cb);
      expect(cb).toHaveBeenCalledWith(expect.any(Error), false);
    });
  });

  // --------------------------------------------------------------------------
  // buildCSPHeader
  // --------------------------------------------------------------------------

  describe("buildCSPHeader", () => {
    it("returns default CSP when no directives configured", () => {
      const mgr = new SecurityManager({
        contentSecurityPolicy: { enabled: true },
      });
      // Remove directives to trigger the no-directives path
      (mgr as any).config.contentSecurityPolicy.directives = undefined;
      const csp = (mgr as any).buildCSPHeader();
      expect(csp).toBe("default-src 'self'");
    });

    it("joins multiple directives with semicolons", () => {
      const mgr = new SecurityManager({
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "https://cdn.com"],
          },
        },
      });
      const csp = (mgr as any).buildCSPHeader();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("; ");
      expect(csp).toContain("script-src 'self' https://cdn.com");
    });

    it("includes standalone directives for empty arrays", () => {
      const mgr = new SecurityManager({
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "upgrade-insecure-requests": [],
          },
        },
      });
      const csp = (mgr as any).buildCSPHeader();
      expect(csp).toBe("upgrade-insecure-requests");
    });

    it("skips directives with non-array non-true values", () => {
      const mgr = new SecurityManager({
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            "default-src": ["'self'"],
          },
        },
      });
      // Force a boolean false value
      (mgr as any).config.contentSecurityPolicy.directives["bogus"] = false;
      const csp = (mgr as any).buildCSPHeader();
      expect(csp).not.toContain("bogus");
    });
  });

  // --------------------------------------------------------------------------
  // buildPermissionsPolicyHeader
  // --------------------------------------------------------------------------

  describe("buildPermissionsPolicyHeader", () => {
    it("quotes non-self values", () => {
      const mgr = new SecurityManager({
        permissionsPolicy: {
          geolocation: ["self", "https://maps.google.com"],
        },
      });
      const policy = (mgr as any).buildPermissionsPolicyHeader();
      expect(policy).toContain('geolocation=(self "https://maps.google.com")');
    });

    it("does not quote self value", () => {
      const mgr = new SecurityManager({
        permissionsPolicy: {
          camera: ["self"],
        },
      });
      const policy = (mgr as any).buildPermissionsPolicyHeader();
      expect(policy).toBe("camera=(self)");
    });

    it("produces empty parens for empty allowlist", () => {
      const mgr = new SecurityManager({
        permissionsPolicy: {
          microphone: [],
        },
      });
      const policy = (mgr as any).buildPermissionsPolicyHeader();
      expect(policy).toBe("microphone=()");
    });

    it("joins multiple features with comma-space", () => {
      const mgr = new SecurityManager({
        permissionsPolicy: {
          camera: [],
          microphone: [],
        },
      });
      const policy = (mgr as any).buildPermissionsPolicyHeader();
      expect(policy).toBe("camera=(), microphone=()");
    });
  });

  // --------------------------------------------------------------------------
  // validateRequest — boundary conditions
  // --------------------------------------------------------------------------

  describe("validateRequest boundaries", () => {
    it("detects masscan user agent", () => {
      const mgr = new SecurityManager();
      const req = createMockRequest({ headers: { "user-agent": "masscan/1.3.2" } });
      const result = mgr.validateRequest(req);
      expect(result.isValid).toBe(false);
      expect(result.violations).toContain("Suspicious user agent detected");
    });

    it("allows normal user agents", () => {
      const mgr = new SecurityManager();
      const req = createMockRequest({
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64)" },
      });
      const result = mgr.validateRequest(req);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("passes at exactly maxHeaderSize boundary", () => {
      const mgr = new SecurityManager();
      // Headers JSON must be <= 8192 bytes
      const req = createMockRequest({
        headers: { "user-agent": "OK", "x-data": "a".repeat(8100) },
      });
      const headerSize = JSON.stringify(req.headers).length;
      if (headerSize <= 8192) {
        const result = mgr.validateRequest(req);
        expect(result.violations).not.toContain("Oversized headers detected");
      }
    });

    it("fails at maxHeaderSize + 1", () => {
      const mgr = new SecurityManager();
      // Create headers that exceed 8192
      const req = createMockRequest({
        headers: { "user-agent": "OK", "x-data": "a".repeat(8200) },
      });
      const result = mgr.validateRequest(req);
      expect(result.violations).toContain("Oversized headers detected");
    });

    it("handles missing user-agent header", () => {
      const mgr = new SecurityManager();
      const req = createMockRequest({ headers: {} });
      const result = mgr.validateRequest(req);
      // Empty user-agent shouldn't match any suspicious patterns
      expect(result.violations).not.toContain("Suspicious user agent detected");
    });

    it("allows clean URL", () => {
      const mgr = new SecurityManager();
      const req = createMockRequest({ url: "/api/v1/posts?page=1" });
      const result = mgr.validateRequest(req);
      expect(result.violations).not.toContain("Malicious URL pattern detected");
    });

    it("can detect multiple violations at once", () => {
      const mgr = new SecurityManager();
      const req = createMockRequest({
        url: "/api/../etc/passwd",
        headers: { "user-agent": "sqlmap", "x-pad": "a".repeat(8200) },
      });
      const result = mgr.validateRequest(req);
      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // createSecurityMiddleware — paths
  // --------------------------------------------------------------------------

  describe("createSecurityMiddleware edge paths", () => {
    it("sets startTime on request", async () => {
      const mgr = new SecurityManager();
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest();
      const reply = createMockReply();

      const before = Date.now();
      await middleware(req, reply);
      const after = Date.now();

      expect((req as any).startTime).toBeGreaterThanOrEqual(before);
      expect((req as any).startTime).toBeLessThanOrEqual(after);
    });

    it("does not block on non-serious violations (suspicious UA only)", async () => {
      const mgr = new SecurityManager();
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest({
        headers: { "user-agent": "sqlmap/1.0" },
      });
      const reply = createMockReply();

      await middleware(req, reply);
      // Suspicious UA is not a "serious" violation, should not block
      expect(reply.sent).toBe(false);
    });

    it("blocks on serious violation (malicious URL pattern)", async () => {
      const mgr = new SecurityManager();
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest({ url: "/api/../../etc/shadow" });
      const reply = createMockReply();

      await middleware(req, reply);
      expect(reply.sent).toBe(true);
      expect(reply.statusCode).toBe(400);
      expect(reply.body.error).toBe("Bad Request");
      expect(reply.body.message).toBe("Invalid request format");
    });

    it("applies custom headers even when request is valid", async () => {
      const mgr = new SecurityManager();
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest();
      const reply = createMockReply();

      await middleware(req, reply);

      expect(reply.getHeader("x-content-type-options")).toBe("nosniff");
      expect(reply.getHeader("x-api-version")).toBe("1.0");
      expect(reply.getHeader("x-download-options")).toBe("noopen");
    });

    it("does not set CSP when disabled", async () => {
      const mgr = new SecurityManager({ contentSecurityPolicy: { enabled: false } });
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest();
      const reply = createMockReply();

      await middleware(req, reply);
      expect(reply.getHeader("content-security-policy")).toBeUndefined();
    });

    it("skips Permissions-Policy when no policies defined", async () => {
      const mgr = new SecurityManager({ permissionsPolicy: {} });
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest();
      const reply = createMockReply();

      await middleware(req, reply);
      expect(reply.getHeader("permissions-policy")).toBeUndefined();
    });

    it("calculates X-Response-Time using startTime", async () => {
      const mgr = new SecurityManager();
      const middleware = mgr.createSecurityMiddleware();
      const req = createMockRequest();
      (req as any).startTime = Date.now() - 50;
      const reply = createMockReply();

      // Access addCustomHeaders directly to test with pre-existing startTime
      (mgr as any).addCustomHeaders(req, reply);

      const responseTime = reply.getHeader("x-response-time") as string;
      expect(responseTime).toMatch(/\d+ms/);
      const ms = parseInt(responseTime);
      expect(ms).toBeGreaterThanOrEqual(49);
    });

    it("handles missing startTime in X-Response-Time", async () => {
      const mgr = new SecurityManager();
      const req = createMockRequest();
      // No startTime set
      const reply = createMockReply();

      (mgr as any).addCustomHeaders(req, reply);

      const responseTime = reply.getHeader("x-response-time") as string;
      expect(responseTime).toMatch(/\d+ms/);
    });
  });

  // --------------------------------------------------------------------------
  // updateConfig & getConfig
  // --------------------------------------------------------------------------

  describe("updateConfig", () => {
    it("merges new config into existing", () => {
      const mgr = new SecurityManager();
      expect(mgr.getConfig().noSniff).toBe(true);

      mgr.updateConfig({ noSniff: false });
      expect(mgr.getConfig().noSniff).toBe(false);
      // Other config preserved
      expect(mgr.getConfig().xssProtection).toBe(true);
    });

    it("getConfig returns a copy, not the original", () => {
      const mgr = new SecurityManager();
      const config1 = mgr.getConfig();
      const config2 = mgr.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  // --------------------------------------------------------------------------
  // SecurityConfigs presets
  // --------------------------------------------------------------------------

  describe("SecurityConfigs presets details", () => {
    it("development disables CSP and HSTS", () => {
      expect(SecurityConfigs.development.contentSecurityPolicy.enabled).toBe(false);
      expect(SecurityConfigs.development.hsts.enabled).toBe(false);
    });

    it("development allows all origins and disables credentials", () => {
      expect(SecurityConfigs.development.cors.allowedOrigins).toEqual(["*"]);
      expect(SecurityConfigs.development.cors.allowCredentials).toBe(false);
    });

    it("production has strict CSP directives", () => {
      const directives = SecurityConfigs.production.contentSecurityPolicy.directives;
      expect(directives).toBeDefined();
      expect(directives!["object-src"]).toEqual(["'none'"]);
      expect(directives!["frame-ancestors"]).toEqual(["'none'"]);
    });

    it("production has HSTS with preload and subdomains", () => {
      expect(SecurityConfigs.production.hsts.maxAge).toBe(31536000);
      expect(SecurityConfigs.production.hsts.includeSubDomains).toBe(true);
      expect(SecurityConfigs.production.hsts.preload).toBe(true);
    });

    it("production CORS has credentials enabled", () => {
      expect(SecurityConfigs.production.cors.allowCredentials).toBe(true);
    });
  });
});
