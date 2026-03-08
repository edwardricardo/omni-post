import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/smart-analysis", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should run smart analysis successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "Comprehensive analysis content",
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.data.success);
    assert.ok(body.data.analysis);
    assert.ok(body.data.metadata);
  });

  it("should use default values for optional parameters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "Test content",
      },
    });

    const body = JSON.parse(response.body);
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.data.platform, "twitter");
  });

  it("should accept all optional parameters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "Test",
        platform: "instagram",
        brandVoice: "casual",
        includeOptimization: true,
        includePrediction: true,
        includeVariations: true,
        variationCount: 5,
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should accept disabled optional features", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "Test",
        includeOptimization: false,
        includePrediction: false,
        includeVariations: false,
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should validate variation count range", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "Test",
        includeVariations: true,
        variationCount: 15,
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject empty content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});

describe("aiRoutes - DELETE /ai/cache", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should clear cache successfully", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/ai/cache",
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.data.success, true);
    assert.strictEqual(body.data.message, "Cache cleared successfully");
  });

  it("should handle cache clear errors", async (t) => {
    t.mock.method(aiService, "clearCache", async () => {
      throw new Error("Cache clear failed");
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/ai/cache",
    });

    assert.strictEqual(response.statusCode, 500);
  });
});

describe("aiRoutes - Error Handling", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should return 500 for unexpected service errors", async (t) => {
    t.mock.method(aiService, "generateContent", async () => {
      throw new Error("Unexpected error");
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    assert.strictEqual(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.ok, false);
  });

  it("should handle malformed JSON gracefully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: "invalid json",
      headers: {
        "content-type": "application/json",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject requests with invalid content-type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: "content=test&type=sentiment",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    assert.strictEqual(response.statusCode, 415);
  });
});

describe("aiRoutes - Input Sanitization", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should handle very long content strings", async () => {
    const longContent = "a".repeat(100000);
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: longContent,
        analysisType: "sentiment",
      },
    });

    assert.ok([200, 400, 413].includes(response.statusCode));
  });

  it("should handle special characters in content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test with special chars: <script>alert('xss')</script>",
        analysisType: "sentiment",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should handle unicode characters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test with emoji and unicode characters",
        analysisType: "sentiment",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });
});
