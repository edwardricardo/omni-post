/**
 * API Security Test Suite - Validation, SSRF, Rate Limiting and Authorization
 *
 * NOTE: These tests require a running API server with a database.
 * Tier 1 test: requires PostgreSQL.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";

describe(
  "API Security Tests - Validation, SSRF, Rate Limiting and Authorization",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;
    let authToken: string;
    let testProjectId: string;
    let dbAvailable = false;

    before(async () => {
      try {
        const { createApp } = await import("../../apps/api/src/index.js");
        app = await createApp();
        await app.ready();

        const email = `api-security-validation-${Date.now()}@example.com`;

        const registerResponse = await app.inject({
          method: "POST",
          url: "/api/auth/register",
          payload: {
            email,
            password: "SecureP@ssw0rd123!",
            name: "API Security Validation Test User",
          },
        });

        if (registerResponse.statusCode !== 201 && registerResponse.statusCode !== 200) {
          dbAvailable = false;
          return;
        }

        const loginResponse = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email,
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
              name: "API Security Validation Test Project",
              description: "Test project for API security validation testing",
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

    describe("JSON Injection Prevention", () => {
      it("should prevent prototype pollution via JSON injection", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const protoPayload = JSON.stringify({
          title: "test",
          content: [{ language: "en", content: "test" }],
          __proto__: { admin: true },
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: protoPayload,
        });

        // Should either reject or safely handle (stripping __proto__)
        assert.ok(
          response.statusCode === 400 || response.statusCode === 200 || response.statusCode === 201,
          `Prototype pollution payload should be handled safely (got ${response.statusCode})`
        );

        if (response.statusCode === 200 || response.statusCode === 201) {
          const body = JSON.parse(response.body);
          const post = body.value || body.data || {};
          // __proto__ property should not be present
          assert.strictEqual(
            (post as any).__proto__?.admin,
            undefined,
            "Admin prototype pollution should not succeed"
          );
        }
      });

      it("should prevent constructor injection via JSON", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const constructorPayload = JSON.stringify({
          title: "test",
          constructor: { prototype: { admin: true } },
        });

        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: constructorPayload,
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 200 || response.statusCode === 201,
          `Constructor injection should be handled safely (got ${response.statusCode})`
        );
      });
    });

    describe("Input Validation", () => {
      it("should validate required fields in post creation", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        // Missing required fields
        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: {},
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Missing required fields should return 400/422 (got ${response.statusCode})`
        );
      });

      it("should validate field types in requests", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const invalidTypePayload = {
          projectId: 12345, // Should be string
          title: ["array", "not", "string"], // Should be string
        };

        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: invalidTypePayload,
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Invalid field types should be rejected (got ${response.statusCode})`
        );
      });

      it("should handle oversized payloads appropriately", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const oversizedPayload = {
          projectId: testProjectId,
          title: "A".repeat(100000), // 100KB title
          content: [{ language: "en", content: "test" }],
        };

        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: oversizedPayload,
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 413 || response.statusCode === 422,
          `Oversized payload should be rejected (got ${response.statusCode})`
        );
      });
    });

    describe("Authorization", () => {
      it("should reject requests without authentication token", async (t) => {
        if (!dbAvailable) {
          t.skip("Database not available");
          return;
        }

        const response = await app.inject({
          method: "GET",
          url: "/api/posts",
        });

        assert.ok(
          response.statusCode === 401 || response.statusCode === 403,
          `Request without token should be rejected (got ${response.statusCode})`
        );
      });

      it("should reject requests with invalid authentication token", async (t) => {
        if (!dbAvailable) {
          t.skip("Database not available");
          return;
        }

        const response = await app.inject({
          method: "GET",
          url: "/api/posts",
          headers: {
            authorization: "Bearer invalid-token-xyz",
          },
        });

        assert.ok(
          response.statusCode === 401 || response.statusCode === 403,
          `Request with invalid token should be rejected (got ${response.statusCode})`
        );
      });

      it("should reject requests with tampered JWT token", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const tamperedToken = authToken.slice(0, -5) + "XXXXX";

        const response = await app.inject({
          method: "GET",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${tamperedToken}`,
          },
        });

        assert.ok(
          response.statusCode === 401 || response.statusCode === 403,
          `Tampered token should be rejected (got ${response.statusCode})`
        );
      });
    });

    describe("SSRF Prevention", () => {
      it("should reject requests to internal network in webhook URLs", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const ssrfPayloads = [
          "http://169.254.169.254/latest/meta-data/",
          "http://localhost:5432/",
          "http://127.0.0.1:6379/",
          "http://internal-service/",
        ];

        for (const url of ssrfPayloads) {
          const response = await app.inject({
            method: "POST",
            url: "/api/webhooks",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
            payload: {
              url,
              events: ["post.created"],
            },
          });

          assert.ok(
            response.statusCode === 400 ||
              response.statusCode === 422 ||
              response.statusCode === 404,
            `SSRF payload "${url}" should be rejected (got ${response.statusCode})`
          );
        }
      });
    });

    describe("Rate Limiting", () => {
      it("should handle multiple rapid requests without crashing", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        // Make 10 requests and verify server responds with valid HTTP codes
        const promises = Array.from({ length: 10 }, () =>
          app.inject({
            method: "GET",
            url: "/api/posts",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
          })
        );

        const responses = await Promise.all(promises);

        for (const response of responses) {
          assert.ok(
            response.statusCode === 200 || response.statusCode === 429,
            `Rapid request should return valid code (got ${response.statusCode})`
          );
        }
      });
    });
  }
);
