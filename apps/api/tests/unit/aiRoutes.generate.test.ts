import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async () => {},
}));

import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/generate", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.content).toBe("Generated content here");
    expect(body.data.metadata).toBeTruthy();
  });

  it("should accept minimal payload with messages only", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
  });

  it("should reject empty messages array", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject missing messages field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        options: { model: "gpt-4" },
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should reject invalid message format", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ invalid: "field" }],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("should handle service errors gracefully", async (_t) => {
    vi.spyOn(aiService, "generateContent").mockImplementation(async () => {
      throw new Error("Service unavailable");
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: {
        messages: [{ role: "user", content: "Test" }],
      },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
  });
});

describe("aiRoutes - POST /ai/analyze", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBeTruthy();
    expect(body.data.analysis).toBeTruthy();
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

      expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
  });

  it("should reject missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/analyze",
      payload: {
        content: "Test",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("aiRoutes - POST /ai/predict", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBeTruthy();
    expect(body.data.prediction).toBeTruthy();
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
  });
});
