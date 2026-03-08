import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/optimize", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should optimize content successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "Basic tweet content",
        platform: "twitter",
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.data.success);
    assert.ok(body.data.optimization);
  });

  it("should accept optional brand voice parameter", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "Content",
        platform: "twitter",
        brandVoice: "professional and friendly",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should accept different platforms", async () => {
    const platforms = ["twitter", "instagram", "linkedin", "facebook"];

    for (const platform of platforms) {
      const response = await app.inject({
        method: "POST",
        url: "/ai/optimize",
        payload: {
          content: "Test",
          platform,
        },
      });

      assert.strictEqual(response.statusCode, 200);
    }
  });

  it("should reject empty content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "",
        platform: "twitter",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject empty platform", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "Test",
        platform: "",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "Test",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});

describe("aiRoutes - POST /ai/variations", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should generate variations successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/variations",
      payload: {
        content: "Original content",
        variationType: "tone",
        count: 3,
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.data.success);
    assert.ok(Array.isArray(body.data.variations));
  });

  it("should accept all valid variation types", async () => {
    const types = ["tone", "length", "audience"];

    for (const variationType of types) {
      const response = await app.inject({
        method: "POST",
        url: "/ai/variations",
        payload: {
          content: "Test",
          variationType,
          count: 2,
        },
      });

      assert.strictEqual(response.statusCode, 200);
    }
  });

  it("should accept count from 1 to 10", async () => {
    for (const count of [1, 5, 10]) {
      const response = await app.inject({
        method: "POST",
        url: "/ai/variations",
        payload: {
          content: "Test",
          variationType: "tone",
          count,
        },
      });

      assert.strictEqual(response.statusCode, 200);
    }
  });

  it("should reject count less than 1", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/variations",
      payload: {
        content: "Test",
        variationType: "tone",
        count: 0,
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject count greater than 10", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/variations",
      payload: {
        content: "Test",
        variationType: "tone",
        count: 11,
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject invalid variation type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/variations",
      payload: {
        content: "Test",
        variationType: "invalid",
        count: 3,
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject non-integer count", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/variations",
      payload: {
        content: "Test",
        variationType: "tone",
        count: 3.5,
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});
