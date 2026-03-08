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
  versionId,
  testId,
} from "./templateRoutes.test-helpers.js";

describe("Template Routes - Template Versions", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should get template versions", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/${templateId}/versions`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.ok(Array.isArray(body.data));
  });

  it("should create new template version", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/versions`,
      payload: {
        content: "New version content",
        changes: "Updated content",
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(body.ok, true);
  });

  it("should restore template version", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
  });

  it("should return 404 when restoring non-existent version", async () => {
    mockTemplateService.restoreTemplateVersion.mock.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
    });

    assert.strictEqual(response.statusCode, 404);
  });
});

describe("Template Routes - Analytics", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should get template analytics", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
  });

  it("should get analytics with date filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics?startDate=2024-01-01&endDate=2024-12-31`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should get analytics for specific templates", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics?templateIds=template-1,template-2`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should track template usage", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/usage`,
      payload: {
        action: "VIEW",
        context: { source: "dashboard" },
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.data.message, "Usage tracked successfully");
  });

  it("should track different usage actions", async () => {
    const actions = ["VIEW", "USE", "COMPILE", "LIKE", "SHARE"];

    for (const action of actions) {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/usage`,
        payload: { action },
      });

      assert.strictEqual(response.statusCode, 200);
    }
  });

  it("should reject invalid usage action", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/usage`,
      payload: {
        action: "INVALID_ACTION",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});

describe("Template Routes - A/B Testing", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should get A/B tests", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.ok(Array.isArray(body.data));
  });

  it("should filter A/B tests by status", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests?status=RUNNING`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should create A/B test", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests`,
      payload: {
        name: "Test A/B",
        description: "Testing variants",
        templateId: templateId,
        config: {
          variants: [
            { id: "v1", name: "Variant 1" },
            { id: "v2", name: "Variant 2" },
          ],
        },
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(body.ok, true);
  });

  it("should start A/B test", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/start`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
  });

  it("should stop A/B test", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/stop`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
  });

  it("should get A/B test results", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/results`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
  });

  it("should return 404 for non-existent A/B test", async () => {
    mockTemplateService.startABTest.mock.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/start`,
    });

    assert.strictEqual(response.statusCode, 404);
  });
});

describe("Template Routes - Platform Information", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should get platform limits for X", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms/x/limits",
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.data.platform, "x");
    assert.strictEqual(body.data.maxChars, 280);
  });

  it("should get platform limits for Instagram", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms/instagram/limits",
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.data.platform, "instagram");
  });

  it("should return 404 for unsupported platform", async () => {
    mockTemplateService.getPlatformLimits.mock.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/platforms/unknown/limits",
    });

    assert.strictEqual(response.statusCode, 404);
  });

  it("should get list of supported platforms", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms",
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length > 0);
  });

  it("should reject invalid platform name", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms//limits",
    });

    assert.ok(response.statusCode >= 400);
  });
});

describe("Template Routes - Error Handling", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should handle service errors gracefully", async () => {
    mockTemplateService.getTemplates.mock.mockImplementationOnce(async () => ({
      ok: false,
      error: "Service error",
    }));

    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    assert.ok(response.statusCode >= 400);
  });

  it("should validate UUID format for IDs", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects/not-a-uuid/templates",
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject malformed JSON payload", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: "invalid json",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.ok(response.statusCode >= 400);
  });

  it("should handle missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        description: "Missing name and content",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});
