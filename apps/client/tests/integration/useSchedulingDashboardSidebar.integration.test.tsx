/**
 * @file useSchedulingDashboardSidebar.integration.test.tsx
 * @description Integration tests for the PR-51.A POC hook
 *              (`useSchedulingDashboardSidebar`). Verifies the canon pattern
 *              wiring: queryOptions factory consumed by useQuery, partial-key
 *              hierarchy works, queries are gated by `enabled` on projectId,
 *              and meta.suppressGlobalErrorToast is set on both leaves.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSchedulingDashboardSidebar } from "../../hooks/useSchedulingDashboardSidebar";
import { schedulingQueries } from "../../lib/api/queries/schedulingQueries";

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

function envelope<T>(body: T) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } satisfies Partial<Response>;
}

describe("useSchedulingDashboardSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns campaigns + team data for a given projectId", async () => {
    mockFetch
      .mockResolvedValueOnce(envelope({ ok: true, data: [{ id: "c1", name: "Spring Campaign" }] }))
      .mockResolvedValueOnce(
        envelope({ ok: true, data: { members: [{ id: "u1", name: "Ada Lovelace" }] } })
      );

    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-1"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.team.isSuccess).toBe(true));

    expect(result.current.campaigns.data).toEqual([{ id: "c1", name: "Spring Campaign" }]);
    expect(result.current.team.data).toEqual([{ id: "u1", name: "Ada Lovelace" }]);
  });

  it("does not fetch when projectId is undefined (enabled gate)", async () => {
    const { result } = renderHook(() => useSchedulingDashboardSidebar(undefined), {
      wrapper: createWrapper(makeClient()),
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.campaigns.fetchStatus).toBe("idle");
    expect(result.current.team.fetchStatus).toBe("idle");
  });

  it("falls back to empty arrays when envelope.data is missing (graceful degradation)", async () => {
    mockFetch
      .mockResolvedValueOnce(envelope({ ok: true })) // no data field
      .mockResolvedValueOnce(envelope({ ok: true, data: {} })); // no members

    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-2"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.team.isSuccess).toBe(true));

    expect(result.current.campaigns.data).toEqual([]);
    expect(result.current.team.data).toEqual([]);
  });

  it("surfaces the error when the request returns !ok", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ ok: false, error: "boom", message: "boom" }),
      })
      .mockResolvedValueOnce(envelope({ ok: true, data: { members: [] } }));

    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-3"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isError).toBe(true));
    expect(result.current.campaigns.error).toBeInstanceOf(Error);
  });

  it("re-runs both queries when projectId changes (cache key includes projectId)", async () => {
    mockFetch
      .mockResolvedValueOnce(envelope({ ok: true, data: [{ id: "c-A", name: "A" }] }))
      .mockResolvedValueOnce(envelope({ ok: true, data: { members: [] } }))
      .mockResolvedValueOnce(envelope({ ok: true, data: [{ id: "c-B", name: "B" }] }))
      .mockResolvedValueOnce(envelope({ ok: true, data: { members: [] } }));

    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useSchedulingDashboardSidebar(projectId),
      {
        wrapper: createWrapper(client),
        initialProps: { projectId: "proj-A" },
      }
    );

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    expect(result.current.campaigns.data).toEqual([{ id: "c-A", name: "A" }]);

    rerender({ projectId: "proj-B" });

    await waitFor(() => expect(result.current.campaigns.data).toEqual([{ id: "c-B", name: "B" }]));
  });

  it("schedulingQueries factory exposes hierarchy keys for partial invalidation", () => {
    expect(schedulingQueries.all()).toEqual(["scheduling"]);
    expect(schedulingQueries.campaigns()).toEqual(["scheduling", "campaigns"]);
    expect(schedulingQueries.team()).toEqual(["scheduling", "team"]);
    expect(schedulingQueries.campaignsForProject("p-1").queryKey).toEqual([
      "scheduling",
      "campaigns",
      "p-1",
    ]);
    expect(schedulingQueries.teamForProject("p-1").queryKey).toEqual(["scheduling", "team", "p-1"]);
  });

  it("both leaf queryOptions opt out of the global error toast via meta", () => {
    const campaignsOptions = schedulingQueries.campaignsForProject("p-1");
    const teamOptions = schedulingQueries.teamForProject("p-1");
    expect(campaignsOptions.meta?.suppressGlobalErrorToast).toBe(true);
    expect(teamOptions.meta?.suppressGlobalErrorToast).toBe(true);
  });
});
