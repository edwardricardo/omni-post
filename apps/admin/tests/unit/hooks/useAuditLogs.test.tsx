/**
 * Tests for useAuditLogs
 *
 * useAuditLogs delegates to api.audit.getLogs(filters) — we mock the api module.
 *
 * @file useAuditLogs.test.tsx
 * @description Tests for useAuditLogs
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/apiClient", () => ({
  api: {
    audit: {
      getLogs: vi.fn(),
    },
  },
}));

import { useAuditLogs } from "@/hooks/api/useAuditLogs";
import { api } from "@/lib/apiClient";
import type { AuditLog } from "@/lib/api/types";

const mockGetLogs = vi.mocked(api.audit.getLogs);

// Typed against `AuditLog` so the additive actor fields are compile-checked:
// a fixture missing `actorType` / `customerUser` fails tsc, which is the RED
// gate for the type representing a customer actor.
const ADMIN_LOG: AuditLog = {
  id: "log-admin",
  userId: "admin-1",
  action: "UPDATE_POST",
  resource: "posts",
  resourceId: "post-1",
  success: true,
  error: null,
  details: null,
  ipAddress: "127.0.0.1",
  userAgent: "Mozilla/5.0",
  createdAt: "2026-03-01T10:00:00.000Z",
  actorType: "ADMIN",
  customerUserId: null,
  customerUser: null,
};

const CUSTOMER_LOG: AuditLog = {
  id: "log-customer",
  userId: null,
  action: "UPDATE_BILLING",
  resource: "billing",
  resourceId: "sub-1",
  success: true,
  error: null,
  details: null,
  ipAddress: "10.0.0.1",
  userAgent: "Mozilla/5.0",
  createdAt: "2026-03-01T11:00:00.000Z",
  actorType: "CUSTOMER",
  customerUserId: "cust-1",
  customerUser: {
    id: "cust-1",
    email: "jane@example.com",
    firstName: "Jane",
    lastName: "Doe",
  },
};

const MOCK_LOGS = [
  {
    id: "log-1",
    userId: "user-1",
    action: "LOGIN",
    resource: "auth",
    details: "Successful login",
    ipAddress: "127.0.0.1",
    timestamp: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "log-2",
    userId: "user-2",
    action: "CREATE_POST",
    resource: "posts",
    details: "Created post #42",
    ipAddress: "192.168.1.1",
    timestamp: "2026-03-01T11:00:00.000Z",
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAuditLogs", () => {
  beforeEach(() => {
    mockGetLogs.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns audit logs on success", async () => {
    mockGetLogs.mockResolvedValueOnce({
      ok: true,
      logs: MOCK_LOGS,
      filters: {},
    });

    const { result } = renderHook(() => useAuditLogs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_LOGS);
    expect(mockGetLogs).toHaveBeenCalledTimes(1);
  });

  it("passes filters to the API call", async () => {
    mockGetLogs.mockResolvedValueOnce({
      ok: true,
      logs: [],
      filters: {},
    });

    const filters = { action: "LOGIN", limit: 10 };

    const { result } = renderHook(() => useAuditLogs(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockGetLogs).toHaveBeenCalledWith(filters);
  });

  it("throws when getLogs returns ok: false", async () => {
    // Hook has retry: 2, so provide persistent failure for all attempts
    mockGetLogs.mockResolvedValue({
      ok: false,
      logs: [],
      filters: {},
    });

    const { result } = renderHook(() => useAuditLogs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toBe("Failed to fetch audit logs");
  });

  it("propagates network rejection", async () => {
    // Hook has retry: 2, so provide persistent failure for all attempts
    mockGetLogs.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuditLogs(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toContain("Network error");
  });

  it("uses the correct query key [audit, logs, filters]", async () => {
    mockGetLogs.mockResolvedValueOnce({
      ok: true,
      logs: MOCK_LOGS,
      filters: {},
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAuditLogs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["audit", "logs", undefined])).toEqual(MOCK_LOGS);
  });

  describe("customer actor visibility", () => {
    it("surfaces a customer actor's identity without dropping the actor fields", async () => {
      mockGetLogs.mockResolvedValueOnce({
        ok: true,
        logs: [CUSTOMER_LOG],
        filters: {},
      });

      const { result } = renderHook(() => useAuditLogs(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const log = result.current.data?.[0];
      expect(log?.actorType).toBe("CUSTOMER");
      expect(log?.customerUserId).toBe("cust-1");
      expect(log?.customerUser?.email).toBe("jane@example.com");
    });

    it("returns an admin actor row unchanged (do-not-regress)", async () => {
      mockGetLogs.mockResolvedValueOnce({
        ok: true,
        logs: [ADMIN_LOG],
        filters: {},
      });

      const { result } = renderHook(() => useAuditLogs(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.[0]).toEqual(ADMIN_LOG);
    });
  });
});
