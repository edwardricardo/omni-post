/**
 * @file useListening.ts
 * @description TanStack Query hooks for the brand-listening dashboard — Share of
 *              Voice over the normalized mention corpus and the cursor-paginated
 *              mention feed, fetched through the Next.js proxy with customer
 *              authentication (`GET /api/backend/listening/*`).
 * @hook useShareOfVoice
 * @hook useMentions
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";

// ─── Response Types (mirror the backend DTOs; dates arrive as ISO strings) ───

/** Per-provider Share-of-Voice breakdown (mirrors ProviderShareDTO). */
export interface ProviderShare {
  provider: string;
  brandCount: number;
  marketCount: number;
  totalCount: number;
  sov: number;
}

/** Mention counts by sentiment label (mirrors SentimentBreakdownDTO). */
export interface SentimentBreakdown {
  positive: number;
  neutral: number;
  negative: number;
  unscored: number;
}

/** Share of Voice over a window (mirrors ShareOfVoiceDTO). `sov = brand/market`. */
export interface ShareOfVoice {
  projectId: string;
  since: string;
  until: string;
  brandCount: number;
  marketCount: number;
  totalCount: number;
  sov: number;
  byProvider: ProviderShare[];
  bySentiment: SentimentBreakdown;
}

/** A single brand mention in the feed (mirrors MentionDTO). */
export interface Mention {
  id: string;
  provider: string;
  source: string;
  trackedTermKind: string | null;
  authorName: string;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  authorProviderId: string;
  url: string | null;
  body: string;
  lang: string | null;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  providerCreatedAt: string;
}

/** Cursor-paginated mention feed (mirrors CursorPaginatedResult<MentionDTO>). */
export interface MentionsPage {
  items: Mention[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListeningWindow {
  since?: string;
  until?: string;
}

export interface MentionFilters extends ListeningWindow {
  provider?: string;
  kind?: "BRAND" | "MARKET";
  sentiment?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
}

async function fetchJson<T>(url: string, errorLabel: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`${errorLabel} (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { ok: boolean; data?: T; error?: string };
  // BaseRouteHandler.sendSuccess wraps responses as { ok: true, data: { ... } }.
  if (!body.ok || body.data === undefined) {
    throw new Error(body.error ?? errorLabel);
  }
  return body.data;
}

/**
 * @hook useShareOfVoice
 * @description Fetches Share of Voice for a project over an optional window.
 *              Disabled while `projectId` is empty.
 * @param projectId - Project to scope the metrics to. Required.
 * @param window - Optional `{ since, until }` ISO bounds (server defaults to 30 days).
 * @returns TanStack Query result with the typed ShareOfVoice payload.
 */
export function useShareOfVoice(projectId: string, window: ListeningWindow = {}) {
  return useQuery({
    queryKey: ["listening", "share-of-voice", projectId, window.since ?? "", window.until ?? ""],
    queryFn: async (): Promise<ShareOfVoice> => {
      const params = new URLSearchParams({ projectId });
      if (window.since) params.set("since", window.since);
      if (window.until) params.set("until", window.until);
      return fetchJson<ShareOfVoice>(
        `/api/backend/listening/share-of-voice?${params.toString()}`,
        "Failed to fetch share of voice"
      );
    },
    enabled: projectId.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}

/**
 * @hook useMentions
 * @description Fetches the first page of the brand-mention feed for a project,
 *              with optional provider / kind / sentiment / window filters.
 * @param projectId - Project to scope the feed to. Required.
 * @param filters - Optional feed filters.
 * @returns TanStack Query result with the typed MentionsPage payload.
 */
export function useMentions(projectId: string, filters: MentionFilters = {}) {
  return useQuery({
    queryKey: ["listening", "mentions", projectId, filters],
    queryFn: async (): Promise<MentionsPage> => {
      const params = new URLSearchParams({ projectId });
      if (filters.provider) params.set("provider", filters.provider);
      if (filters.kind) params.set("kind", filters.kind);
      if (filters.sentiment) params.set("sentiment", filters.sentiment);
      if (filters.since) params.set("since", filters.since);
      if (filters.until) params.set("until", filters.until);
      return fetchJson<MentionsPage>(
        `/api/backend/listening/mentions?${params.toString()}`,
        "Failed to fetch mentions"
      );
    },
    enabled: projectId.length > 0,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 2,
  });
}
