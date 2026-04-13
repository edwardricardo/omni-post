/**
 * @file useReports.ts
 * @description TanStack Query hooks for managing scheduled reports: list, create, delete, generate.
 * @layer infrastructure/frontend
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface ScheduledReport {
  id: string;
  projectId: string;
  name: string;
  cronSchedule: string;
  format: string;
  recipients: string[];
  filters: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportInput {
  projectId: string;
  name: string;
  cronSchedule: string;
  format: "CSV" | "JSON";
  recipients: string[];
}

/**
 * @hook useReports
 * @description Fetches scheduled analytics reports for a project.
 * @param projectId - The project to fetch reports for, or undefined to disable
 * @returns TanStack Query result with scheduled report array
 */
export function useReports(projectId: string | undefined) {
  return useQuery({
    queryKey: ["reports", projectId],
    queryFn: async (): Promise<ScheduledReport[]> => {
      const params = new URLSearchParams({
        ...(projectId !== undefined && { projectId }),
      });
      const response = await fetch(`/api/backend/reports?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch reports");
      const data = (await response.json()) as {
        ok: boolean;
        data?: ScheduledReport[];
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.data ?? [];
    },
    enabled: !!projectId,
  });
}

/**
 * @hook useCreateReport
 * @description Mutation hook for creating a new scheduled analytics report.
 * @returns TanStack Query mutation that invalidates the reports list on success
 */
export function useCreateReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateReportInput): Promise<void> => {
      const response = await fetch("/api/backend/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to create report" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to create report");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

/**
 * @hook useDeleteReport
 * @description Mutation hook for deleting a scheduled analytics report.
 * @returns TanStack Query mutation that invalidates the reports list on success
 */
export function useDeleteReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/backend/reports/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to delete report" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to delete report");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

/**
 * @hook useGenerateReport
 * @description Mutation hook for triggering on-demand generation of a scheduled report.
 * @returns TanStack Query mutation for the report generation trigger
 */
export function useGenerateReport() {
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/backend/reports/${id}/generate`, {
        method: "POST",
      });
      if (!response.ok) {
        const err = (await response
          .json()
          .catch(() => ({ error: "Failed to trigger report" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to trigger report generation");
      }
    },
  });
}
