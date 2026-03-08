import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/generate", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should generate content successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Write a tweet about AI" }],
        options: {
          model: "gpt-4",
          maxTokens: 100,
          temperature: 0.7,
        },
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.data.success, true);
    assert.strictEqual(body.data.content, "Generated content here");
    assert.ok(body.data.metadata);
  });

  it("should accept minimal payload with messages only", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should accept optional provider parameter", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Test" }],
        provider: "anthropic",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should reject empty messages array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [],
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject missing messages field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        options: { model: "gpt-4" },
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject invalid message format", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ invalid: "field" }],
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should handle service errors gracefully", async (t) => {
    t.mock.method(aiService, "generateContent", async () => {
      throw new Error("Service unavailable");
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
});

describe("aiRoutes - POST /ai/analyze", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should analyze content successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "This is amazing content!",
        analysisType: "sentiment",
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.data.success);
    assert.ok(body.data.analysis);
  });

  it("should accept all valid analysis types", async () => {
    const types = ["sentiment", "tone", "readability", "engagement"];

    for (const analysisType of types) {
      const response = await app.inject({
        method: "POST",
        url: "/ai/analyze",
        payload: {
          content: "Test content",
          analysisType,
        },
      });

      assert.strictEqual(response.statusCode, 200);
    }
  });

  it("should accept optional provider parameter", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test content",
        analysisType: "sentiment",
        provider: "anthropic",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should reject empty content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "",
        analysisType: "sentiment",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject invalid analysis type", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test content",
        analysisType: "invalid",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it("should reject missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});

describe("aiRoutes - POST /ai/predict", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  beforeEach((t) => {
    setupAiServiceMocks(t, aiService);
  });

  after(async () => {
    await app.close();
  });

  it("should predict performance successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/predict",
      payload: {
        content: "Future viral content",
        platform: "twitter",
      },
    });

    const body = JSON.parse(response.body);

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.data.success);
    assert.ok(body.data.prediction);
  });

  it("should accept optional historical data", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/predict",
      payload: {
        content: "Test",
        platform: "twitter",
        historicalData: [
          { engagement: 100, reach: 1000 },
          { engagement: 150, reach: 1500 },
        ],
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should accept optional provider parameter", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/predict",
      payload: {
        content: "Test",
        platform: "twitter",
        provider: "openai",
      },
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it("should reject empty content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/predict",
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
      url: "/ai/predict",
      payload: {
        content: "Test",
        platform: "",
      },
    });

    assert.strictEqual(response.statusCode, 400);
  });
});
