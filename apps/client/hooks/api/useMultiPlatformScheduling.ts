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

/**
 * @hook useScheduleSlots
 * @description Fetches available scheduling slots for a project within an optional date range.
 * @param params - projectId (required), startDate and endDate (optional)
 * @returns TanStack Query result with available slot array, auto-refreshes every 30s
 */
export function useScheduleSlots({ projectId, startDate, endDate }: UseSchedulingParams) {
  return useQuery({
    queryKey: ["schedule-slots", projectId, startDate, endDate],
    queryFn: async (): Promise<AvailableSlot[]> => {
      const params = new URLSearchParams({
        projectId,
        ...(startDate !== undefined && { startDate: startDate.toISOString() }),
        ...(endDate !== undefined && { endDate: endDate.toISOString() }),
      });
      const response = await fetch(`/api/backend/scheduling/slots?${params}`, {
        credentials: "include",
      });
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

/**
 * @hook useOptimalTimes
 * @description Fetches analytics-based optimal posting times for a project.
 * @param params - projectId to fetch optimal times for
 * @returns TanStack Query result with optimal time array
 */
export function useOptimalTimes({ projectId }: Pick<UseSchedulingParams, "projectId">) {
  return useQuery({
    queryKey: ["optimal-times", projectId],
    queryFn: async (): Promise<OptimalTime[]> => {
      const params = new URLSearchParams({ projectId });
      const response = await fetch(`/api/backend/analytics/optimal-times?${params}`, {
        credentials: "include",
      });
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

/**
 * @hook useSchedulingRules
 * @description Fetches scheduling rules configured for a project.
 * @param params - projectId to fetch scheduling rules for
 * @returns TanStack Query result with scheduling rule array
 */
export function useSchedulingRules({ projectId }: Pick<UseSchedulingParams, "projectId">) {
  return useQuery({
    queryKey: ["scheduling-rules", projectId],
    queryFn: async (): Promise<SchedulingRule[]> => {
      const params = new URLSearchParams({ projectId });
      const response = await fetch(`/api/backend/scheduling/rules?${params}`, {
        credentials: "include",
      });
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

/**
 * @hook useCreateSchedule
 * @description Mutation hook for creating a single scheduling slot.
 * @returns TanStack Query mutation that invalidates the schedule slots list on success
 */
export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (scheduleData: CreateScheduleInput): Promise<CreatedSlot> => {
      const response = await fetch("/api/backend/scheduling/slots", {
        method: "POST",
        credentials: "include",
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

/**
 * @hook useBulkCreateSchedules
 * @description Mutation hook for creating multiple scheduling slots in bulk.
 * @returns TanStack Query mutation that invalidates the schedule slots list on success
 */
export function useBulkCreateSchedules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkCreateScheduleInput): Promise<CreatedSlot[]> => {
      const response = await fetch("/api/backend/scheduling/slots/bulk", {
        method: "POST",
        credentials: "include",
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

interface CreateSchedulingRuleInput {
  projectId: string;
  name: string;
  providers: string[];
  frequency?: string;
  active?: boolean;
}

interface UpdateSchedulingRuleInput {
  ruleId: string;
  name: string;
}

interface ToggleSchedulingRuleInput {
  ruleId: string;
  active: boolean;
}

async function parseRuleError(response: Response, fallback: string): Promise<string> {
  const err = (await response.json().catch(() => ({ error: fallback }))) as { error?: string };
  return err.error ?? fallback;
}

/**
 * @hook useCreateSchedulingRule
 * @description Mutation hook for creating a scheduling rule. Invalidates rules cache on success.
 */
export function useCreateSchedulingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSchedulingRuleInput): Promise<SchedulingRule> => {
      const response = await fetch("/api/backend/scheduling/rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: input.projectId,
          name: input.name,
          providers: input.providers,
          frequency: input.frequency ?? "daily",
          active: input.active ?? true,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseRuleError(response, "Failed to create rule"));
      }
      const data = (await response.json()) as {
        ok: boolean;
        value?: SchedulingRule;
        error?: string;
      };
      if (!data.ok || !data.value) throw new Error(data.error ?? "API error");
      return data.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduling-rules"] });
    },
  });
}

/**
 * @hook useUpdateSchedulingRule
 * @description Mutation hook for editing a scheduling rule's name.
 */
export function useUpdateSchedulingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, name }: UpdateSchedulingRuleInput): Promise<SchedulingRule> => {
      const response = await fetch(`/api/backend/scheduling/rules/${ruleId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error(await parseRuleError(response, "Failed to update rule"));
      }
      const data = (await response.json()) as {
        ok: boolean;
        value?: SchedulingRule;
        error?: string;
      };
      if (!data.ok || !data.value) throw new Error(data.error ?? "API error");
      return data.value;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduling-rules"] });
    },
  });
}

/**
 * @hook useToggleSchedulingRule
 * @description Mutation hook for activating/deactivating a scheduling rule.
 */
export function useToggleSchedulingRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ruleId, active }: ToggleSchedulingRuleInput): Promise<void> => {
      const response = await fetch(`/api/backend/scheduling/rules/${ruleId}/toggle`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!response.ok) {
        throw new Error(await parseRuleError(response, "Failed to toggle rule"));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["scheduling-rules"] });
    },
  });
}
