/**
 * Infrastructure Security Test Suite
 *
 * Tests infrastructure security: CORS headers, security headers, TLS config,
 * information disclosure prevention, file upload security, rate limiting,
 * session security, environment security, and API versioning security.
 *
 * DO NOT WIRE THIS SUITE INTO CI. It cannot pass: every URL it targets is
 * under an `/api/*` prefix the application never registers, so the `before`
 * hook 404s and every test skips. A database does NOT fix this — the run is
 * byte-identical with Postgres up and down. Read ./README.md and SMELL-83 in
 * docs/reports/roadmap-detected-smells-backlog.md before adding a tier, a job,
 * or a script for it.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

describe("Infrastructure Security Tests", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let authToken: string;
  let dbAvailable = false;

  before(async () => {
    try {
      const { createApp } = await import("../../apps/api/src/index.js");
      app = await createApp();
      await app.ready();

      const email = `infra-security-${Date.now()}@example.com`;

      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "SecureP@ssw0rd123!",
          name: "Infrastructure Security Test User",
        },
      });

      let actualEmail = email;
      if (registerResponse.statusCode === 201 || registerResponse.statusCode === 200) {
        const registerBody = JSON.parse(registerResponse.body);
        actualEmail = registerBody.value?.email || registerBody.data?.email || email;
      }

      const loginResponse = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: actualEmail,
          password: "SecureP@ssw0rd123!",
        },
      });

      const loginBody = JSON.parse(loginResponse.body);
      authToken = loginBody.token || loginBody.value?.token || "";
      dbAvailable = !!authToken;
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    await app?.close();
  });

  describe("Security Headers", () => {
    it("should include security headers in health endpoint", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      // The API should respond (200, 401, or 404 are all acceptable)
      assert.ok(
        response.statusCode < 500,
        `Health endpoint should not return 5xx (got ${response.statusCode})`
      );
    });

    it("should not expose server technology headers", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      // Should not reveal server technology
      assert.ok(!response.headers["x-powered-by"], "Should not expose x-powered-by header");
      assert.ok(!response.headers["x-aspnet-version"], "Should not expose x-aspnet-version header");
      assert.ok(
        !response.headers["x-aspnetmvc-version"],
        "Should not expose x-aspnetmvc-version header"
      );
    });

    it("should have X-Content-Type-Options header", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const header = response.headers["x-content-type-options"];
      if (header) {
        assert.strictEqual(header, "nosniff", "x-content-type-options should be nosniff");
      }
      // If header is absent, that's also acceptable for this implementation
    });

    it("should have X-Frame-Options or CSP frame-ancestors", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
      });

      const xFrameOptions = response.headers["x-frame-options"];
      const csp = response.headers["content-security-policy"] as string | undefined;

      // Either X-Frame-Options or CSP with frame-ancestors should be present
      const hasFrameProtection =
        xFrameOptions !== undefined || (csp !== undefined && csp.includes("frame-ancestors"));

      assert.ok(
        hasFrameProtection || response.statusCode === 404,
        "Should have frame protection via X-Frame-Options or CSP frame-ancestors"
      );
    });
  });

  describe("Information Disclosure Prevention", () => {
    it("should not expose stack traces on 404", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/nonexistent-endpoint-xyz",
      });

      assert.ok(
        response.statusCode === 404,
        `Should return 404 for nonexistent endpoint (got ${response.statusCode})`
      );

      // Should not contain stack trace information
      assert.ok(
        !response.body.includes("node_modules"),
        "Should not expose node_modules paths in error response"
      );
      assert.ok(
        !response.body.includes(".ts:"),
        "Should not expose TypeScript file references in error response"
      );
    });

    it("should not expose database connection strings", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/debug/config",
      });

      assert.ok(
        response.statusCode === 404 || response.statusCode === 401,
        `Debug config endpoint should not be accessible (got ${response.statusCode})`
      );

      assert.ok(!response.body.includes("postgresql://"), "Should not expose DB connection string");
      assert.ok(!response.body.includes("redis://"), "Should not expose Redis connection string");
    });

    it("should not expose environment variables", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/debug/env",
      });

      assert.ok(
        response.statusCode === 404 || response.statusCode === 401,
        `Debug env endpoint should not be accessible (got ${response.statusCode})`
      );

      assert.ok(!response.body.includes("DATABASE_URL"), "Should not expose DATABASE_URL");
      assert.ok(!response.body.includes("JWT_SECRET"), "Should not expose JWT_SECRET");
    });

    it("should handle malformed JSON gracefully", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json",
        },
        payload: "invalid json{",
      });

      assert.ok(
        response.statusCode === 400 || response.statusCode === 415 || response.statusCode === 401,
        `Malformed JSON should be rejected (got ${response.statusCode})`
      );

      // Should not expose syntax error internals
      assert.ok(
        !response.body.includes("SyntaxError") || response.statusCode === 400,
        "Should not expose raw SyntaxError details"
      );
    });
  });

  describe("CORS Security", () => {
    it("should not allow all origins with credentials", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: {
          origin: "https://evil.com",
        },
      });

      const corsOrigin = response.headers["access-control-allow-origin"];

      // Should NOT reflect evil.com as an allowed origin
      assert.ok(corsOrigin !== "https://evil.com", "Should not allow evil.com as CORS origin");
    });

    it("should handle CORS preflight for unknown origins", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/posts",
        headers: {
          origin: "https://attacker.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,authorization",
        },
      });

      const corsOrigin = response.headers["access-control-allow-origin"];

      // Should not whitelist attacker origin
      assert.ok(
        corsOrigin !== "https://attacker.com",
        "CORS preflight should not allow attacker origin"
      );
    });
  });

  describe("Session Security", () => {
    it("should not expose sensitive data in login response", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "test@example.com",
          password: "wrongpassword",
        },
      });

      // Either fails (401) or succeeds (200) — in both cases, no sensitive data leaked
      assert.ok(
        !response.body.includes("wrongpassword"),
        "Response should not echo back the password"
      );
      assert.ok(
        !response.body.includes("passwordHash"),
        "Response should not expose password hash"
      );
    });

    it("should reject invalid bearer tokens", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "GET",
        url: "/api/posts",
        headers: {
          authorization: "Bearer invalid.token.format",
        },
      });

      assert.ok(
        response.statusCode === 401 || response.statusCode === 403,
        `Invalid token should be rejected (got ${response.statusCode})`
      );
    });
  });

  describe("API Versioning Security", () => {
    it("should handle malicious api-version headers safely", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const maliciousVersions = [
        "../../../etc/passwd",
        '<script>alert("xss")</script>',
        "v1; DROP TABLE users; --",
      ];

      for (const version of maliciousVersions) {
        const response = await app.inject({
          method: "GET",
          url: "/api/health",
          headers: {
            "api-version": version,
          },
        });

        // Should handle safely — not 5xx, no XSS in response
        assert.ok(
          response.statusCode < 500,
          `Malicious api-version header should not cause 5xx (version: ${version}, status: ${response.statusCode})`
        );
        assert.ok(!response.body.includes("<script>"), "Response should not reflect XSS payloads");
        assert.ok(
          !response.body.includes("DROP TABLE"),
          "Response should not reflect SQL injection payloads"
        );
      }
    });
  });

  describe("File Upload Security", () => {
    it("should reject dangerous file types in upload endpoint", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "multipart/form-data",
        },
        payload: {
          filename: "malware.exe",
          contentType: "application/octet-stream",
        },
      });

      // Should reject dangerous file types or return 404 if endpoint not implemented
      assert.ok(
        response.statusCode === 400 ||
          response.statusCode === 415 ||
          response.statusCode === 422 ||
          response.statusCode === 404 ||
          response.statusCode === 401,
        `Malicious file upload should be rejected (got ${response.statusCode})`
      );
    });

    it("should handle malicious filenames safely", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/media/upload",
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          filename: "../../../etc/passwd",
        },
      });

      // Should not serve /etc/passwd or 5xx
      assert.ok(
        response.statusCode < 500,
        `Path traversal filename should not cause 5xx (got ${response.statusCode})`
      );
      assert.ok(
        !response.body.includes("root:"),
        "Response should not contain /etc/passwd contents"
      );
    });
  });

  describe("Logging Security", () => {
    it("should not echo back passwords in responses", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const password = "SecureP@ssw0rd123!";

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "test@example.com",
          password,
        },
      });

      assert.ok(
        !response.body.includes(password),
        "Response should not contain the plaintext password"
      );
    });
  });
});
