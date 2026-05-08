/**
 * @file useMultiPlatformScheduling.ts
 * @description TanStack Query hooks for multi-platform scheduling: listing
 *   available slots, optimal posting times, scheduling rules, and creating
 *   slots (single + bulk). All calls go through the Next.js /api/backend proxy.
 * @layer infrastructure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AvailableSlot,
  OptimalTime,
  SchedulingRule,
  CreatedSlot,
  CreateScheduleInput,
  BulkCreateScheduleInput,
} from "@/types/multi-platform-scheduling";

interface ScheduleSlotsParams {
  projectId: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * @hook useScheduleSlots
 * @description Lists available scheduling slots for a project, optionally within a date range.
 */
export function useScheduleSlots(params: ScheduleSlotsParams) {
  const { projectId, startDate, endDate } = params;
  return useQuery({
    queryKey: ["scheduling", "slots", projectId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async (): Promise<AvailableSlot[]> => {
      const qs = new URLSearchParams({ projectId });
      if (startDate) qs.set("startDate", startDate.toISOString());
      if (endDate) qs.set("endDate", endDate.toISOString());
      const res = await fetch(`/api/backend/scheduling/slots?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch schedule slots");
      const body = (await res.json()) as { ok: boolean; value?: { slots: AvailableSlot[] } };
      if (!body.ok || !body.value) throw new Error("Failed to fetch schedule slots");
      return body.value.slots;
    },
  });
}

interface OptimalTimesParams {
  projectId: string;
  lookbackDays?: number;
}

/**
 * @hook useOptimalTimes
 * @description Returns historical optimal posting times for a project.
 */
export function useOptimalTimes(params: OptimalTimesParams) {
  const { projectId, lookbackDays } = params;
  return useQuery({
    queryKey: ["scheduling", "optimalTimes", projectId, lookbackDays],
    queryFn: async (): Promise<OptimalTime[]> => {
      const qs = new URLSearchParams({ projectId });
      if (lookbackDays) qs.set("lookbackDays", String(lookbackDays));
      const res = await fetch(`/api/backend/analytics/optimal-times?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch optimal times");
      const body = (await res.json()) as {
        ok: boolean;
        value?: { optimalTimes: OptimalTime[] };
        error?: string;
      };
      if (!body.ok) throw new Error(body.error ?? "Failed to fetch optimal times");
      return body.value?.optimalTimes ?? [];
    },
  });
}

interface SchedulingRulesParams {
  projectId: string;
  isActive?: boolean;
}

/**
 * @hook useSchedulingRules
 * @description Lists scheduling rules for a project, optionally filtered by active state.
 */
export function useSchedulingRules(params: SchedulingRulesParams) {
  const { projectId, isActive } = params;
  return useQuery({
    queryKey: ["scheduling", "rules", projectId, isActive],
    queryFn: async (): Promise<SchedulingRule[]> => {
      const qs = new URLSearchParams({ projectId });
      if (isActive !== undefined) qs.set("isActive", String(isActive));
      const res = await fetch(`/api/backend/scheduling/rules?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch scheduling rules");
      const body = (await res.json()) as { ok: boolean; value?: { rules: SchedulingRule[] } };
      if (!body.ok || !body.value) throw new Error("Failed to fetch scheduling rules");
      return body.value.rules;
    },
  });
}

/**
 * @hook useCreateSchedule
 * @description Mutation that creates a single scheduling slot.
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateScheduleInput): Promise<CreatedSlot> => {
      const res = await fetch("/api/backend/scheduling/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? "Failed to create schedule");
      }
      const body = (await res.json()) as { ok: boolean; value?: CreatedSlot };
      if (!body.ok || !body.value) throw new Error("Failed to create schedule");
      return body.value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduling"] });
    },
  });
}

/**
 * @hook useBulkCreateSchedules
 * @description Mutation that creates multiple scheduling slots in one request.
 */
export function useBulkCreateSchedules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkCreateScheduleInput): Promise<CreatedSlot[]> => {
      const res = await fetch("/api/backend/scheduling/slots/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const errorBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorBody.error ?? "Failed to bulk-create schedules");
      }
      const body = (await res.json()) as { ok: boolean; value?: { slots: CreatedSlot[] } };
      if (!body.ok || !body.value) throw new Error("Failed to bulk-create schedules");
      return body.value.slots;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduling"] });
    },
  });
}
