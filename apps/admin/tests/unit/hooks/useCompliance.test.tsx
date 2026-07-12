/**
 * Tests for useCompliance
 *
 * The hook fires two parallel fetch calls:
 *   1. /api/backend/admin/compliance/metrics
 *   2. /api/backend/admin/compliance/audit-logs
 * We mock global.fetch for both.
 *
 * @file useCompliance.test.tsx
 * @description Tests for useCompliance
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useCompliance } from "@/hooks/api/useCompliance";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_METRICS_BODY = {
  ok: true,
  data: {
    summary: {
      complianceScore: 85,
      totalAuditLogs: 5000,
      auditLogsLast30Days: 300,
      auditLogsLast7Days: 70,
      failedActionsLast30Days: 15,
      successRate: 95,
    },
    userActivity: { uniqueUsersLast30Days: 40 },
    topActions: [{ action: "LOGIN", count: 100 }],
    topResources: [{ resource: "posts", count: 200 }],
    gdpr: { totalDataSubjects: 500, exportRequests: 5, deletionRequests: 2 },
    generatedAt: "2026-02-24T00:00:00.000Z",
  },
};

const MOCK_AUDIT_LOGS_BODY = {
  ok: true,
  data: {
    ok: true,
    data: [
      {
        id: "log-1",
        userId: "user-1",
        user: { id: "user-1", name: "Alice", email: "alice@example.com", role: "ADMIN" },
        customerUserId: null,
        customerUser: null,
        actorType: "ADMIN",
        action: "UPDATE_POST",
        resource: "posts",
        resourceId: "post-1",
        details: { field: "status" },
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
        success: true,
        error: null,
        createdAt: "2026-02-23T09:00:00.000Z",
      },
      {
        id: "log-2",
        userId: null,
        user: null,
        customerUserId: null,
        customerUser: null,
        actorType: "SYSTEM",
        action: "DELETE_CHANNEL",
        resource: null,
        resourceId: null,
        details: null,
        ipAddress: null,
        userAgent: null,
        success: false,
        error: "Unauthorized",
        createdAt: "2026-02-23T10:00:00.000Z",
      },
    ],
    pagination: { page: 1, limit: 50, total: 2, totalPages: 1, hasMore: false },
  },
};

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

describe("useCompliance", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches both endpoints in parallel and returns mapped data", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_AUDIT_LOGS_BODY });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.current.data?.metrics).toHaveLength(3); // compliance-score, success-rate, gdpr-compliance
    expect(result.current.data?.auditLogs).toHaveLength(2);
  });

  it("maps compliance metrics to correct status using scoreToStatus", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_AUDIT_LOGS_BODY });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const metrics = result.current.data?.metrics ?? [];

    // complianceScore 85 >= 80 → compliant
    const scoreMetric = metrics.find((m) => m.id === "compliance-score");
    expect(scoreMetric?.status).toBe("compliant");
    expect(scoreMetric?.score).toBe(85);

    // successRate 95 >= 80 → compliant
    const successMetric = metrics.find((m) => m.id === "success-rate");
    expect(successMetric?.status).toBe("compliant");

    // gdpr is always compliant/100
    const gdprMetric = metrics.find((m) => m.id === "gdpr-compliance");
    expect(gdprMetric?.status).toBe("compliant");
    expect(gdprMetric?.score).toBe(100);
  });

  it("maps audit logs including null user fallback", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_AUDIT_LOGS_BODY });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const logs = result.current.data?.auditLogs ?? [];
    // First log has a user name
    expect(logs[0]?.user).toBe("Alice");
    expect(logs[0]?.result).toBe("success");

    // Second log has no user — falls back to userId then 'Unknown'
    expect(logs[1]?.user).toBe("Unknown");
    expect(logs[1]?.result).toBe("failure");

    // Admin and system rows carry their actor type unchanged (do-not-regress).
    expect(logs[0]?.actorType).toBe("ADMIN");
    expect(logs[1]?.actorType).toBe("SYSTEM");
  });

  it("resolves a customer-actor row to the customer identity, not the null bucket", async () => {
    const customerAuditBody = {
      ok: true,
      data: {
        ok: true,
        data: [
          {
            id: "log-c1",
            userId: null,
            user: null,
            customerUserId: "cust-1",
            customerUser: {
              id: "cust-1",
              email: "jane@example.com",
              firstName: "Jane",
              lastName: "Doe",
            },
            actorType: "CUSTOMER",
            action: "UPDATE_BILLING",
            resource: "billing",
            resourceId: "sub-1",
            details: null,
            ipAddress: "10.0.0.1",
            userAgent: "Mozilla/5.0",
            success: true,
            error: null,
            createdAt: "2026-02-23T12:00:00.000Z",
          },
        ],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false },
      },
    };

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => customerAuditBody });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const logs = result.current.data?.auditLogs ?? [];
    // The mapper used to join only the AdminUser relation, so a customer actor
    // (user === null, userId === null) collapsed to "Unknown". It must now
    // surface the customer's own identity.
    expect(logs[0]?.user).toBe("Jane Doe");
    expect(logs[0]?.actorType).toBe("CUSTOMER");
  });

  it("throws ApiError when metrics endpoint returns HTTP error", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_AUDIT_LOGS_BODY });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as { status?: number };
    expect(error.status).toBe(500);
  });

  it("throws ApiError when audit-logs endpoint returns HTTP error", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "Forbidden",
      });

    const { result } = renderHook(() => useCompliance(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as { status?: number };
    expect(error.status).toBe(403);
  });

  it("uses [compliance, overview] as query key", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_METRICS_BODY })
      .mockResolvedValueOnce({ ok: true, json: async () => MOCK_AUDIT_LOGS_BODY });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useCompliance(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["compliance", "overview"])).toBeDefined();
  });
});
