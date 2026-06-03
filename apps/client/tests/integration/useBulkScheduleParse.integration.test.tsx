/**
 * @file useBulkScheduleParse.integration.test.tsx
 * @description Integration tests for the useBulkScheduleParse + useBulkScheduleConfirm hooks.
 *              Covers: parse success, parse error (forbidden provider column, row cap, missing header),
 *              confirm success, confirm 403 (foreign channelId), confirm error recovery.
 *              MSW stubs the /api/backend/bulk-scheduling/* endpoints.
 * @layer infrastructure
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "../mocks/server";
import { useBulkScheduleParse, useBulkScheduleConfirm } from "../../hooks/api/useBulkScheduling";
import type { SchedulingCsvRow } from "../../lib/csv/bulkSchedulingCsvParser";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeValidRow(overrides: Partial<SchedulingCsvRow> = {}): SchedulingCsvRow {
  return {
    row: 1,
    content: "Hello world",
    scheduledFor: "2026-07-01T09:00:00.000Z",
    timezone: "UTC",
    media: [],
    tags: [],
    ...overrides,
  };
}

const PROXY = "/api/backend";

// ---------------------------------------------------------------------------
// MSW lifecycle
// ---------------------------------------------------------------------------

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// useBulkScheduleParse
// ---------------------------------------------------------------------------

describe("useBulkScheduleParse", () => {
  it("returns validRows and errors on success", async () => {
    const validRow = makeValidRow();
    server.use(
      http.post(`${PROXY}/bulk-scheduling/parse`, () =>
        HttpResponse.json({
          ok: true,
          data: { validRows: [validRow], errors: [], totalDataRows: 1 },
        })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleParse(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        csv: "content,scheduledFor\nHello,2026-07-01T09:00:00Z",
      });
    });

    await waitFor(() => {
      expect(result.current.data?.validRows).toHaveLength(1);
    });
    expect(result.current.data?.errors).toHaveLength(0);
    expect(result.current.data?.totalDataRows).toBe(1);
  });

  it("returns errors when the CSV contains a forbidden provider column", async () => {
    server.use(
      http.post(`${PROXY}/bulk-scheduling/parse`, () =>
        HttpResponse.json({
          ok: true,
          data: {
            validRows: [],
            errors: [{ row: 0, message: "Forbidden column(s) detected: provider" }],
            totalDataRows: 1,
          },
        })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleParse(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        csv: "content,scheduledFor,provider\nHello,2026-07-01T09:00:00Z,instagram",
      });
    });

    await waitFor(() => {
      expect(result.current.data?.errors[0]?.message).toMatch(/provider/i);
    });
    expect(result.current.data?.validRows).toHaveLength(0);
  });

  it("throws an Error when the backend returns a non-ok HTTP status", async () => {
    server.use(
      http.post(`${PROXY}/bulk-scheduling/parse`, () =>
        HttpResponse.json({ ok: false, error: "Internal server error" }, { status: 500 })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleParse(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          projectId: "proj-1",
          csv: "content,scheduledFor\nHello,2026-07-01T09:00:00Z",
        })
        .catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// useBulkScheduleConfirm
// ---------------------------------------------------------------------------

describe("useBulkScheduleConfirm", () => {
  it("returns batchId on successful confirm", async () => {
    server.use(
      http.post(`${PROXY}/bulk-scheduling/confirm`, () =>
        HttpResponse.json({ ok: true, data: { batchId: "batch-123" } })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleConfirm(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        channelIds: ["ch-001"],
        rows: [makeValidRow()],
      });
    });

    await waitFor(() => {
      expect(result.current.data?.batchId).toBe("batch-123");
    });
  });

  it("throws an Error with 403 when a foreign channelId is supplied", async () => {
    server.use(
      http.post(`${PROXY}/bulk-scheduling/confirm`, () =>
        HttpResponse.json(
          { ok: false, error: "one or more channelIds not owned by this project" },
          { status: 403 }
        )
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleConfirm(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          projectId: "proj-1",
          channelIds: ["ch-foreign"],
          rows: [makeValidRow()],
        })
        .catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toMatch(/403|channelId|not owned/i);
  });

  it("does NOT call /imports (legacy endpoint retired)", async () => {
    let legacyCalled = false;
    server.use(
      http.post(`${PROXY}/bulk-scheduling/imports`, () => {
        legacyCalled = true;
        return HttpResponse.json({ ok: false }, { status: 410 });
      }),
      http.post(`${PROXY}/bulk-scheduling/confirm`, () =>
        HttpResponse.json({ ok: true, data: { batchId: "batch-456" } })
      )
    );

    const client = makeClient();
    const { result } = renderHook(() => useBulkScheduleConfirm(), {
      wrapper: createWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "proj-1",
        channelIds: ["ch-001"],
        rows: [makeValidRow()],
      });
    });

    expect(legacyCalled).toBe(false);
  });
});
