/**
 * Injection Attack Test Suite - XSS and Command Injection
 *
 * DO NOT WIRE THIS SUITE INTO CI. It cannot pass: the shared bootstrap in
 * ./injection-tests.test-helpers.ts posts to `/api/auth/register`, a prefix the
 * application never registers, so the `before` hook 404s and every test skips.
 * A database does NOT fix this — the run is byte-identical with Postgres up and
 * down. Read ./README.md and SMELL-83 in
 * docs/reports/roadmap-detected-smells-backlog.md before adding a tier, a job,
 * or a script for it.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import {
  setupInjectionTestContext,
  teardownInjectionTestContext,
  xssPayloads,
  commandInjectionPayloads,
} from "./injection-tests.test-helpers.js";

describe(
  "Injection Attack Prevention Tests - XSS and Command Injection",
  { concurrency: 1 },
  () => {
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

    describe("XSS Injection Tests", () => {
      it("should prevent XSS in post titles", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        // Test a subset of XSS payloads for performance
        for (const payload of xssPayloads.slice(0, 10)) {
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
            assert.ok(!title.includes("onload"), "Title should not contain onload events");
            assert.ok(!title.includes("onerror"), "Title should not contain onerror events");
            assert.ok(!title.includes("alert("), "Title should not contain alert calls");
          } else {
            assert.ok(
              response.statusCode === 400 || response.statusCode === 422,
              `XSS in title should be rejected or sanitized (got ${response.statusCode})`
            );
          }
        }
      });

      it("should prevent XSS in post content", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        // Test a small subset for performance
        for (const payload of xssPayloads.slice(0, 5)) {
          const response = await app.inject({
            method: "POST",
            url: "/api/posts",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
            payload: {
              projectId: testProjectId,
              title: "XSS Test Post",
              content: [
                {
                  language: "en",
                  content: payload,
                },
              ],
            },
          });

          if (response.statusCode === 201 || response.statusCode === 200) {
            const body = JSON.parse(response.body);
            const contentArray = body.value?.content || body.data?.content || [];
            const content = Array.isArray(contentArray)
              ? (contentArray[0] as any)?.content || ""
              : "";
            assert.ok(!content.includes("<script>"), "Content should not contain script tags");
            assert.ok(
              !content.includes("javascript:"),
              "Content should not contain javascript: URIs"
            );
            assert.ok(!content.includes("onerror"), "Content should not contain onerror events");
          } else {
            assert.ok(
              response.statusCode === 400 || response.statusCode === 422,
              `XSS in content should be rejected or sanitized (got ${response.statusCode})`
            );
          }
        }
      });

      it("should prevent XSS in JSON responses via proper content type", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        const xssInJson = '<script>alert("xss")</script>';

        const response = await app.inject({
          method: "POST",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
          },
          payload: {
            projectId: testProjectId,
            title: xssInJson,
            content: [
              {
                language: "en",
                content: "Test content",
              },
            ],
          },
        });

        // Response should be properly escaped JSON
        const contentType = response.headers["content-type"] || "";
        assert.ok(
          contentType.includes("application/json"),
          `Response should be JSON (got ${contentType})`
        );

        if (response.statusCode === 201 || response.statusCode === 200) {
          const body = JSON.parse(response.body);
          const title = body.value?.title || body.data?.title || "";
          assert.ok(
            !title.includes("<script>"),
            "JSON response title should not contain script tags"
          );
        }
      });
    });

    describe("Command Injection Tests", () => {
      it("should prevent command injection in file operations", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        // Test a subset of command injection payloads
        for (const payload of commandInjectionPayloads.slice(0, 8)) {
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

      it("should prevent command injection in search operations", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        for (const payload of commandInjectionPayloads.slice(0, 8)) {
          const response = await app.inject({
            method: "GET",
            url: `/api/posts?search=${encodeURIComponent(payload)}`,
            headers: {
              authorization: `Bearer ${authToken}`,
            },
          });

          assert.ok(
            response.statusCode === 200 || response.statusCode === 400,
            `Command injection in search should be handled safely (got ${response.statusCode})`
          );

          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            assert.ok(
              !JSON.stringify(body).includes("root:"),
              "Response should not contain /etc/passwd"
            );
            assert.ok(
              !JSON.stringify(body).includes("/bin/bash"),
              "Response should not contain system paths"
            );
            assert.ok(
              !JSON.stringify(body).includes("uid="),
              "Response should not contain uid output"
            );
          }
        }
      });

      it("should sanitize file paths", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        const pathTraversalPayloads = [
          "../../../etc/passwd",
          "/etc/passwd",
          "../../.env",
          "/proc/self/environ",
        ];

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
  }
);
