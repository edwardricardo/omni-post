/**
 * @file useSchedulingDashboardSidebar.integration.test.tsx
 * @description Integration tests for the PR-51.A POC hook
 *              (`useSchedulingDashboardSidebar`). Verifies the canon pattern
 *              wiring: queryOptions factory consumed by useQuery, partial-key
 *              hierarchy works, queries are gated by `enabled` on projectId,
 *              and meta.suppressGlobalErrorToast is set on both leaves.
 *
 *              Migration POC for canon
 *              `msw-v2-setup-for-vitest-tests-with-tanstack-query`: replaces
 *              the previous `vi.stubGlobal('fetch', ...)` pattern with MSW
 *              handlers (default success path served by
 *              `tests/mocks/handlers/scheduling.ts`; per-test failure
 *              scenarios via `server.use(http.X(...))` inside individual
 *              `it()` blocks).
 * @layer infrastructure
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useSchedulingDashboardSidebar } from "../../hooks/useSchedulingDashboardSidebar";
import { schedulingQueries } from "../../lib/api/queries/schedulingQueries";
import { server } from "../mocks/server";

const PROXY = "/api/backend";

// MSW lifecycle scoped to THIS file. Per-test-file rather than global
// (vitest setupFiles) so legacy tests using vi.stubGlobal('fetch') keep
// working — MSW intercepts at the http/undici level, below the fetch
// global, so a global listen() with onUnhandledRequest: 'error' breaks
// any test that didn't declare handlers. Migration is incremental: each
// test that adopts MSW wires its own lifecycle. Strict 'error' is
// preserved within this file's scope.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

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

describe("useSchedulingDashboardSidebar", () => {
  it("returns campaigns + team data for a given projectId (uses default MSW handlers)", async () => {
    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-1"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.team.isSuccess).toBe(true));

    expect(result.current.campaigns.data).toEqual([{ id: "c1", name: "Default Campaign" }]);
    expect(result.current.team.data).toEqual([{ id: "u1", name: "Default User" }]);
  });

  it("does not fetch when projectId is undefined (enabled gate)", async () => {
    const { result } = renderHook(() => useSchedulingDashboardSidebar(undefined), {
      wrapper: createWrapper(makeClient()),
    });

    expect(result.current.campaigns.fetchStatus).toBe("idle");
    expect(result.current.team.fetchStatus).toBe("idle");
  });

  it("falls back to empty arrays when envelope.data is missing (graceful degradation)", async () => {
    server.use(
      http.get(`${PROXY}/campaigns`, () => HttpResponse.json({ ok: true })),
      http.get(`${PROXY}/team`, () => HttpResponse.json({ ok: true, data: {} }))
    );

    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-2"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.team.isSuccess).toBe(true));

    expect(result.current.campaigns.data).toEqual([]);
    expect(result.current.team.data).toEqual([]);
  });

  it("surfaces the error when the request returns !ok", async () => {
    server.use(
      http.get(`${PROXY}/campaigns`, () =>
        HttpResponse.json({ ok: false, error: "boom", message: "boom" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useSchedulingDashboardSidebar("proj-3"), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.campaigns.isError).toBe(true));
    expect(result.current.campaigns.error).toBeInstanceOf(Error);
  });

  it("re-runs both queries when projectId changes (cache key includes projectId)", async () => {
    const client = makeClient();

    server.use(
      http.get(`${PROXY}/campaigns`, ({ request }) => {
        const projectId = new URL(request.url).searchParams.get("projectId");
        return HttpResponse.json({
          ok: true,
          data: [{ id: `c-${projectId}`, name: projectId ?? "" }],
        });
      })
    );

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useSchedulingDashboardSidebar(projectId),
      {
        wrapper: createWrapper(client),
        initialProps: { projectId: "A" },
      }
    );

    await waitFor(() => expect(result.current.campaigns.isSuccess).toBe(true));
    expect(result.current.campaigns.data).toEqual([{ id: "c-A", name: "A" }]);

    rerender({ projectId: "B" });

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
