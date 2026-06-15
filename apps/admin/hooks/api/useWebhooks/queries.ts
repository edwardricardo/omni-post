/**
 * @file queries.ts
 * @description Read-only TanStack hooks for the webhooks dashboard — metrics
 *              (auto-refresh), DLQ metrics, subscriptions list, projects for
 *              the subscription form, events list (filtered), event detail
 *              (on-demand), webhook DLQ list (filtered), and outbox DLQ list.
 *
 *              Pattern: TkDodo (TanStack Query maintainer) — keep query keys
 *              hierarchical (`["webhooks", ...]`, `["outbox", ...]`) so a
 *              single broad invalidation reaches the right family.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchDlqMetrics,
  fetchOutboxDeadLetter,
  fetchProjectsForSubscriptionForm,
  fetchWebhookDeadLetter,
  fetchWebhookEventDetail,
  fetchWebhookEvents,
  fetchWebhookMetrics,
  fetchWebhookSubscriptions,
} from "./api.js";
import type { DeadLetterFilters, WebhookEventsFilters } from "./types.js";

/**
 * @hook useWebhookMetrics
 * @description Fetches webhook dashboard metrics including success rates, processing times,
 *   per-provider breakdowns, and timeline data. Auto-refreshes every 30 seconds.
 * @param timeRange - Time window for metrics (e.g. "1h", "24h", "7d")
 * @param selectedProvider - Optional provider filter, or undefined for all providers
 * @returns Query result with { data: DashboardMetrics, isLoading, error }
 */
export function useWebhookMetrics(timeRange: string, selectedProvider?: string) {
  return useQuery({
    queryKey: ["webhooks", "metrics", timeRange, selectedProvider],
    queryFn: () => fetchWebhookMetrics(timeRange, selectedProvider),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

/**
 * @hook useDlqMetrics
 * @description Fetches dead-letter queue lifecycle metrics including unresolved, archived,
 *   and outbox totals. Auto-refreshes every 30 seconds.
 * @returns Query result with { data, isLoading, error }
 */
export function useDlqMetrics() {
  return useQuery({
    queryKey: ["dlq", "metrics"],
    queryFn: fetchDlqMetrics,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * @hook useWebhookSubscriptions
 * @description Fetches the list of webhook subscriptions for the admin dashboard.
 *   Cached for 30 seconds. Mutations in this module invalidate `["webhooks", "subscriptions"]`.
 * @returns Query result with { data: WebhookSubscription[], isLoading, error }
 */
export function useWebhookSubscriptions() {
  return useQuery({
    queryKey: ["webhooks", "subscriptions"],
    queryFn: fetchWebhookSubscriptions,
    staleTime: 30_000,
  });
}

/**
 * @hook useProjectsForSubscriptionForm
 * @description Fetches projects for the subscription form's project
 *   selector. Cached for 5 minutes. The backend endpoint currently
 *   returns 404, so the hook returns an empty array on that response
 *   rather than surfacing a hard error.
 * @returns Query result with { data: Array<{ id, name }>, isLoading, error }
 */
export function useProjectsForSubscriptionForm() {
  return useQuery({
    queryKey: ["webhooks", "subscriptions", "projects"],
    queryFn: fetchProjectsForSubscriptionForm,
    staleTime: 5 * 60_000,
  });
}

/**
 * @hook useWebhookEvents
 * @description Fetches paginated webhook events with optional provider/status/search filters.
 *   Cache key includes filters so each filter combination has its own entry.
 * @param filters - Pagination and filter options (page, limit, provider, status, search)
 * @returns Query result with { data: WebhookEventsPage, isLoading, error }
 */
export function useWebhookEvents(filters: WebhookEventsFilters) {
  return useQuery({
    queryKey: ["webhooks", "events", filters],
    queryFn: () => fetchWebhookEvents(filters),
    staleTime: 30_000,
  });
}

/**
 * @hook useWebhookEventDetail
 * @description Fetches a single webhook event by ID for detail dialogs.
 *   Disabled when `eventId` is null. Cached briefly so reopening the same dialog
 *   doesn't refetch immediately.
 * @param eventId - The event id, or null to disable the query
 * @returns Query result with { data: WebhookEvent, isLoading, error }
 */
export function useWebhookEventDetail(eventId: string | null) {
  return useQuery({
    queryKey: ["webhooks", "events", "detail", eventId],
    queryFn: () => fetchWebhookEventDetail(eventId!),
    enabled: !!eventId,
    staleTime: 60_000,
  });
}

/**
 * @hook useWebhookDeadLetterEvents
 * @description Fetches paginated webhook DLQ events with optional provider/search filters.
 * @param filters - Pagination and filter options
 * @returns Query result with { data: DeadLetterPage, isLoading, error }
 */
export function useWebhookDeadLetterEvents(filters: DeadLetterFilters) {
  return useQuery({
    queryKey: ["webhooks", "dlq", filters],
    queryFn: () => fetchWebhookDeadLetter(filters),
    staleTime: 30_000,
  });
}

/**
 * @hook useOutboxDeadLetter
 * @description Fetches paginated outbox dead-letter entries (cross-domain — different
 *   endpoint family from webhook DLQ but co-located in the admin DLQ panel).
 * @param page - Page number (default 1)
 * @param limit - Items per page (default 20)
 * @returns Query result with { data, isLoading, error }
 */
export function useOutboxDeadLetter(page = 1, limit = 20) {
  return useQuery({
    queryKey: ["outbox", "dead-letter", page, limit],
    queryFn: () => fetchOutboxDeadLetter(page, limit),
    staleTime: 30_000,
  });
}
