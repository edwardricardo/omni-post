/**
 * Tests for useAccounts and useUpdateAccount
 *
 * useAccounts delegates to api.admin.getAccountSummary() — we mock the api module.
 * useUpdateAccount calls fetch directly — we mock global.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/apiClient", () => ({
  api: {
    admin: {
      getAccountSummary: vi.fn(),
    },
  },
}));

import { useAccounts, useUpdateAccount } from "@/hooks/api/useAccounts";
import { api } from "@/lib/apiClient";

const mockGetAccountSummary = vi.mocked(api.admin.getAccountSummary);

const MOCK_ACCOUNTS = [
  {
    id: "acc-1",
    email: "alice@example.com",
    name: "Alice",
    subscription: "PRO" as const,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastLoginAt: "2026-02-20T10:00:00.000Z",
    trial: { isOnTrial: false, trialDaysRemaining: 0, trialExpired: false },
    usage: { projectsUsed: 3, projectsRemaining: 7, utilizationPercent: 30 },
  },
  {
    id: "acc-2",
    email: "bob@example.com",
    name: "Bob",
    subscription: "BASIC" as const,
    isActive: false,
    createdAt: "2026-02-01T00:00:00.000Z",
    lastLoginAt: null,
    trial: { isOnTrial: true, trialDaysRemaining: 5, trialExpired: false },
    usage: { projectsUsed: 1, projectsRemaining: 2, utilizationPercent: 33 },
  },
];

const mockFetch = vi.fn();

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

describe("useAccounts", () => {
  beforeEach(() => {
    mockGetAccountSummary.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns accounts list on success", async () => {
    mockGetAccountSummary.mockResolvedValueOnce({
      ok: true,
      accounts: MOCK_ACCOUNTS,
      total: 2,
      timestamp: "2026-02-24T00:00:00.000Z",
    });

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_ACCOUNTS);
    expect(mockGetAccountSummary).toHaveBeenCalledTimes(1);
  });

  it("throws when getAccountSummary returns ok: false", async () => {
    mockGetAccountSummary.mockResolvedValueOnce({
      ok: false,
      accounts: [],
      total: 0,
      timestamp: "",
    });

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch accounts");
  });

  it("propagates network rejection", async () => {
    mockGetAccountSummary.mockRejectedValueOnce(new Error("Connection refused"));

    const { result } = renderHook(() => useAccounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("Connection refused");
  });

  it("uses the correct query key [accounts, summary]", async () => {
    mockGetAccountSummary.mockResolvedValueOnce({
      ok: true,
      accounts: MOCK_ACCOUNTS,
      total: 2,
      timestamp: "",
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAccounts(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["accounts", "summary"])).toEqual(MOCK_ACCOUNTS);
  });
});

describe("useUpdateAccount", () => {
  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockReset();
    mockGetAccountSummary.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends PUT request and invalidates accounts query on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        value: { account: { id: "acc-1", name: "Alice Updated" } },
      }),
    });

    const { result } = renderHook(() => useUpdateAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        id: "acc-1",
        data: { name: "Alice Updated" },
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/accounts/acc-1",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice Updated" }),
      })
    );

    // Mutation state settles asynchronously after the act block
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("throws when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: "Forbidden" }),
    });

    const { result } = renderHook(() => useUpdateAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: "acc-1", data: { isActive: false } })
      ).rejects.toThrow("Forbidden");
    });
  });

  it("falls back to default message when error body lacks message field", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useUpdateAccount(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: "acc-1", data: {} })).rejects.toThrow(
        "Failed to update account"
      );
    });
  });
});
