/**
 * @file useExternalNotifications.ts
 * @description TanStack Query hooks for Slack/Teams external notification webhook config.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExternalNotificationConfig {
  id: string;
  channel: "slack" | "teams";
  webhookUrl: string;
  label: string;
  events: string[];
  createdAt: string;
}

export interface CreateWebhookParams {
  projectId: string;
  channel: "slack" | "teams";
  webhookUrl: string;
  label: string;
  events: string[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchConfigs(projectId: string): Promise<ExternalNotificationConfig[]> {
  const res = await fetch(`/api/backend/external-notifications?projectId=${projectId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch webhook configs");
  const data = (await res.json()) as { ok: boolean; value?: ExternalNotificationConfig[] };
  return data.ok && data.value ? data.value : [];
}

async function createConfig(params: CreateWebhookParams): Promise<ExternalNotificationConfig> {
  const res = await fetch("/api/backend/external-notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to create webhook");
  const data = (await res.json()) as { ok: boolean; value?: ExternalNotificationConfig };
  if (!data.ok || !data.value) throw new Error("Create failed");
  return data.value;
}

async function deleteConfig(id: string): Promise<void> {
  const res = await fetch(`/api/backend/external-notifications/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete webhook");
}

async function testConfig(id: string): Promise<{ sent: boolean }> {
  const res = await fetch(`/api/backend/external-notifications/${id}/test`, { method: "POST" });
  if (!res.ok) throw new Error("Test request failed");
  const data = (await res.json()) as { ok: boolean; value?: { sent: boolean } };
  return data.ok && data.value ? data.value : { sent: false };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useExternalNotificationConfigs(projectId: string) {
  return useQuery({
    queryKey: ["external-notifications", projectId],
    queryFn: () => fetchConfigs(projectId),
    staleTime: 60_000,
  });
}

export function useCreateWebhook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWebhookParams) => createConfig(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["external-notifications", projectId] });
    },
  });
}

export function useDeleteWebhook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConfig(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["external-notifications", projectId] });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => testConfig(id),
  });
}
