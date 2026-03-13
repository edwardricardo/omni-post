#!/usr/bin/env tsx
import "./templateRoutes.env-setup.js";
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { FastifyInstance } from "fastify";
import {
  createTestApp,
  mockTemplateService,
  projectId,
  templateId,
} from "./templateRoutes.test-helpers.js";

describe("Template Routes - POST /projects/:projectId/templates/:templateId/duplicate", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("should reject duplicate without name", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/duplicate`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 404 when source template not found", async () => {
    mockTemplateService.duplicateTemplate.mockImplementationOnce(async () => ({
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

    expect(response.statusCode).toBe(404);
  });
});

describe("Template Routes - POST /projects/:projectId/templates/:templateId/compile", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
  });

  it("should reject compilation without context", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/compile`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("should return 404 when template not found", async () => {
    mockTemplateService.compileTemplate.mockImplementationOnce(async () => ({
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

    expect(response.statusCode).toBe(404);
  });
});

describe("Template Routes - POST /projects/:projectId/templates/:templateId/validate", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should validate template successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates/${templateId}/validate`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.valid).toBe(true);
  });

  it("should return validation errors", async () => {
    mockTemplateService.validateTemplate.mockImplementationOnce(async () => ({
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

    expect(response.statusCode).toBe(200);
    expect(body.data.valid).toBe(false);
    expect(Array.isArray(body.data.errors)).toBeTruthy();
  });
});
