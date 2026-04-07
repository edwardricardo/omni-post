#!/usr/bin/env tsx
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
} from "./templateRoutes.test-helpers.js";

describe("Template Routes - GET /projects/:projectId/templates", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get templates for project", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBeTruthy();
  });

  it("should support category filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?category=social`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should support platform filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?platform=x`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should support tags filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?tags=test,social`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should support search filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?search=hello`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should support pagination with limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?limit=10`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should support pagination with offset", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?limit=10&offset=20`,
    });

    expect(response.statusCode).toBe(200);
  });

  it("should reject invalid project ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects/invalid/templates",
    });

    expect(response.statusCode).toBe(400);
  });

  it("should use default pagination when not provided", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Template Routes - GET /projects/:projectId/templates/:templateId", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should get template by ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/${templateId}`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.data).toBe("object");
  });

  it("should return 404 when template not found", async () => {
    mockTemplateService.getTemplate.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/${templateId}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("should reject invalid template ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates/invalid`,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("Template Routes - POST /projects/:projectId/templates", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should create new template", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        name: "New Template",
        description: "Test description",
        category: "social",
        content: "Template content with variable placeholder",
        variables: { var: "string" },
        platforms: ["x"],
        tags: ["test"],
      },
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(201);
    expect(body.ok).toBe(true);
  });

  it("should create template with minimal required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        name: "Minimal Template",
        category: "social",
        content: "Content",
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it("should reject template without name", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        category: "social",
        content: "Content",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject template without content", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        name: "Test",
        category: "social",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should accept optional isPublic flag", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/projects/${projectId}/templates`,
      payload: {
        name: "Public Template",
        category: "social",
        content: "Content",
        isPublic: true,
      },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("Template Routes - PUT /projects/:projectId/templates/:templateId", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should update template", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/projects/${projectId}/templates/${templateId}`,
      payload: {
        name: "Updated Template",
        description: "Updated description",
      },
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("should update only provided fields", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/projects/${projectId}/templates/${templateId}`,
      payload: {
        name: "New Name",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("should return 404 when template not found", async () => {
    mockTemplateService.updateTemplate.mockImplementationOnce(async () => ({
      ok: true,
      value: null,
    }));

    const response = await app.inject({
      method: "PUT",
      url: `/projects/${projectId}/templates/${templateId}`,
      payload: {
        name: "Updated",
      },
    });

    expect(response.statusCode).toBe(404);
  });

  it("should accept empty payload for update", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/projects/${projectId}/templates/${templateId}`,
      payload: {},
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("Template Routes - DELETE /projects/:projectId/templates/:templateId", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should delete template", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/projects/${projectId}/templates/${templateId}`,
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.message).toBe("Template deleted successfully");
  });

  it("should return 404 when template not found", async () => {
    mockTemplateService.deleteTemplate.mockImplementationOnce(async () => ({
      ok: true,
      value: false,
    }));

    const response = await app.inject({
      method: "DELETE",
      url: `/projects/${projectId}/templates/${templateId}`,
    });

    expect(response.statusCode).toBe(404);
  });
});
