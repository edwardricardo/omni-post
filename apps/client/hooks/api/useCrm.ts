/**
 * @file useCrm.ts
 * @description TanStack Query hooks for CRM integration management.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CrmConnectionDto {
  id: string;
  accountId: string;
  platform: "HUBSPOT" | "SALESFORCE";
  isActive: boolean;
  portalId: string | null;
  instanceUrl: string | null;
  lastSyncAt: string | null;
  createdAt: string;
}

export interface CrmSyncLogDto {
  id: string;
  connectionId: string;
  startedAt: string;
  completedAt: string | null;
  contactsSynced: number;
  activitiesSynced: number;
  status: "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";
  errors: unknown;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConnections(): Promise<CrmConnectionDto[]> {
  const res = await fetch("/api/backend/crm/connections", {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch CRM connections");
  const data = (await res.json()) as { ok: boolean; value?: CrmConnectionDto[] };
  return data.ok && data.value ? data.value : [];
}

async function fetchSyncLogs(platform: string): Promise<CrmSyncLogDto[]> {
  const res = await fetch(`/api/backend/crm/${platform.toLowerCase()}/sync-logs`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch sync logs");
  const data = (await res.json()) as { ok: boolean; value?: CrmSyncLogDto[] };
  return data.ok && data.value ? data.value : [];
}

async function disconnectCrm(platform: string): Promise<void> {
  const res = await fetch(`/api/backend/crm/${platform.toLowerCase()}/disconnect`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to disconnect CRM");
}

async function syncCrm(platform: string): Promise<void> {
  const res = await fetch(`/api/backend/crm/${platform.toLowerCase()}/sync`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to trigger sync");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCrmConnections() {
  return useQuery({
    queryKey: ["crm", "connections"],
    queryFn: fetchConnections,
    staleTime: 30_000,
  });
}

export function useCrmSyncLogs(platform: string) {
  return useQuery({
    queryKey: ["crm", "sync-logs", platform],
    queryFn: () => fetchSyncLogs(platform),
    staleTime: 30_000,
    enabled: !!platform,
  });
}

export function useDisconnectCrm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: disconnectCrm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
  });
}

export function useSyncCrm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncCrm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm"] });
    },
  });
}
