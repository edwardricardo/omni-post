/**
 * Tests for useDashboardStats
 *
 * The hook delegates to api.admin.getDashboardStats() from @/lib/apiClient,
 * which internally makes two fetch calls to derive stats.
 * We mock the whole api module to keep tests self-contained.
 *
 * @file useDashboardStats.test.tsx
 * @description Tests for useDashboardStats
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the api module — getDashboardStats is an async function on api.admin
vi.mock("@/lib/apiClient", () => ({
  api: {
    admin: {
      getDashboardStats: vi.fn(),
    },
  },
}));

import { useDashboardStats } from "@/hooks/api/useDashboardStats";
import { api } from "@/lib/apiClient";

const mockGetDashboardStats = vi.mocked(api.admin.getDashboardStats);

const MOCK_STATS = {
  accounts: { total: 42, active: 35, trialsActive: 5, trialsExpiring: 2 },
  plans: { custom: 20, bundle: 15, trial: 5, none: 2 },
  revenue: { monthly: 9000, yearly: 108000, total: 108000 },
  activity: { loginsToday: 12, newAccountsToday: 3, subscriptionChangesToday: 1 },
  projects: 88,
  lastUpdated: "2026-02-24T00:00:00.000Z",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      // retry: false disables retries in defaultOptions but the hook itself
      // specifies retry: 2, which overrides it. We therefore also set
      // retryDelay to 0 so any retries that do fire complete immediately.
      queries: { retry: false, gcTime: 0, retryDelay: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDashboardStats", () => {
  beforeEach(() => {
    mockGetDashboardStats.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns dashboard stats on success", async () => {
    mockGetDashboardStats.mockResolvedValueOnce({
      ok: true,
      stats: MOCK_STATS,
      timestamp: "2026-02-24T00:00:00.000Z",
    });

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_STATS);
    expect(mockGetDashboardStats).toHaveBeenCalledTimes(1);
  });

  it("throws when api.admin.getDashboardStats returns ok: false", async () => {
    // The hook specifies retry: 2, so we must provide 3 rejections total
    // (initial attempt + 2 retries) to reach the error state.
    const failResponse = { ok: false, stats: null as never, timestamp: "" };
    mockGetDashboardStats.mockResolvedValue(failResponse);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: createWrapper(),
    });

    // Allow up to 5 s for 3 fast retry attempts to complete
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toBe("Failed to fetch dashboard stats");
  });

  it("propagates rejection when getDashboardStats throws", async () => {
    // Provide 3 rejections (initial + 2 retries at retry: 2)
    const err = new Error("Network failure");
    mockGetDashboardStats.mockRejectedValue(err);

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toBe("Network failure");
  });

  it("uses the correct query key [dashboard, stats]", async () => {
    mockGetDashboardStats.mockResolvedValueOnce({
      ok: true,
      stats: MOCK_STATS,
      timestamp: "",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useDashboardStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Query cache should contain data under the expected key
    const cached = queryClient.getQueryData(["dashboard", "stats"]);
    expect(cached).toEqual(MOCK_STATS);
  });

  it("starts in loading state before data arrives", () => {
    // Never resolves — keeps hook in loading state
    mockGetDashboardStats.mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useDashboardStats(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
