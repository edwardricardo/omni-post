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

describe("Template Routes - GET /projects/:projectId/templates", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    await app.close();
  });

  it("should get templates for project", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(Array.isArray(body.data));
  });

  it("should support category filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?category=social`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should support platform filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?platform=x`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should support tags filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?tags=test,social`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should support search filter", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?search=hello`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should support pagination with limit", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?limit=10`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should support pagination with offset", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates?limit=10&offset=20`,
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should reject invalid project ID", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects/invalid/templates",
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should use default pagination when not provided", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/projects/${projectId}/templates`,
    });

    assert.strictEqual(response.statusCode, 200);
  });
});

describe(
  "Template Routes - GET /projects/:projectId/templates/:templateId",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
      await app.close();
    });

    it("should get template by ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/projects/${projectId}/templates/${templateId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(typeof body.data, "object");
    });

    it("should return 404 when template not found", async () => {
      mockTemplateService.getTemplate.mock.mockImplementationOnce(async () => ({
        ok: true,
        value: null,
      }));

      const response = await app.inject({
        method: "GET",
        url: `/projects/${projectId}/templates/${templateId}`,
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should reject invalid template ID", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/projects/${projectId}/templates/invalid`,
      });

      assert.strictEqual(response.statusCode, 400);
    });
  }
);

describe("Template Routes - POST /projects/:projectId/templates", { concurrency: 1 }, () => {
  let app: FastifyInstance;

  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
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

    assert.strictEqual(response.statusCode, 201);
    assert.strictEqual(body.ok, true);
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

    assert.strictEqual(response.statusCode, 201);
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

    assert.strictEqual(response.statusCode, 400);
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

    assert.strictEqual(response.statusCode, 400);
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

    assert.strictEqual(response.statusCode, 201);
  });
});

describe(
  "Template Routes - PUT /projects/:projectId/templates/:templateId",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should update only provided fields", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/projects/${projectId}/templates/${templateId}`,
        payload: {
          name: "New Name",
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should return 404 when template not found", async () => {
      mockTemplateService.updateTemplate.mock.mockImplementationOnce(async () => ({
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

      assert.strictEqual(response.statusCode, 404);
    });

    it("should accept empty payload for update", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/projects/${projectId}/templates/${templateId}`,
        payload: {},
      });

      assert.strictEqual(response.statusCode, 200);
    });
  }
);

describe(
  "Template Routes - DELETE /projects/:projectId/templates/:templateId",
  { concurrency: 1 },
  () => {
    let app: FastifyInstance;

    before(async () => {
      app = await createTestApp();
    });

    after(async () => {
      await app.close();
    });

    it("should delete template", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectId}/templates/${templateId}`,
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data.message, "Template deleted successfully");
    });

    it("should return 404 when template not found", async () => {
      mockTemplateService.deleteTemplate.mock.mockImplementationOnce(async () => ({
        ok: true,
        value: false,
      }));

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectId}/templates/${templateId}`,
      });

      assert.strictEqual(response.statusCode, 404);
    });
  }
);
