/**
 * @file useExternalNotifications.ts
 * @description TanStack Query hooks for Slack/Teams external notification webhook config.
 * @layer infrastructure
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
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch webhook configs");
  const body = (await res.json()) as { ok: boolean; data?: ExternalNotificationConfig[] };
  return body.ok && body.data ? body.data : [];
}

async function createConfig(params: CreateWebhookParams): Promise<ExternalNotificationConfig> {
  const res = await fetch("/api/backend/external-notifications", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to create webhook");
  const body = (await res.json()) as { ok: boolean; data?: ExternalNotificationConfig };
  if (!body.ok || !body.data) throw new Error("Create failed");
  return body.data;
}

async function deleteConfig(id: string): Promise<void> {
  const res = await fetch(`/api/backend/external-notifications/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete webhook");
}

async function testConfig(id: string): Promise<{ sent: boolean }> {
  const res = await fetch(`/api/backend/external-notifications/${id}/test`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Test request failed");
  const body = (await res.json()) as { ok: boolean; data?: { sent: boolean } };
  return body.ok && body.data ? body.data : { sent: false };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * @hook useExternalNotificationConfigs
 * @description Fetches Slack/Teams external notification webhook configurations for a project.
 * @param projectId - The project to fetch webhook configs for
 * @returns TanStack Query result with external notification config array
 */
export function useExternalNotificationConfigs(projectId: string) {
  return useQuery({
    queryKey: ["external-notifications", projectId],
    queryFn: () => fetchConfigs(projectId),
    staleTime: 60_000,
  });
}

/**
 * @hook useCreateWebhook
 * @description Mutation hook for creating a new Slack/Teams webhook configuration.
 * @param projectId - The project to associate the webhook with
 * @returns TanStack Query mutation that invalidates the webhook config list on success
 */
export function useCreateWebhook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateWebhookParams) => createConfig(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["external-notifications", projectId] });
    },
  });
}

/**
 * @hook useDeleteWebhook
 * @description Mutation hook for deleting a Slack/Teams webhook configuration.
 * @param projectId - The project the webhook belongs to
 * @returns TanStack Query mutation that invalidates the webhook config list on success
 */
export function useDeleteWebhook(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConfig(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["external-notifications", projectId] });
    },
  });
}

/**
 * @hook useTestWebhook
 * @description Mutation hook for sending a test message to a configured webhook.
 * @returns TanStack Query mutation with sent status result
 */
export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => testConfig(id),
  });
}
