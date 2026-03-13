import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/smart-analysis", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBeTruthy();
    expect(body.data.analysis).toBeTruthy();
    expect(body.data.metadata).toBeTruthy();
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
    expect(response.statusCode).toBe(200);
    expect(body.data.platform).toBe("twitter");
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
  });

  it("should reject empty content", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/smart-analysis",
      payload: {
        content: "",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("aiRoutes - DELETE /ai/cache", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should clear cache successfully", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/ai/cache",
    });

    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBe(true);
    expect(body.data.message).toBe("Cache cleared successfully");
  });

  it("should handle cache clear errors", async (t) => {
    vi.spyOn(aiService, "clearCache").mockImplementation(async () => {
      throw new Error("Cache clear failed");
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/ai/cache",
    });

    expect(response.statusCode).toBe(500);
  });
});

describe("aiRoutes - Error Handling", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
    await app.close();
  });

  it("should return 500 for unexpected service errors", async (t) => {
    vi.spyOn(aiService, "generateContent").mockImplementation(async () => {
      throw new Error("Unexpected error");
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

  it("should handle malformed JSON gracefully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate",
      payload: "invalid json",
      headers: {
        "content-type": "application/json",
      },
    });

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(415);
  });
});

describe("aiRoutes - Input Sanitization", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect([200, 400, 413].includes(response.statusCode)).toBeTruthy();
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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
  });
});
