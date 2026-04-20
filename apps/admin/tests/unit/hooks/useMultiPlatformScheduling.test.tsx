/**
 * Tests for useMultiPlatformScheduling:
 *   useScheduleSlots, useOptimalTimes, useSchedulingRules,
 *   useCreateSchedule, useBulkCreateSchedules
 *
 * All hooks call fetch directly — we mock global.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useScheduleSlots,
  useOptimalTimes,
  useSchedulingRules,
  useCreateSchedule,
  useBulkCreateSchedules,
} from "@/hooks/api/useMultiPlatformScheduling";
import type {
  AvailableSlot,
  OptimalTime,
  SchedulingRule,
  CreatedSlot,
} from "@/types/multi-platform-scheduling";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PROJECT_ID = "proj-xyz";

const MOCK_SLOTS: AvailableSlot[] = [
  { datetime: "2026-02-25T09:00:00.000Z", dayOfWeek: 2, hour: 9, minute: 0, available: true },
  {
    datetime: "2026-02-25T14:00:00.000Z",
    dayOfWeek: 2,
    hour: 14,
    minute: 0,
    available: false,
    reason: "Blackout",
  },
];

const MOCK_OPTIMAL_TIMES: OptimalTime[] = [
  { dayOfWeek: 2, hour: 9, avgEngagement: 0.08, sampleSize: 50, confidence: 0.85 },
  { dayOfWeek: 4, hour: 12, avgEngagement: 0.12, sampleSize: 70, confidence: 0.9 },
];

const MOCK_RULES: SchedulingRule[] = [
  {
    id: "rule-1",
    name: "Weekday morning rule",
    description: "Post weekdays 9-11am",
    isActive: true,
    contentTypes: ["text", "image"],
    platforms: ["x", "instagram"],
    timezone: "UTC",
    optimalTimes: null,
    blackoutPeriods: null,
    maxPostsPerDay: 3,
    maxPostsPerHour: 1,
    minIntervalMinutes: 60,
    priorityBoost: null,
    hashtagRules: null,
    timesApplied: 42,
    successRate: 0.92,
    avgPerformance: 0.078,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  },
];

const MOCK_CREATED_SLOT: CreatedSlot = {
  id: "slot-99",
  projectId: PROJECT_ID,
  name: "Custom slot",
  isActive: true,
  platforms: ["x"],
  timezone: "UTC",
  slot: { dayOfWeek: 1, hour: 10, minute: 0 },
  createdAt: "2026-02-24T00:00:00.000Z",
};

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

describe("useScheduleSlots", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches slots and returns array on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { slots: MOCK_SLOTS } }),
    });

    const { result } = renderHook(() => useScheduleSlots({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_SLOTS);
  });

  it("calls URL with projectId query param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { slots: MOCK_SLOTS } }),
    });

    const { result } = renderHook(() => useScheduleSlots({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/backend/scheduling/slots");
    expect(url).toContain(`projectId=${PROJECT_ID}`);
  });

  it("appends startDate and endDate when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { slots: [] } }),
    });

    const start = new Date("2026-03-01T00:00:00.000Z");
    const end = new Date("2026-03-07T00:00:00.000Z");

    const { result } = renderHook(
      () => useScheduleSlots({ projectId: PROJECT_ID, startDate: start, endDate: end }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("startDate=");
    expect(url).toContain("endDate=");
  });

  it("throws when HTTP error occurs", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const { result } = renderHook(() => useScheduleSlots({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("Failed to fetch schedule slots");
  });
});

describe("useOptimalTimes", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches optimal times and returns array on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { optimalTimes: MOCK_OPTIMAL_TIMES } }),
    });

    const { result } = renderHook(() => useOptimalTimes({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_OPTIMAL_TIMES);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/backend/analytics/optimal-times");
    expect(url).toContain(`projectId=${PROJECT_ID}`);
  });

  it("throws when api returns ok: false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, error: "No data" }),
    });

    const { result } = renderHook(() => useOptimalTimes({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("No data");
  });
});

describe("useSchedulingRules", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches scheduling rules and returns array on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { rules: MOCK_RULES } }),
    });

    const { result } = renderHook(() => useSchedulingRules({ projectId: PROJECT_ID }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(MOCK_RULES);
    expect(result.current.data?.[0]?.name).toBe("Weekday morning rule");
  });
});

describe("useCreateSchedule", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to the slots endpoint and returns CreatedSlot", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_CREATED_SLOT }),
    });

    const { result } = renderHook(() => useCreateSchedule(), {
      wrapper: createWrapper(),
    });

    let created: CreatedSlot | undefined;
    await act(async () => {
      created = await result.current.mutateAsync({
        projectId: PROJECT_ID,
        dayOfWeek: 1,
        hour: 10,
        providers: ["x"],
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/scheduling/slots",
      expect.objectContaining({ method: "POST" })
    );
    expect(created?.id).toBe("slot-99");
  });

  it("throws when POST response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "Slot conflicts with existing rule" }),
    });

    const { result } = renderHook(() => useCreateSchedule(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: PROJECT_ID,
          dayOfWeek: 1,
          hour: 10,
          providers: ["x"],
        })
      ).rejects.toThrow("Slot conflicts with existing rule");
    });
  });
});

describe("useBulkCreateSchedules", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs to bulk endpoint and returns CreatedSlot[]", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { slots: [MOCK_CREATED_SLOT] } }),
    });

    const { result } = renderHook(() => useBulkCreateSchedules(), {
      wrapper: createWrapper(),
    });

    let slots: CreatedSlot[] | undefined;
    await act(async () => {
      slots = await result.current.mutateAsync({
        projectId: PROJECT_ID,
        slots: [{ dayOfWeek: 1, hour: 10, providers: ["x"] }],
        timezone: "UTC",
        isActive: true,
      });
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/scheduling/slots/bulk",
      expect.objectContaining({ method: "POST" })
    );
    expect(slots).toHaveLength(1);
    expect(slots?.[0]?.id).toBe("slot-99");
  });

  it("throws when bulk POST is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid slot data" }),
    });

    const { result } = renderHook(() => useBulkCreateSchedules(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          projectId: PROJECT_ID,
          slots: [],
        })
      ).rejects.toThrow("Invalid slot data");
    });
  });
});
