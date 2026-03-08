/**
 * Injection Attack Test Suite - SQL and NoSQL Injection
 *
 * NOTE: These tests require a running API server with a database.
 * Tier 1 test: requires PostgreSQL.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  setupInjectionTestContext,
  teardownInjectionTestContext,
  sqlInjectionPayloads,
  noSqlInjectionPayloads,
} from "./injection-tests.test-helpers.js";

describe("Injection Attack Prevention Tests - SQL and NoSQL", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let authToken: string;
  let testProjectId: string;
  let dbAvailable = false;

  before(async () => {
    try {
      const ctx = await setupInjectionTestContext();
      app = ctx.app;
      authToken = ctx.authToken;
      testProjectId = ctx.testProjectId;
      dbAvailable = !!authToken;
    } catch {
      dbAvailable = false;
    }
  });

  after(async () => {
    if (app) {
      await teardownInjectionTestContext({ app, prisma: null as any, authToken, testProjectId });
    }
  });

  describe("SQL Injection Tests", () => {
    it("should prevent SQL injection in authentication", async (t) => {
      if (!dbAvailable) {
        t.skip("Database not available");
        return;
      }

      // Test a subset of SQL injection payloads
      for (const payload of sqlInjectionPayloads.slice(0, 8)) {
        const response = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            email: payload,
            password: "anything",
          },
        });

        // Should not authenticate successfully
        assert.ok(
          response.statusCode === 400 || response.statusCode === 401,
          `SQL injection in auth should be rejected (got ${response.statusCode})`
        );

        const body = JSON.parse(response.body);
        assert.strictEqual(body.token, undefined, "Token should not be returned for SQL injection");

        // Should not leak database errors
        assert.ok(!response.body.includes("ORA-"), "Response should not leak Oracle errors");
        assert.ok(!response.body.includes("MySQL"), "Response should not leak MySQL errors");
        assert.ok(
          !response.body.includes("PostgreSQL"),
          "Response should not leak PostgreSQL errors"
        );
        assert.ok(
          !response.body.includes("Syntax error"),
          "Response should not leak syntax errors"
        );
      }
    });

    it("should prevent SQL injection in search queries", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      for (const payload of sqlInjectionPayloads.slice(0, 5)) {
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
            "Response should not expose passwords"
          );
          assert.ok(
            !JSON.stringify(body).includes("@@version"),
            "Response should not expose DB version"
          );
        }

        // Should not leak database errors
        assert.ok(!response.body.includes("ORA-"), "Response should not leak Oracle errors");
        assert.ok(
          !response.body.includes("PostgreSQL"),
          "Response should not leak PostgreSQL errors"
        );
      }
    });

    it("should prevent SQL injection in parameter binding", async (t) => {
      if (!dbAvailable || !authToken) {
        t.skip("Database or auth not available");
        return;
      }

      for (const payload of sqlInjectionPayloads.slice(0, 5)) {
        const response = await app.inject({
          method: "GET",
          url: `/api/projects/${encodeURIComponent(payload)}`,
          headers: {
            authorization: `Bearer ${authToken}`,
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 404,
          `SQL injection in URL param should be rejected (got ${response.statusCode})`
        );

        const body = JSON.parse(response.body);
        assert.ok(
          !JSON.stringify(body).includes("password"),
          "Response should not expose passwords"
        );
      }
    });

    it("should prevent SQL injection in JSON fields", async (t) => {
      if (!dbAvailable || !authToken || !testProjectId) {
        t.skip("Database or auth or projectId not available");
        return;
      }

      const jsonSqlPayloads = [
        { title: "' OR '1'='1 --", content: "test" },
        { title: "test", content: "'; DROP TABLE posts; --" },
      ];

      for (const payload of jsonSqlPayloads) {
        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            projectId: testProjectId,
            title: payload.title || "Test Title",
            content: [
              {
                language: "en",
                content: payload.content || "Test content",
              },
            ],
          },
        });

        if (response.statusCode === 201 || response.statusCode === 200) {
          const body = JSON.parse(response.body);
          const title = body.value?.title || body.data?.title || "";
          const contentStr = JSON.stringify(body.value?.content || body.data?.content || []);
          assert.ok(!title.includes("DROP TABLE"), "Title should not contain DROP TABLE");
          assert.ok(!contentStr.includes("INSERT INTO"), "Content should not contain INSERT INTO");
        } else {
          assert.ok(
            response.statusCode === 400 || response.statusCode === 422,
            `SQL injection in JSON should be rejected (got ${response.statusCode})`
          );
        }
      }
    });
  });

  describe("NoSQL Injection Tests", () => {
    it("should reject NoSQL operator injection in queries", async (t) => {
      if (!dbAvailable || !authToken || !testProjectId) {
        t.skip("Database or auth or projectId not available");
        return;
      }

      // Test a subset of NoSQL injection payloads
      for (const payload of noSqlInjectionPayloads.slice(0, 5)) {
        const response = await app.inject({
          method: "POST",
          url: "/api/posts/search",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/json",
          },
          payload: {
            projectId: testProjectId,
            query: payload,
          },
        });

        assert.ok(
          response.statusCode === 400 || response.statusCode === 404 || response.statusCode === 422,
          `NoSQL injection should be rejected (got ${response.statusCode})`
        );
      }
    });

    it("should sanitize object properties in requests", async (t) => {
      if (!dbAvailable || !authToken || !testProjectId) {
        t.skip("Database or auth or projectId not available");
        return;
      }

      const maliciousObject = {
        title: "Test Post",
        content: [{ language: "en", content: "test" }],
        $where: "function() { return true; }",
        $ne: null,
      };

      const response = await app.inject({
        method: "POST",
        url: "/api/posts",
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          projectId: testProjectId,
          ...maliciousObject,
        },
      });

      if (response.statusCode === 201 || response.statusCode === 200) {
        const body = JSON.parse(response.body);
        const post = body.value || body.data || {};
        assert.strictEqual(
          (post as any).$where,
          undefined,
          "NoSQL operator $where should be stripped"
        );
        assert.strictEqual((post as any).$ne, undefined, "NoSQL operator $ne should be stripped");
      } else {
        assert.ok(
          response.statusCode === 400 || response.statusCode === 422,
          `Malicious object properties should be rejected (got ${response.statusCode})`
        );
      }
    });
  });
});
