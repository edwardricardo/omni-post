/**
 * @file hooks.test.tsx
 * @description Tests for API Hooks
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { ReactNode } from "react";
import {
  useApiProviders,
  useCreatePost,
  useAllProvidersHealth,
  usePost,
  useUploadFile,
} from "../hooks";
import { apiClient } from "../client";

// Mock the API client
vi.mock("../client", () => ({
  apiClient: {
    getProviders: vi.fn(),
    getAllProvidersHealth: vi.fn(),
    getPost: vi.fn(),
    createPost: vi.fn(),
    uploadFile: vi.fn(),
  },
}));

const mockApiClient = apiClient as any;

// Test wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("API Hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useProviders", () => {
    it("should fetch providers successfully", async () => {
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

      mockApiClient.getProviders.mockResolvedValue(mockProviders);

      const { result } = renderHook(() => useApiProviders(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockProviders);
      expect(mockApiClient.getProviders).toHaveBeenCalledTimes(1);
    });

    it("should handle provider fetch error", async () => {
      const error = new Error("Failed to fetch providers");
      mockApiClient.getProviders.mockRejectedValue(error);

      const { result } = renderHook(() => useApiProviders(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe("useAllProvidersHealth", () => {
    it("should fetch provider health data", async () => {
      const mockHealthData = {
        ok: true,
        providers: [
          {
            id: "x",
            status: "healthy",
            latency: 150,
            lastCheck: "2024-01-01T00:00:00Z",
            errorRate: 0,
          },
        ],
        summary: {
          total: 1,
          healthy: 1,
          degraded: 0,
          unhealthy: 0,
          avgLatency: 150,
        },
      };

      mockApiClient.getAllProvidersHealth.mockResolvedValue(mockHealthData);

      const { result } = renderHook(() => useAllProvidersHealth(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockHealthData);
    });
  });

  describe("usePost", () => {
    it("should fetch single post by ID", async () => {
      const postId = "post-123";
      const mockPost = {
        ok: true,
        data: {
          id: postId,
          projectId: "project-123",
          locale: "en",
          title: "Test Post",
          body: "This is a test post",
          status: "DRAFT",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      };

      mockApiClient.getPost.mockResolvedValue(mockPost);

      const { result } = renderHook(() => usePost(postId), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockPost);
      expect(mockApiClient.getPost).toHaveBeenCalledWith(postId);
    });

    it("should not fetch when ID is empty", () => {
      const { result } = renderHook(() => usePost(""), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(mockApiClient.getPost).not.toHaveBeenCalled();
    });
  });

  describe("useCreatePost", () => {
    it("should create post successfully", async () => {
      const postData = {
        projectId: "project-123",
        locale: "en" as const,
        title: "New Post",
        body: "This is a new post",
      };

      const mockResponse = {
        ok: true,
        data: {
          id: "post-456",
          ...postData,
          status: "DRAFT",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      };

      mockApiClient.createPost.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useCreatePost(), {
        wrapper: createWrapper(),
      });

      result.current.mutate(postData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      expect(mockApiClient.createPost).toHaveBeenCalledWith(postData);
    });

    it("should handle create post error", async () => {
      const postData = {
        projectId: "project-123",
        locale: "en" as const,
        body: "This is a new post",
      };

      const error = new Error("Validation failed");
      mockApiClient.createPost.mockRejectedValue(error);

      const { result } = renderHook(() => useCreatePost(), {
        wrapper: createWrapper(),
      });

      result.current.mutate(postData);

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toEqual(error);
    });
  });

  describe("useUploadFile", () => {
    it("should upload file successfully", async () => {
      const file = new File(["test content"], "test.jpg", { type: "image/jpeg" });
      const mockResponse = {
        ok: true,
        data: {
          url: "https://example.com/test.jpg",
          metadata: { size: 12345, type: "image/jpeg" },
        },
      };

      mockApiClient.uploadFile.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useUploadFile(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ file, type: "image" });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
      expect(mockApiClient.uploadFile).toHaveBeenCalledWith(file, "image");
    });
  });

  describe("Custom options", () => {
    it("should accept custom query options", async () => {
      const mockProviders = {
        ok: true,
        providers: [],
        total: 0,
      };

      mockApiClient.getProviders.mockResolvedValue(mockProviders);

      const { result } = renderHook(
        () => useApiProviders({ staleTime: 30000 }), // Custom option
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockProviders);
    });

    it("should accept custom mutation options", async () => {
      const postData = {
        projectId: "project-123",
        locale: "en" as const,
        body: "Test post",
      };

      const mockResponse = {
        ok: true,
        data: { id: "post-123", ...postData },
      };

      mockApiClient.createPost.mockResolvedValue(mockResponse);

      const { result } = renderHook(
        () => useCreatePost({ retry: 3 }), // Custom option
        { wrapper: createWrapper() }
      );

      result.current.mutate(postData);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockResponse);
    });
  });
});
