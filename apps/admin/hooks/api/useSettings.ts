/**
 * @file useSettings.ts
 * @description TanStack Query hooks for platform settings management.
 *   Covers credential CRUD, connection testing, and encryption key rotation.
 *   All mutations invalidate the ["settings"] query family on success.
 * @layer infrastructure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingsStatus {
  groups: Record<string, boolean>;
  overallHealth: "healthy" | "partial" | "unconfigured";
}

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export type GroupCredentials = Record<string, string | null>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/api/backend/admin/settings";

async function settingsFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: T };
  if (!json.ok || !json.data) {
    throw new Error("Unexpected response format");
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * @hook useSettingsStatus
 * @description Fetches configuration status for all credential groups.
 * @returns Query result with { data: SettingsStatus, isLoading, error }
 */
export function useSettingsStatus() {
  return useQuery({
    queryKey: ["settings", "status"],
    queryFn: () => settingsFetch<SettingsStatus>(`${BASE}/status`),
    staleTime: 60000,
  });
}

/**
 * @hook useGroupSettings
 * @description Fetches masked credentials for a specific group.
 * @param group - The credential group name (e.g. "STRIPE")
 * @returns Query result with { data: GroupCredentials, isLoading, error }
 */
export function useGroupSettings(group: string) {
  return useQuery({
    queryKey: ["settings", "group", group],
    queryFn: () => settingsFetch<GroupCredentials>(`${BASE}/${group}`),
    enabled: !!group,
    staleTime: 60000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * @hook useUpdateGroupSettings
 * @description Mutation that saves credentials for a group.
 *   Only sends modified fields. Invalidates settings queries on success.
 * @returns Mutation object with mutate({ group, credentials }) and status fields
 */
export function useUpdateGroupSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      group,
      credentials,
    }: {
      group: string;
      credentials: Record<string, string>;
    }): Promise<void> => {
      const res = await fetch(`${BASE}/${group}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credentials }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/**
 * @hook useDeleteCredential
 * @description Mutation that deletes a single credential key from a group.
 *   Invalidates settings queries on success.
 * @returns Mutation object with mutate({ group, key }) and status fields
 */
export function useDeleteCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ group, key }: { group: string; key: string }): Promise<void> => {
      const res = await fetch(`${BASE}/${group}/${key}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

/**
 * @hook useTestConnection
 * @description Mutation that tests connectivity for a credential group.
 *   Does not invalidate queries since this is a read-only operation.
 * @returns Mutation object with mutate(group) and { data: TestResult }
 */
export function useTestConnection() {
  return useMutation({
    mutationFn: async (group: string): Promise<TestResult> => {
      return settingsFetch<TestResult>(`${BASE}/${group}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    },
  });
}

/**
 * @hook useRotateEncryption
 * @description Mutation that logs an encryption key rotation event.
 *   Invalidates settings queries on success.
 * @returns Mutation object with mutate({ note? }) and status fields
 */
export function useRotateEncryption() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (note?: string): Promise<{ message: string }> => {
      return settingsFetch<{ message: string }>(`${BASE}/encryption/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note !== undefined ? { note } : {}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
