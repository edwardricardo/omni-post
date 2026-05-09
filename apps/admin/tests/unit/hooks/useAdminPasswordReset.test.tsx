/**
 * @file useAdminPasswordReset.test.tsx
 * @description Integration tests for `useAdminPasswordReset` — guards against
 *              the L-330 regression: silent failure without error handling.
 *              Verifies that the hook propagates `ApiError` on !ok responses,
 *              succeeds on ok responses, and calls the correct backend
 *              endpoint with POST. Written verification-first to confirm the
 *              T2-E retroactive fix actually resolved the finding.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAdminPasswordReset } from "@/hooks/api/useAdminPasswordReset";
import { ApiError } from "@packages/api-errors";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe("useAdminPasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the correct backend endpoint with POST on mutate", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const { result } = renderHook(() => useAdminPasswordReset(), {
      wrapper: createWrapper(makeClient()),
    });

    result.current.mutate("user-123");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/admin/users/user-123/password-reset",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      })
    );
  });

  it("propagates ApiError when the request returns !ok (no silent failure)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () =>
        JSON.stringify({
          error: { code: "PERMISSION_DENIED", message: "Insufficient permissions" },
        }),
    });

    const { result } = renderHook(() => useAdminPasswordReset(), {
      wrapper: createWrapper(makeClient()),
    });

    result.current.mutate("user-123");

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(403);
    expect((result.current.error as ApiError).code).toBe("PERMISSION_DENIED");
  });

  it("propagates a generic ApiError on 500 with non-JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "<html>nginx error page</html>",
    });

    const { result } = renderHook(() => useAdminPasswordReset(), {
      wrapper: createWrapper(makeClient()),
    });

    result.current.mutate("user-456");

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).status).toBe(500);
    expect((result.current.error as ApiError).isServerError).toBe(true);
  });

  it("returns the parsed JSON response on success", async () => {
    const responseBody = { ok: true, message: "Reset email sent" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => responseBody,
    });

    const { result } = renderHook(() => useAdminPasswordReset(), {
      wrapper: createWrapper(makeClient()),
    });

    result.current.mutate("user-789");

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(result.current.data).toEqual(responseBody);
  });

  it("invokes the consumer-supplied onError callback on failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    });

    const onError = vi.fn();
    const onSuccess = vi.fn();

    const { result } = renderHook(() => useAdminPasswordReset(), {
      wrapper: createWrapper(makeClient()),
    });

    result.current.mutate("user-missing", { onError, onSuccess });

    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(ApiError);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
