#!/usr/bin/env tsx
/**
 * @file templateRoutes.features.test.ts
 * @description Tests for Template Routes - Template Versions
 * @layer infrastructure
 */
import "./templateRoutes.env-setup.js";
import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async () => {},
}));
import { FastifyInstance } from "fastify";
import {
  createTestApp,
  mockTemplateService,
  projectId,
  templateId,
  versionId,
  testId,
} from "./templateRoutes.test-helpers.js";

describe("Template Routes - Template Versions", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get template versions", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/${templateId}/versions`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBeTruthy();
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

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("should restore template version", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should return 404 when restoring non-existent version", async () => {
    mockTemplateService.restoreTemplateVersion.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/versions/${versionId}/restore`,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("Template Routes - Analytics", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get template analytics", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should get analytics with date filters", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics?startDate=2024-01-01&endDate=2024-12-31`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should get analytics for specific templates", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/analytics?templateIds=template-1,template-2`,
    });

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
    expect(body.data.message).toBe("Usage tracked successfully");
  });

  it("should track different usage actions", async () => {
    const actions = ["VIEW", "USE", "COMPILE", "LIKE", "SHARE"];

    for (const action of actions) {
      const response = await app.inject({
        method: "POST",
        url: `/projects/${projectId}/templates/${templateId}/usage`,
        payload: { action },
      });

      expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
  });
});

describe("Template Routes - A/B Testing", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get A/B tests", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  it("should filter A/B tests by status", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests?status=RUNNING`,
    });

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("should start A/B test", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/start`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should stop A/B test", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/stop`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should get A/B test results", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/results`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should return 404 for non-existent A/B test", async () => {
    mockTemplateService.startABTest.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/ab-tests/${testId}/start`,
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("Template Routes - Platform Information", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get platform limits for X", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms/x/limits",
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.platform).toBe("x");
    expect(body.data.maxChars).toBe(280);
  });

  it("should get platform limits for Instagram", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms/instagram/limits",
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data.platform).toBe("instagram");
  });

  it("should return 404 for unsupported platform", async () => {
    mockTemplateService.getPlatformLimits.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/platforms/unknown/limits",
    });

    expect(response.statusCode).toBe(404);
  });

  it("should get list of supported platforms", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms",
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(body.data)).toBeTruthy();
    expect(body.data.length > 0).toBeTruthy();
  });

  it("should reject invalid platform name", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/platforms//limits",
    });

    expect(response.statusCode >= 400).toBeTruthy();
  });
});

describe("Template Routes - Error Handling", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should handle service errors gracefully", async () => {
    mockTemplateService.getTemplates.mockImplementationOnce(async () => ({
      ok: false,
      error: "Service error",
    }));

    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    expect(response.statusCode >= 400).toBeTruthy();
  });

  it("should validate UUID format for IDs", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects/not-a-uuid/templates",
    });

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode >= 400).toBeTruthy();
  });

  it("should handle missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        description: "Missing name and content",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
