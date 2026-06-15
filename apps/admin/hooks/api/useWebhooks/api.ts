/**
 * @file api.ts
 * @description Internal fetch helpers for the webhooks endpoints — dashboard
 *              metrics, subscriptions CRUD, events listing/detail/export, and
 *              DLQ retry (webhook + outbox families). Errors flow through
 *              `ApiError.fromResponse` so the global MutationCache.onError
 *              handler captures them with structured context.
 * @layer infrastructure
 */

import { ApiError } from "@packages/api-errors";
import type {
  CreateWebhookSubscriptionInput,
  DashboardMetrics,
  DeadLetterFilters,
  DeadLetterPage,
  DlqMetrics,
  OutboxDeadLetterPage,
  UpdateWebhookSubscriptionInput,
  WebhookEvent,
  WebhookEventsFilters,
  WebhookEventsPage,
  WebhookSubscription,
} from "./types";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------------------

export async function fetchWebhookMetrics(
  timeRange: string,
  selectedProvider?: string
): Promise<DashboardMetrics> {
  const params = new URLSearchParams({
    timeRange,
    ...(selectedProvider && selectedProvider !== "all" && { provider: selectedProvider }),
  });
  const json = await jsonFetch<{ ok: boolean; data: DashboardMetrics }>(
    `/api/backend/webhooks/dashboard/metrics?${params}`
  );
  if (!json.ok || !json.data) throw new Error("Failed to fetch webhook metrics data");
  return json.data;
}

export async function fetchDlqMetrics(): Promise<DlqMetrics> {
  const json = await jsonFetch<{ ok: boolean; data: DlqMetrics }>(
    "/api/backend/webhooks/dashboard/dead-letter/metrics"
  );
  return json.data;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export async function fetchWebhookSubscriptions(): Promise<WebhookSubscription[]> {
  const json = await jsonFetch<{
    ok?: boolean;
    data?: WebhookSubscription[] | { subscriptions: WebhookSubscription[] };
    subscriptions?: WebhookSubscription[];
  }>("/api/backend/webhooks/dashboard/subscriptions");
  const payload = json.data ?? json;
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object" && "subscriptions" in payload) {
    return (payload as { subscriptions: WebhookSubscription[] }).subscriptions ?? [];
  }
  return [];
}

/**
 * @description Fetches the list of projects for the subscription form
 *              selector. The backend route `GET /api/backend/projects`
 *              does not currently exist; the fetch resolves with `[]`
 *              (selector empty in production) instead of surfacing a
 *              hard error.
 */
export async function fetchProjectsForSubscriptionForm(): Promise<
  Array<{ id: string; name: string }>
> {
  try {
    const res = await fetch("/api/backend/projects", { credentials: "include" });
    if (!res.ok) return [];
    return (await res.json()) as Array<{ id: string; name: string }>;
  } catch {
    return [];
  }
}

export async function createWebhookSubscription(
  input: CreateWebhookSubscriptionInput
): Promise<WebhookSubscription> {
  return jsonFetch<WebhookSubscription>("/api/backend/webhooks/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateWebhookSubscription(input: {
  id: string;
  data: UpdateWebhookSubscriptionInput;
}): Promise<void> {
  await jsonFetch<unknown>(`/api/backend/webhooks/subscriptions/${input.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.data),
  });
}

export async function deleteWebhookSubscription(id: string): Promise<void> {
  await jsonFetch<unknown>(`/api/backend/webhooks/subscriptions/${id}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Webhook events
// ---------------------------------------------------------------------------

export async function fetchWebhookEvents(
  filters: WebhookEventsFilters
): Promise<WebhookEventsPage> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.provider && filters.provider !== "all") params.set("provider", filters.provider);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.search) params.set("search", filters.search);

  const json = await jsonFetch<{
    ok?: boolean;
    data?: WebhookEventsPage;
    events?: WebhookEvent[];
    pagination?: WebhookEventsPage["pagination"];
  }>(`/api/backend/webhooks/dashboard/events?${params}`);

  const payload = json.data ?? json;
  return {
    events: (payload as WebhookEventsPage).events ?? [],
    pagination: (payload as WebhookEventsPage).pagination ?? {
      page: 1,
      limit: 20,
      total: 0,
      pages: 0,
    },
  };
}

export async function fetchWebhookEventDetail(eventId: string): Promise<WebhookEvent> {
  return jsonFetch<WebhookEvent>(`/api/backend/webhooks/dashboard/events/${eventId}`);
}

export async function exportWebhookEvents(filters: {
  provider?: string | undefined;
  status?: string | undefined;
}): Promise<Blob> {
  const params = new URLSearchParams();
  if (filters.provider && filters.provider !== "all") params.set("provider", filters.provider);
  if (filters.status && filters.status !== "all") params.set("status", filters.status);

  const res = await fetch(`/api/backend/webhooks/dashboard/export?${params}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.blob();
}

// ---------------------------------------------------------------------------
// Webhook DLQ
// ---------------------------------------------------------------------------

export async function fetchWebhookDeadLetter(filters: DeadLetterFilters): Promise<DeadLetterPage> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.provider && filters.provider !== "all") params.set("provider", filters.provider);
  if (filters.search) params.set("search", filters.search);

  const json = await jsonFetch<{
    ok?: boolean;
    data?: DeadLetterPage;
    events?: DeadLetterPage["events"];
    pagination?: DeadLetterPage["pagination"];
  }>(`/api/backend/webhooks/dashboard/dead-letter?${params}`);

  const payload = json.data ?? json;
  return {
    events: (payload as DeadLetterPage).events ?? [],
    pagination: (payload as DeadLetterPage).pagination ?? {
      page: 1,
      limit: 20,
      total: 0,
      pages: 0,
    },
  };
}

export async function retryWebhookDeadLetter(eventId: string): Promise<void> {
  await jsonFetch<unknown>(`/api/backend/webhooks/dashboard/dead-letter/${eventId}/retry`, {
    method: "POST",
  });
}

export async function retryAllWebhookDeadLetter(): Promise<void> {
  await jsonFetch<unknown>("/api/backend/webhooks/dashboard/dead-letter/retry-all", {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Outbox DLQ
// ---------------------------------------------------------------------------

export async function fetchOutboxDeadLetter(
  page: number,
  limit: number
): Promise<OutboxDeadLetterPage> {
  const json = await jsonFetch<{ ok?: boolean; data: OutboxDeadLetterPage }>(
    `/api/backend/admin/outbox/dead-letter?page=${page}&limit=${limit}`
  );
  return json.data;
}

export async function retryOutboxDeadLetter(id: string): Promise<void> {
  const res = await fetch(`/api/backend/admin/outbox/dead-letter/${id}/retry`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Retry failed");
}

export async function resolveOutboxDeadLetter(id: string): Promise<void> {
  const res = await fetch(`/api/backend/admin/outbox/dead-letter/${id}/resolve`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Resolve failed");
}
