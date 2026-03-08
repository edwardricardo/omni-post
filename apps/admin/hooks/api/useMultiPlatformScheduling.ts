/**
 * @file useMultiPlatformScheduling.ts
 * @description TanStack Query hooks for multi-platform scheduling: fetching available slots,
 * optimal posting times, scheduling rules, and mutations for creating individual or bulk slots.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AvailableSlot,
  OptimalTime,
  SchedulingRule,
  CreatedSlot,
  CreateScheduleInput,
  BulkCreateScheduleInput,
} from "../../types/multi-platform-scheduling";

interface UseSchedulingParams {
  projectId: string;
  startDate?: Date;
  endDate?: Date;
}

// Fetch available scheduling slots
export function useScheduleSlots({ projectId, startDate, endDate }: UseSchedulingParams) {
  return useQuery({
    queryKey: ["schedule-slots", projectId, startDate, endDate],
    queryFn: async (): Promise<AvailableSlot[]> => {
      const params = new URLSearchParams({
        projectId,
        ...(startDate !== undefined && { startDate: startDate.toISOString() }),
        ...(endDate !== undefined && { endDate: endDate.toISOString() }),
      });
      const response = await fetch(`/api/backend/api/scheduling/slots?${params}`);
      if (!response.ok) throw new Error("Failed to fetch schedule slots");
      const data = (await response.json()) as {
        ok: boolean;
        value?: { slots: AvailableSlot[] };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value?.slots ?? [];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

// Fetch optimal posting times based on analytics
export function useOptimalTimes({ projectId }: Pick<UseSchedulingParams, "projectId">) {
  return useQuery({
    queryKey: ["optimal-times", projectId],
    queryFn: async (): Promise<OptimalTime[]> => {
      const params = new URLSearchParams({ projectId });
      const response = await fetch(`/api/backend/api/analytics/optimal-times?${params}`);
      if (!response.ok) throw new Error("Failed to fetch optimal times");
      const data = (await response.json()) as {
        ok: boolean;
        value?: { optimalTimes: OptimalTime[] };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value?.optimalTimes ?? [];
    },
    staleTime: 60 * 60 * 1000, // 1 hour (this data doesn't change frequently)
  });
}

// Fetch scheduling rules
export function useSchedulingRules({ projectId }: Pick<UseSchedulingParams, "projectId">) {
  return useQuery({
    queryKey: ["scheduling-rules", projectId],
    queryFn: async (): Promise<SchedulingRule[]> => {
      const params = new URLSearchParams({ projectId });
      const response = await fetch(`/api/backend/api/scheduling/rules?${params}`);
      if (!response.ok) throw new Error("Failed to fetch scheduling rules");
      const data = (await response.json()) as {
        ok: boolean;
        value?: { rules: SchedulingRule[] };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value?.rules ?? [];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Create a scheduling slot
export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleData: CreateScheduleInput): Promise<CreatedSlot> => {
      const response = await fetch("/api/backend/api/scheduling/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduleData),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to create" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to create schedule");
      }
      const data = (await response.json()) as { ok: boolean; value: CreatedSlot; error?: string };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-slots"] });
    },
  });
}

// Bulk create scheduling slots
export function useBulkCreateSchedules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkCreateScheduleInput): Promise<CreatedSlot[]> => {
      const response = await fetch("/api/backend/api/scheduling/slots/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to bulk create" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to bulk create schedules");
      }
      const data = (await response.json()) as {
        ok: boolean;
        value?: { slots: CreatedSlot[] };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value?.slots ?? [];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-slots"] });
    },
  });
}
