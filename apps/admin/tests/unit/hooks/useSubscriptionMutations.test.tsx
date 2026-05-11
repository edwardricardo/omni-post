/**
 * @file useSubscriptionMutations.test.tsx
 * @description Unit tests for `useStartTrial`, `useEndTrial`, and `useConvertTrial` —
 *   the trial-lifecycle TanStack Query mutation hooks consumed by the admin
 *   subscriptions page. The hooks call `fetch` directly; we mock `global.fetch`.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useStartTrial, useEndTrial, useConvertTrial } from "@/hooks/api/useSubscriptionMutations";

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

describe("useStartTrial", () => {
  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /admin/billing/accounts/:id/trial/start with trialDays body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { accountId: "acc-1", trialDays: 14 } }),
    });

    const { result } = renderHook(() => useStartTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ accountId: "acc-1", trialDays: 14 });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/billing/accounts/acc-1/trial/start",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trialDays: 14 }),
      })
    );
  });

  it("throws when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Account already on trial",
    });

    const { result } = renderHook(() => useStartTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ accountId: "acc-1", trialDays: 14 });
      } catch {
        // swallow — assertion is on isError state
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("propagates network rejection", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const { result } = renderHook(() => useStartTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ accountId: "acc-1", trialDays: 7 });
      } catch {
        // swallow
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("Connection refused");
  });
});

describe("useEndTrial", () => {
  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /admin/billing/accounts/:id/trial/end with reason body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useEndTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ accountId: "acc-1", reason: "violation" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/billing/accounts/acc-1/trial/end",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "violation" }),
      })
    );
  });
});

describe("useConvertTrial", () => {
  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /admin/billing/accounts/:id/trial/convert without billingCycle by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useConvertTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ accountId: "acc-1" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/billing/accounts/acc-1/trial/convert",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      })
    );
  });

  it("includes billingCycle in body when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useConvertTrial(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ accountId: "acc-1", billingCycle: "yearly" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/billing/accounts/acc-1/trial/convert",
      expect.objectContaining({
        body: JSON.stringify({ billingCycle: "yearly" }),
      })
    );
  });
});
