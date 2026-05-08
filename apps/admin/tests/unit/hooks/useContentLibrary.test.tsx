/**
 * Tests for useContentLibrary
 *
 * The hook calls fetch directly to /api/backend/posts with query params.
 * We mock global.fetch.
 *
 * @file useContentLibrary.test.tsx
 * @description Tests for useContentLibrary
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useContentLibrary } from "@/hooks/api/useContentLibrary";
import type { ListPostsResponse, UseContentLibraryOptions } from "@/hooks/api/useContentLibrary";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_POSTS_RESPONSE: ListPostsResponse = {
  items: [
    {
      id: "post-1",
      projectId: "proj-abc",
      status: "PUBLISHED",
      body: "Hello world",
      title: "First post",
      tags: ["news", "tech"],
      locale: "en",
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-21T00:00:00.000Z",
      scheduledAt: null,
      publishedAt: "2026-02-21T08:00:00.000Z",
    },
    {
      id: "post-2",
      projectId: "proj-abc",
      status: "DRAFT",
      body: "Draft content",
      title: null,
      tags: [],
      locale: "en",
      createdAt: "2026-02-22T00:00:00.000Z",
      updatedAt: "2026-02-22T00:00:00.000Z",
      scheduledAt: null,
      publishedAt: null,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
  hasNext: false,
  hasPrevious: false,
};

const BASE_OPTIONS: UseContentLibraryOptions = {
  projectId: "proj-abc",
  page: 1,
  limit: 20,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useContentLibrary", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches posts and returns ListPostsResponse.value on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_POSTS_RESPONSE }),
    });

    const { result } = renderHook(() => useContentLibrary(BASE_OPTIONS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_POSTS_RESPONSE);
    expect(result.current.data?.items).toHaveLength(2);
  });

  it("calls the correct URL with query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_POSTS_RESPONSE }),
    });

    const { result } = renderHook(() => useContentLibrary(BASE_OPTIONS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("/api/backend/posts");
    expect(calledUrl).toContain("projectId=proj-abc");
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("limit=20");
  });

  it("appends sortBy and sortDirection when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_POSTS_RESPONSE }),
    });

    const options: UseContentLibraryOptions = {
      ...BASE_OPTIONS,
      sortBy: "createdAt",
      sortDirection: "desc",
    };

    const { result } = renderHook(() => useContentLibrary(options), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("sortBy=createdAt");
    expect(calledUrl).toContain("sortDirection=desc");
  });

  it("throws when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });

    const { result } = renderHook(() => useContentLibrary(BASE_OPTIONS), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch content library");
  });

  it("uses projectId, page, and limit in the query key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_POSTS_RESPONSE }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useContentLibrary(BASE_OPTIONS), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Validate the key structure: ["content-library", projectId, page, limit, sortBy, sortDirection]
    const cached = queryClient.getQueryData([
      "content-library",
      "proj-abc",
      1,
      20,
      undefined,
      undefined,
    ]);
    expect(cached).toEqual(MOCK_POSTS_RESPONSE);
  });
});
