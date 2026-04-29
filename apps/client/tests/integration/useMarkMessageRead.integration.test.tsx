/**
 * @file useMarkMessageRead.integration.test.tsx
 * @description Integration tests for the inbox `useMarkMessageRead` mutation —
 *              guards against the L-206 regression: silent fetch failure +
 *              missing cache invalidation. Verifies error propagation
 *              (mutation throws when fetch returns !ok) and TanStack cache
 *              invalidation (the `["inbox"]` query family is invalidated on
 *              success).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMarkMessageRead } from "../../hooks/api/useInbox";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

describe("useMarkMessageRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates error when the request returns !ok (no silent failure)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const client = makeClient();
    const { result } = renderHook(() => useMarkMessageRead(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.status).toBe("idle"));

    result.current.mutate("msg-123");

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe("Failed to mark message as read");
  });

  it('invalidates the ["inbox"] query family on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useMarkMessageRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate("msg-123");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["inbox"] });
  });

  it("calls the correct backend endpoint with PATCH", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const client = makeClient();
    const { result } = renderHook(() => useMarkMessageRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate("msg-456");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/inbox/messages/msg-456/read",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
      })
    );
  });

  it("does not invalidate cache when the request fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useMarkMessageRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate("msg-missing");

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
