/**
 * Tests for usePosts, useCreatePost, useDeletePost
 *
 * All three hooks delegate to api.* from @/lib/apiClient.
 * We mock the api module.
 *
 * @file usePosts.test.tsx
 * @description Tests for usePosts
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/apiClient", () => ({
  api: {
    listPosts: vi.fn(),
    createPost: vi.fn(),
    deletePost: vi.fn(),
  },
}));

import { usePosts, useCreatePost, useDeletePost } from "@/hooks/api/usePosts";
import { api } from "@/lib/apiClient";

const mockListPosts = vi.mocked(api.listPosts);
const mockCreatePost = vi.mocked(api.createPost);
const mockDeletePost = vi.mocked(api.deletePost);

const MOCK_POSTS = [
  { id: "post-1", createdAt: "2026-02-20T00:00:00.000Z", title: "Hello", status: "PUBLISHED" },
  { id: "post-2", createdAt: "2026-02-21T00:00:00.000Z", title: undefined, status: "DRAFT" },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("usePosts", () => {
  beforeEach(() => {
    mockListPosts.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches posts list on success", async () => {
    mockListPosts.mockResolvedValueOnce({ ok: true, value: MOCK_POSTS });

    const { result } = renderHook(() => usePosts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_POSTS);
    expect(mockListPosts).toHaveBeenCalledWith({ limit: 20 });
  });

  it("passes custom limit to api.listPosts", async () => {
    mockListPosts.mockResolvedValueOnce({ ok: true, value: [] });

    const { result } = renderHook(() => usePosts(50), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListPosts).toHaveBeenCalledWith({ limit: 50 });
  });

  it("throws when api.listPosts returns ok: false", async () => {
    mockListPosts.mockResolvedValueOnce({ ok: false, value: [] });

    const { result } = renderHook(() => usePosts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch posts");
  });

  it("returns empty array when value is undefined", async () => {
    // Hook does: (response.value || [])
    mockListPosts.mockResolvedValueOnce({ ok: true, value: undefined as never });

    const { result } = renderHook(() => usePosts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("uses [posts, list, limit] as query key", async () => {
    mockListPosts.mockResolvedValueOnce({ ok: true, value: MOCK_POSTS });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => usePosts(20), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["posts", "list", 20])).toEqual(MOCK_POSTS);
  });
});

describe("useCreatePost", () => {
  beforeEach(() => {
    mockCreatePost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls api.createPost and returns response on success", async () => {
    const responseData = { ok: true, post: { id: "new-post-1" } };
    mockCreatePost.mockResolvedValueOnce(responseData);

    const { result } = renderHook(() => useCreatePost(), {
      wrapper: createWrapper(),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        content: "My new post",
        projectId: "proj-1",
      });
    });

    expect(returned).toEqual(responseData);
    expect(mockCreatePost).toHaveBeenCalledWith({
      content: "My new post",
      projectId: "proj-1",
    });
  });

  it("throws when api.createPost returns ok: false", async () => {
    mockCreatePost.mockResolvedValueOnce({ ok: false, post: null as never });

    const { result } = renderHook(() => useCreatePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ content: "test", projectId: "proj-1" })
      ).rejects.toThrow("Failed to create post");
    });
  });
});

describe("useDeletePost", () => {
  beforeEach(() => {
    mockDeletePost.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls api.deletePost with the correct postId", async () => {
    mockDeletePost.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useDeletePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("post-1");
    });

    expect(mockDeletePost).toHaveBeenCalledWith("post-1");
    // Mutation state settles asynchronously after the act block
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("throws when api.deletePost returns ok: false", async () => {
    mockDeletePost.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useDeletePost(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.mutateAsync("post-1")).rejects.toThrow("Failed to delete post");
    });
  });
});
