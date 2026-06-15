/**
 * @file client.test.ts
 * @description Tests for ApiClient
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi, Mock } from "vitest";
import { apiClient } from "../client.js";
import { ApiError } from "@packages/api-errors";

// Mock fetch globally
global.fetch = vi.fn();

const mockFetch = fetch as Mock;

describe("ApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("should use proxy URL and include credentials", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, status: "healthy" }),
      });

      await apiClient.getHealth();

      // All requests go through the proxy at /api/backend/
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/health",
        expect.objectContaining({
          credentials: "include",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    it("should NOT include Authorization header (proxy handles it)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, status: "healthy" }),
      });

      await apiClient.getHealth();

      const [_url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers).not.toHaveProperty("Authorization");
    });
  });

  describe("Error Handling", () => {
    it("should throw ApiError when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () =>
          Promise.resolve({
            ok: false,
            error: "Resource not found",
            code: "NOT_FOUND",
          }),
      });

      await expect(apiClient.getHealth()).rejects.toThrow(ApiError);

      // Reset mock for second call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () =>
          Promise.resolve({
            ok: false,
            error: "Resource not found",
            code: "NOT_FOUND",
          }),
      });

      await expect(apiClient.getHealth()).rejects.toThrow("Resource not found");
    });

    it("should handle JSON parsing errors gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(apiClient.getHealth()).rejects.toThrow(ApiError);

      // Reset mock for second call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      await expect(apiClient.getHealth()).rejects.toThrow("HTTP 500: Internal Server Error");
    });
  });

  describe("Health Endpoint", () => {
    it("should fetch health status successfully", async () => {
      const mockHealth = {
        ok: true,
        status: "healthy",
        timestamp: "2024-01-01T00:00:00Z",
        uptime: 3600,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const result = await apiClient.getHealth();

      expect(result).toEqual(mockHealth);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/health",
        expect.objectContaining({
          credentials: "include",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("Posts", () => {
    it("should fetch posts with query parameters", async () => {
      const params = {
        projectId: "project-123",
        page: 1,
        limit: 10,
        status: "PUBLISHED" as const,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: [],
            total: 0,
          }),
      });

      await apiClient.getPosts(params);

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/posts?projectId=project-123&page=1&limit=10&status=PUBLISHED",
        expect.any(Object)
      );
    });
  });

  describe("Providers", () => {
    it("should fetch all providers", async () => {
      const mockProviders = {
        ok: true,
        providers: [
          {
            id: "x",
            name: "X (Twitter)",
            type: "social",
            displayName: "X",
            capabilities: ["publish", "analytics"],
            isActive: true,
          },
        ],
        total: 1,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockProviders),
      });

      const result = await apiClient.getProviders();

      expect(result).toEqual(mockProviders);
      expect(mockFetch).toHaveBeenCalledWith("/api/backend/providers", expect.any(Object));
    });

    it("should fetch provider health", async () => {
      const providerId = "x";
      const mockHealth = {
        ok: true,
        health: {
          id: providerId,
          status: "healthy",
          latency: 150,
          lastCheck: "2024-01-01T00:00:00Z",
          errorRate: 0,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockHealth),
      });

      const result = await apiClient.getProviderHealth(providerId);

      expect(result).toEqual(mockHealth);
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/backend/providers/${providerId}/health`,
        expect.any(Object)
      );
    });
  });

  describe("File Upload", () => {
    it("should upload file with FormData through proxy", async () => {
      const file = new File(["test content"], "test.jpg", { type: "image/jpeg" });
      const mockResponse = {
        ok: true,
        data: {
          url: "https://example.com/test.jpg",
          metadata: { size: 12345, type: "image/jpeg" },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await apiClient.uploadFile(file, "image");

      expect(result).toEqual(mockResponse);

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/backend/upload");
      expect(options.method).toBe("POST");
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.credentials).toBe("include");
    });
  });

  describe("AI Features", () => {
    it("should generate content with prompt and options", async () => {
      const prompt = "Write a social media post about AI";
      const options = {
        type: "post" as const,
        tone: "professional" as const,
        length: "medium" as const,
        language: "en" as const,
      };

      const mockResponse = {
        ok: true,
        data: {
          content: "AI is revolutionizing how we work and create...",
          metadata: { wordCount: 25, sentiment: "positive" },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await apiClient.generateContent(prompt, options);

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/backend/ai/generate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ prompt, ...options }),
        })
      );
    });
  });

  describe("Analytics", () => {
    it("should fetch post analytics with date range", async () => {
      const postId = "post-123";
      const params = {
        start: "2024-01-01",
        end: "2024-01-31",
        providerId: "x",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: [
              {
                postId,
                providerId: "x",
                metrics: { views: 1000, likes: 50, shares: 10 },
                period: { start: params.start, end: params.end },
              },
            ],
          }),
      });

      await apiClient.getPostAnalytics(postId, params);

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/backend/analytics/posts/${postId}?start=2024-01-01&end=2024-01-31&providerId=x`,
        expect.any(Object)
      );
    });
  });
});
