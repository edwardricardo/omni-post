import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";

vi.mock("../../src/auth/authMiddleware.js", () => ({
  authenticateMiddleware: async () => {},
  requireAdmin: async () => {},
  requireSuperAdmin: async () => {},
  requireRole: () => async () => {},
  optionalAuth: async () => {},
}));

import type { FastifyInstance } from "fastify";
import { createTestApp, aiService, setupAiServiceMocks } from "./aiRoutes.test-helpers.js";

let app: FastifyInstance;

describe("aiRoutes - POST /ai/optimize", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBeTruthy();
    expect(body.data.optimization).toBeTruthy();
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

    expect(response.statusCode).toBe(200);
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

      expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
  });

  it("should reject missing required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/optimize",
      payload: {
        content: "Test",
      },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("aiRoutes - POST /ai/variations", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    setupAiServiceMocks(aiService);
  });

  afterAll(async () => {
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

    expect(response.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.success).toBeTruthy();
    expect(Array.isArray(body.data.variations)).toBeTruthy();
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

      expect(response.statusCode).toBe(200);
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

      expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
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

    expect(response.statusCode).toBe(400);
  });
});
