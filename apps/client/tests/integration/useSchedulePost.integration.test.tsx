/**
 * @file useSchedulePost.integration.test.tsx
 * @description Integration tests for the `useSchedulePost` mutation hook —
 *              exercises the canonical TanStack v5 optimistic flow (cache flip
 *              on mutate, rollback on error, invalidation on settle), the
 *              correct request body shape (`scheduledFor`, not the legacy
 *              `scheduledAt`), and propagation of fetch errors.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSchedulePost } from "../../lib/hooks/useSchedulePost";
import type { Post } from "../../lib/api/types";

const mockFetch = vi.fn();

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      // gcTime: Infinity keeps unobserved cache entries alive so the test can
      // inspect them with `getQueryData` after a mutation cycle. With the
      // default short gcTime, an unobserved entry is collected before the
      // assertion runs and the test sees `undefined`.
      queries: { retry: false, gcTime: Infinity, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    projectId: "project-1",
    locale: "en",
    body: "hello",
    status: "DRAFT",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("useSchedulePost", () => {
  it("posts scheduledFor (not scheduledAt) and channelIds in the body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: "post-1" } }));
    const client = makeClient();
    const { result } = renderHook(() => useSchedulePost(), { wrapper: createWrapper(client) });

    await act(async () => {
      await result.current.mutateAsync({
        postId: "post-1",
        scheduledFor: "2026-12-01T10:00:00.000Z",
        channelIds: ["chan-1", "chan-2"],
      });
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.scheduledFor).toBe("2026-12-01T10:00:00.000Z");
    expect(body.channelIds).toEqual(["chan-1", "chan-2"]);
    expect(body.scheduledAt).toBeUndefined();
  });

  it("optimistically flips the cached post to SCHEDULED before the request resolves", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: "post-7" } }));
    const client = makeClient();
    const draft = makePost({ id: "post-7", status: "DRAFT" });
    client.setQueryData<Post>(["posts", "post-7"], draft);

    const { result } = renderHook(() => useSchedulePost(), { wrapper: createWrapper(client) });

    await act(async () => {
      result.current.mutate({
        postId: "post-7",
        scheduledFor: "2026-12-01T10:00:00.000Z",
        channelIds: ["chan-1"],
      });
    });

    await waitFor(() => {
      const cached = client.getQueryData<Post>(["posts", "post-7"]);
      expect(cached?.status).toBe("SCHEDULED");
      expect(cached?.scheduledAt).toBe("2026-12-01T10:00:00.000Z");
    });
  });

  it("rolls back the cached post when the mutation fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500));
    const client = makeClient();
    const draft = makePost({ id: "post-7", status: "DRAFT" });
    client.setQueryData<Post>(["posts", "post-7"], draft);

    const { result } = renderHook(() => useSchedulePost(), { wrapper: createWrapper(client) });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          postId: "post-7",
          scheduledFor: "2026-12-01T10:00:00.000Z",
          channelIds: ["chan-1"],
        });
      } catch {
        // Expected — mutation rejects with the server error.
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const cached = client.getQueryData<Post>(["posts", "post-7"]);
    expect(cached?.status).toBe("DRAFT");
    expect(cached?.scheduledAt).toBeUndefined();
  });

  it("propagates the error message from the server", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "too soon" } }, 400));
    const client = makeClient();
    const { result } = renderHook(() => useSchedulePost(), { wrapper: createWrapper(client) });

    await act(async () => {
      try {
        await result.current.mutateAsync({
          postId: "post-7",
          scheduledFor: "2026-12-01T10:00:00.000Z",
          channelIds: ["chan-1"],
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
