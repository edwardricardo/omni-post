/**
 * API Security Test Suite - Injection Attacks
 * SQL, NoSQL, XSS, Command, LDAP, and XXE injection prevention
 *
 * NOTE: These tests require a running API server with a database.
 * Tier 1 test: requires PostgreSQL.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

describe("API Security Tests - Injection Attacks", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let authToken: string;
  let testProjectId: string;
  let dbAvailable = false;

  before(async () => {
    try {
      const { createApp } = await import("../../apps/api/src/index.js");
      app = await createApp();
      await app.ready();

      const email = `api-security-injection-${Date.now()}@example.com`;

      const registerResponse = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email,
          password: "SecureP@ssw0rd123!",
          name: "API Security Injection Test User",
        },
      });

      if (registerResponse.statusCode !== 201 && registerResponse.statusCode !== 200) {
        dbAvailable = false;
        return;
      }

      const registerBody = JSON.parse(registerResponse.body);
      const actualEmail = registerBody.value?.email || email;

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

      if (authToken) {
        const projectResponse = await app.inject({
          method: "POST",
          url: "/api/projects",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            name: "API Security Injection Test Project",
            description: "Test project for API security injection testing",
          },
        });

        const projectBody = JSON.parse(projectResponse.body);
        testProjectId = projectBody.value?.id || projectBody.data?.id || "";
      }

      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    await app?.close();
  });

  describe("SQL Injection Prevention", () => {
    it("should prevent SQL injection in post creation", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const sqlInjectionPayloads = [
        "'; DROP TABLE posts; --",
        "' UNION SELECT * FROM users --",
        "' OR '1'='1",
        "' AND (SELECT COUNT(*) FROM users) > 0 --",
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            projectId: testProjectId,
            title: payload,
            content: [
              {
                language: "en",
                content: `Test content with injection attempt: ${payload}`,
              },
            ],
          },
        });

        if (response.statusCode === 201 || response.statusCode === 200) {
          const body = JSON.parse(response.body);
          const title = body.value?.title || body.data?.title || "";
          assert.ok(!title.includes("DROP TABLE"), "Title should not contain DROP TABLE");
          assert.ok(!title.includes("UNION SELECT"), "Title should not contain UNION SELECT");
        } else {
          assert.ok(
            response.statusCode === 400 || response.statusCode === 422,
            `SQL injection should be rejected or sanitized (got ${response.statusCode})`
          );
        }
      }
    });

    it("should prevent SQL injection in search queries", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const sqlInjectionPayloads = ["' OR 1=1 --", "'; DROP TABLE posts; --"];

      for (const payload of sqlInjectionPayloads) {
        const response = await app.inject({
          method: "GET",
          url: `/api/posts?search=${encodeURIComponent(payload)}`,
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });

        assert.ok(
          response.statusCode === 200 || response.statusCode === 400,
          `SQL injection in search should be handled safely (got ${response.statusCode})`
        );

        if (response.statusCode === 200) {
          const body = JSON.parse(response.body);
          assert.ok(
            !JSON.stringify(body).includes("password"),
            "Response should not contain passwords"
          );
          assert.ok(
            !JSON.stringify(body).includes("passwordHash"),
            "Response should not expose password hashes"
          );
        }
      }
    });

    it("should prevent SQL injection in parameter binding", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const maliciousProjectId = "1' OR '1'='1";

      const response = await app.inject({
        method: "GET",
        url: `/api/projects/${encodeURIComponent(maliciousProjectId)}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      assert.ok(
        response.statusCode === 400 || response.statusCode === 404,
        `Malicious project ID should return 400 or 404 (got ${response.statusCode})`
      );
    });
  });

  describe("NoSQL Injection Prevention", () => {
    it("should reject object-based NoSQL injection queries", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const response = await app.inject({
        method: "POST",
        url: "/api/posts/search",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/json",
        },
        payload: {
          projectId: testProjectId,
          query: { $ne: null },
        },
      });

      assert.ok(
        response.statusCode === 400 || response.statusCode === 404 || response.statusCode === 422,
        `NoSQL injection should be rejected (got ${response.statusCode})`
      );
    });
  });

  describe("Cross-Site Scripting (XSS) Prevention", () => {
    it("should prevent reflected XSS in API responses", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const xssPayloads = [
        '<script>alert("xss")</script>',
        '<img src=x onerror=alert("xss")>',
        'javascript:alert("xss")',
      ];

      for (const payload of xssPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            projectId: testProjectId,
            title: payload,
            content: [
              {
                language: "en",
                content: "Safe content",
              },
            ],
          },
        });

        if (response.statusCode === 201 || response.statusCode === 200) {
          const body = JSON.parse(response.body);
          const title = body.value?.title || body.data?.title || "";
          assert.ok(!title.includes("<script>"), "Title should not contain script tags");
          assert.ok(!title.includes("javascript:"), "Title should not contain javascript: URIs");
        } else {
          assert.ok(
            response.statusCode === 400 || response.statusCode === 422,
            `XSS payload should be rejected or sanitized (got ${response.statusCode})`
          );
        }
      }
    });

    it("should prevent XSS in error messages", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const xssPayload = '<script>alert("xss")</script>';

      const response = await app.inject({
        method: "GET",
        url: `/api/posts/${encodeURIComponent(xssPayload)}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      assert.ok(
        !response.body.includes("<script>"),
        "Error response should not include raw script tags"
      );
      assert.ok(!response.body.includes("alert("), "Error response should not include alert calls");
    });
  });

  describe("Command Injection Prevention", () => {
    it("should reject malicious filenames in file operations", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const commandInjectionPayloads = ["; ls -la", "| whoami", "&& cat /etc/passwd", "$(id)"];

      for (const payload of commandInjectionPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/api/media/upload",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            filename: `test${payload}.jpg`,
            projectId: testProjectId,
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Command injection in filename should be rejected (got ${response.statusCode})`
        );
      }
    });

    it("should sanitize path traversal attempts", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const pathTraversalPayloads = ["../../../etc/passwd", "/etc/passwd", "../../.env"];

      for (const payload of pathTraversalPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/api/media/upload",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            filename: payload,
            projectId: testProjectId,
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Path traversal should be rejected (got ${response.statusCode})`
        );
      }
    });
  });

  describe("LDAP Injection Prevention", () => {
    it("should handle LDAP injection attempts in user search", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const ldapInjectionPayloads = ["*)(uid=*", "*)(|(objectClass=*))", "*))%00"];

      for (const payload of ldapInjectionPayloads) {
        const response = await app.inject({
          method: "GET",
          url: `/api/users/search?q=${encodeURIComponent(payload)}`,
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });

        assert.ok(
          response.statusCode === 200 || response.statusCode === 400 || response.statusCode === 404,
          `LDAP injection should be handled safely (got ${response.statusCode})`
        );
      }
    });
  });

  describe("XML External Entity (XXE) Prevention", () => {
    it("should reject XXE attacks in XML input", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      const xxePayload = `<?xml version="1.0" encoding="UTF-8"?>
       <!DOCTYPE foo [<!ELEMENT foo ANY>
       <!ENTITY xxe SYSTEM "file:///etc/passwd">]>
       <foo>&xxe;</foo>`;

      const response = await app.inject({
        method: "POST",
        url: "/api/import/xml",
        headers: {
          authorization: `Bearer ${authToken}`,
          "content-type": "application/xml",
        },
        payload: xxePayload,
      });

      assert.ok(
        response.statusCode === 400 || response.statusCode === 422 || response.statusCode === 415,
        `XXE payload should be rejected (got ${response.statusCode})`
      );

      assert.ok(
        !response.body.includes("root:"),
        "Response should not contain /etc/passwd contents"
      );
      assert.ok(!response.body.includes("/bin/bash"), "Response should not contain system paths");
    });
  });
});
