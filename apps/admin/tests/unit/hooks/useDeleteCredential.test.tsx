/**
 * @file useDeleteCredential.test.tsx
 * @description Unit tests for `useDeleteCredential` — the TanStack Query
 *   mutation that DELETEs a single credential key from a platform group.
 *   Wired into the admin `CredentialForm` per-field delete button.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useDeleteCredential } from "@/hooks/api/useSettings";

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

describe("useDeleteCredential", () => {
  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues DELETE to /admin/settings/<group>/<key> with credentials: include", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => useDeleteCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ group: "STRIPE", key: "STRIPE_API_KEY" });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/settings/STRIPE/STRIPE_API_KEY",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
      })
    );
  });

  it("throws ApiError when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Credential not found",
    });

    const { result } = renderHook(() => useDeleteCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ group: "STRIPE", key: "MISSING" });
      } catch {
        // swallow — assertion is on isError state
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("propagates network rejection", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const { result } = renderHook(() => useDeleteCredential(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ group: "AI", key: "OPENAI_API_KEY" });
      } catch {
        // swallow
      }
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("Connection refused");
  });
});
