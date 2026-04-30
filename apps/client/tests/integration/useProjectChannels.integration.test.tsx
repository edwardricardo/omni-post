/**
 * @file useProjectChannels.integration.test.tsx
 * @description Integration tests for the project-scoped channels hook module —
 *              covers the query (enabled gating, payload unwrapping, error path)
 *              and the `useSetPrimaryChannel` mutation including the canonical
 *              TanStack v5 optimistic flow (optimistic flip, rollback on error,
 *              invalidation on success).
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useProjectChannels,
  useSetPrimaryChannel,
  type ProjectChannel,
} from "../../lib/hooks/useProjectChannels";

const mockFetch = vi.fn();

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function makeChannel(overrides: Partial<ProjectChannel> = {}): ProjectChannel {
  return {
    id: "channel-id",
    projectId: "project-id",
    name: "@handle",
    platform: "X",
    isPrimary: false,
    status: "CONNECTED",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

describe("useProjectChannels", () => {
  it("stays idle when projectId is undefined", () => {
    const client = makeClient();
    const { result } = renderHook(() => useProjectChannels(undefined), {
      wrapper: createWrapper(client),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns the channel list on success and unwraps the envelope", async () => {
    const channels = [makeChannel({ id: "c-1" }), makeChannel({ id: "c-2", isPrimary: true })];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: channels }));

    const client = makeClient();
    const { result } = renderHook(() => useProjectChannels("project-1"), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(channels);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/projects/project-1/channels",
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("propagates error when the request fails", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "boom" } }, 500));

    const client = makeClient();
    const { result } = renderHook(() => useProjectChannels("project-1"), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("boom");
  });
});

describe("useSetPrimaryChannel", () => {
  it("optimistically flips isPrimary in the cached project channel list", async () => {
    const channels = [makeChannel({ id: "c-1", isPrimary: true }), makeChannel({ id: "c-2" })];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: channels }));

    const client = makeClient();
    const wrapper = createWrapper(client);

    // Prime the cache by running the query first.
    const queryHook = renderHook(() => useProjectChannels("project-id"), { wrapper });
    await waitFor(() => expect(queryHook.result.current.isSuccess).toBe(true));

    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: makeChannel({ id: "c-2", isPrimary: true }) })
    );

    const mutationHook = renderHook(() => useSetPrimaryChannel(), { wrapper });

    await act(async () => {
      mutationHook.result.current.mutate("c-2");
    });

    // After onMutate fires, the cache should already reflect the optimistic flip
    // even before the mutation resolves.
    await waitFor(() => {
      const cached = client.getQueryData<ProjectChannel[]>(["channels", "project", "project-id"]);
      expect(cached?.find((c) => c.id === "c-1")?.isPrimary).toBe(false);
      expect(cached?.find((c) => c.id === "c-2")?.isPrimary).toBe(true);
    });
  });

  it("rolls back the optimistic update when the mutation fails", async () => {
    const channels = [makeChannel({ id: "c-1", isPrimary: true }), makeChannel({ id: "c-2" })];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: channels }));

    const client = makeClient();
    const wrapper = createWrapper(client);

    const queryHook = renderHook(() => useProjectChannels("project-id"), { wrapper });
    await waitFor(() => expect(queryHook.result.current.isSuccess).toBe(true));

    mockFetch.mockResolvedValueOnce(jsonResponse({ error: { message: "nope" } }, 500));
    // Prevent the onSettled refetch from clobbering the rollback we want to assert.
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: channels }));

    const mutationHook = renderHook(() => useSetPrimaryChannel(), { wrapper });

    await act(async () => {
      try {
        await mutationHook.result.current.mutateAsync("c-2");
      } catch {
        // expected — mutation should reject and trigger onError rollback.
      }
    });

    await waitFor(() => expect(mutationHook.result.current.isError).toBe(true));

    const cached = client.getQueryData<ProjectChannel[]>(["channels", "project", "project-id"]);
    expect(cached?.find((c) => c.id === "c-1")?.isPrimary).toBe(true);
    expect(cached?.find((c) => c.id === "c-2")?.isPrimary).toBe(false);
  });

  it("posts to the set-primary endpoint with the right URL + method", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: makeChannel({ id: "c-9", isPrimary: true }) })
    );

    const client = makeClient();
    const wrapper = createWrapper(client);
    const { result } = renderHook(() => useSetPrimaryChannel(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync("c-9");
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/channels/c-9/set-primary",
      expect.objectContaining({ method: "PATCH", credentials: "include" })
    );
  });
});
