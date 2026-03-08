#!/usr/bin/env tsx
import "./templateRoutes.env-setup.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { FastifyInstance } from "fastify";
import {
  createTestApp,
  mockTemplateService,
  projectId,
  templateId,
} from "./templateRoutes.test-helpers.js";

describe(
  "Template Routes - POST /projects/:projectId/templates/:templateId/duplicate",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
      await app.close();
    });

    it("should duplicate template with new name", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/duplicate`,
        payload: {
          name: "Duplicated Template",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 201);
      assert.strictEqual(body.ok, true);
    });

    it("should reject duplicate without name", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/duplicate`,
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should return 404 when source template not found", async () => {
      mockTemplateService.duplicateTemplate.mock.mockImplementationOnce(async () => ({
        ok: true,
        value: null,
      }));

      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/duplicate`,
        payload: {
          name: "Copy",
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  }
);

describe(
  "Template Routes - POST /projects/:projectId/templates/:templateId/compile",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
      await app.close();
    });

    it("should compile template with context", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/compile`,
        payload: {
          context: {
            name: "John",
            age: 30,
          },
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should compile with specific platforms", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/compile`,
        payload: {
          context: { name: "John" },
          platforms: ["x", "instagram"],
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should compile with A/B test config", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/compile`,
        payload: {
          context: { name: "John" },
          abTestConfig: {
            enabled: true,
            variants: [
              { id: "v1", content: "Variant 1" },
              { id: "v2", content: "Variant 2" },
            ],
          },
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should reject compilation without context", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/compile`,
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should return 404 when template not found", async () => {
      mockTemplateService.compileTemplate.mock.mockImplementationOnce(async () => ({
        ok: true,
        value: null,
      }));

      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/compile`,
        payload: {
          context: { name: "John" },
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  }
);

describe(
  "Template Routes - POST /projects/:projectId/templates/:templateId/validate",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
      await app.close();
    });

    it("should validate template successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/validate`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.valid, true);
    });

    it("should return validation errors", async () => {
      mockTemplateService.validateTemplate.mock.mockImplementationOnce(async () => ({
        ok: true,
        value: {
          valid: false,
          errors: ["Missing required variable", "Invalid syntax"],
        },
      }));

      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/validate`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data.valid, false);
      assert.ok(Array.isArray(body.data.errors));
    });
  }
);
