/**
 * Injection Attack Test Suite - LDAP, XML, Template, and Header Injection
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
  ldapInjectionPayloads,
  xmlInjectionPayloads,
  templateInjectionPayloads,
  headerInjectionPayloads,
} from "./injection-tests.test-helpers.js";

describe(
  "Injection Attack Prevention Tests - LDAP, XML, Template, Header",
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

    describe("LDAP Injection Tests", () => {
      it("should prevent LDAP injection in user search", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        for (const payload of ldapInjectionPayloads.slice(0, 8)) {
          const response = await app.inject({
            method: "GET",
            url: `/api/users/search?q=${encodeURIComponent(payload)}`,
            headers: {
              authorization: `Bearer ${authToken}`,
            },
          });

          assert.ok(
            response.statusCode === 200 ||
              response.statusCode === 400 ||
              response.statusCode === 404,
            `LDAP injection should be handled safely (got ${response.statusCode})`
          );

          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            if (Array.isArray(body.value || body.data)) {
              const users = body.value || body.data;
              for (const user of users) {
                assert.strictEqual(
                  (user as any).password,
                  undefined,
                  "User should not expose password"
                );
                assert.strictEqual(
                  (user as any).passwordHash,
                  undefined,
                  "User should not expose passwordHash"
                );
              }
            }
          }
        }
      });

      it("should validate LDAP filter syntax", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const invalidFilters = ["(uid=test))", "((uid=test)", "(uid=test"];

        for (const filter of invalidFilters) {
          const response = await app.inject({
            method: "POST",
            url: "/api/users/ldap-search",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
            payload: {
              filter: filter,
            },
          });

          // Should reject invalid filter syntax or return 404 if endpoint doesn't exist
          assert.ok(
            response.statusCode === 400 ||
              response.statusCode === 422 ||
              response.statusCode === 404,
            `Invalid LDAP filter should be rejected (got ${response.statusCode})`
          );
        }
      });
    });

    describe("XML Injection Tests", () => {
      it("should prevent XXE attacks in XML import", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        for (const payload of xmlInjectionPayloads.slice(0, 3)) {
          const response = await app.inject({
            method: "POST",
            url: "/api/import/xml",
            headers: {
              authorization: `Bearer ${authToken}`,
              "content-type": "application/xml",
            },
            payload: payload,
          });

          assert.ok(
            response.statusCode === 400 ||
              response.statusCode === 415 ||
              response.statusCode === 422 ||
              response.statusCode === 404,
            `XXE payload should be rejected (got ${response.statusCode})`
          );

          assert.ok(
            !response.body.includes("root:"),
            "Response should not contain /etc/passwd contents"
          );
          assert.ok(
            !response.body.includes("/bin/bash"),
            "Response should not contain system paths"
          );
          assert.ok(
            !response.body.includes("daemon:"),
            "Response should not contain daemon user info"
          );
        }
      });

      it("should limit XML processing resources", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const largeXml = `<?xml version="1.0"?>
      <data>
        ${"<item>test</item>".repeat(1000)}
      </data>`;

        const response = await app.inject({
          method: "POST",
          url: "/api/import/xml",
          headers: {
            authorization: `Bearer ${authToken}`,
            "content-type": "application/xml",
          },
          payload: largeXml,
        });

        assert.ok(
          response.statusCode === 400 ||
            response.statusCode === 413 ||
            response.statusCode === 415 ||
            response.statusCode === 422 ||
            response.statusCode === 404,
          `Large XML should be limited (got ${response.statusCode})`
        );
      });
    });

    describe("Template Injection Tests", () => {
      it("should prevent template injection in dynamic content", async (t) => {
        if (!dbAvailable || !authToken || !testProjectId) {
          t.skip("Database or auth or projectId not available");
          return;
        }

        // Test a small subset of template injection payloads
        for (const payload of templateInjectionPayloads.slice(0, 5)) {
          const response = await app.inject({
            method: "POST",
            url: "/api/posts",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
            payload: {
              projectId: testProjectId,
              title: `Template Test ${Date.now()}`,
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
            // Template expressions should not be executed
            assert.ok(!content.includes("49"), "Template expression 7*7 should not be evaluated");
          } else {
            assert.ok(
              response.statusCode === 400 || response.statusCode === 422,
              `Template injection should be rejected or sanitized (got ${response.statusCode})`
            );
          }
        }
      });

      it("should prevent template injection in email templates", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        // Test a small subset for performance
        for (const payload of templateInjectionPayloads.slice(0, 3)) {
          const response = await app.inject({
            method: "POST",
            url: "/api/notifications/email",
            headers: {
              authorization: `Bearer ${authToken}`,
            },
            payload: {
              to: "test@example.com",
              template: "welcome",
              variables: {
                name: payload,
                message: "Welcome to our platform",
              },
            },
          });

          assert.ok(
            response.statusCode === 200 ||
              response.statusCode === 400 ||
              response.statusCode === 404 ||
              response.statusCode === 422,
            `Template injection in email should be handled (got ${response.statusCode})`
          );

          if (response.statusCode === 200) {
            const body = JSON.parse(response.body);
            assert.ok(
              !JSON.stringify(body).includes("uid="),
              "Response should not contain uid output"
            );
            assert.ok(
              !JSON.stringify(body).includes("/bin/bash"),
              "Response should not contain shell paths"
            );
          }
        }
      });
    });

    describe("Header Injection Tests", () => {
      it("should prevent HTTP response splitting via User-Agent", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        for (const payload of headerInjectionPayloads.slice(0, 5)) {
          const response = await app.inject({
            method: "GET",
            url: "/api/posts",
            headers: {
              authorization: `Bearer ${authToken}`,
              "user-agent": payload,
            },
          });

          // Response headers should not be polluted
          const setCookieHeader = response.headers["set-cookie"];
          if (setCookieHeader) {
            const cookieStr = Array.isArray(setCookieHeader)
              ? setCookieHeader.join(", ")
              : setCookieHeader;
            assert.ok(
              !cookieStr.includes("admin=true"),
              "Response cookies should not be polluted with admin=true"
            );
          }

          const locationHeader = response.headers["location"];
          if (locationHeader) {
            assert.ok(
              !locationHeader.includes("evil.com"),
              "Location header should not redirect to evil.com"
            );
          }
        }
      });

      it("should sanitize custom request headers", async (t) => {
        if (!dbAvailable || !authToken) {
          t.skip("Database or auth not available");
          return;
        }

        const response = await app.inject({
          method: "GET",
          url: "/api/posts",
          headers: {
            authorization: `Bearer ${authToken}`,
            "x-custom-header": "test\r\nSet-Cookie: admin=true",
            "x-user-input": "test\nLocation: http://evil.com",
          },
        });

        // Response headers should not be polluted
        const setCookieHeader = response.headers["set-cookie"];
        if (setCookieHeader) {
          const cookieStr = Array.isArray(setCookieHeader)
            ? setCookieHeader.join(", ")
            : setCookieHeader;
          assert.ok(
            !cookieStr.includes("admin=true"),
            "Custom header injection should not pollute cookies"
          );
        }

        const locationHeader = response.headers["location"];
        if (locationHeader) {
          assert.ok(
            !locationHeader.includes("evil.com"),
            "Custom header injection should not redirect"
          );
        }

        const contentTypeHeader = response.headers["content-type"] || "";
        assert.ok(
          contentTypeHeader.includes("application/json") || response.statusCode === 401,
          `Content-Type should be JSON or 401 (got ${contentTypeHeader})`
        );
      });
    });
  }
);
