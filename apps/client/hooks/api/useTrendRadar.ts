/**
 * @file useTrendRadar.ts
 * @description TanStack Query hook for the AI trend radar: lists the
 *              account's scored trending topics (multi-source with
 *              provenance per row). Requests go through the /api/backend
 *              proxy, which injects the customer Bearer from the httpOnly
 *              session cookie; the account is scoped server-side from
 *              that token.
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";

/**
 * Wire shape mirroring the server `ScoredTrendDTO`
 * (`apps/api/src/domain/repositories/TrendRadarQueryRepository.ts`).
 * Provider/source/urgency are plain string literals because the
 * server narrows the Prisma enums at the persistence boundary.
 */
export interface ScoredTrend {
  topic: string;
  platform: string;
  source: "PERPLEXITY_WEB" | "ACCOUNT_ANALYTICS" | "INBOX_MENTIONS";
  sourceUrl: string | null;
  relevanceScore: number;
  postIdea: string | null;
  bestPlatform: string | null;
  urgency: "NOW" | "TODAY" | "THIS_WEEK";
  volume: number | null;
  fetchedAt: string;
}

export interface TrendRadarPage {
  scored: ScoredTrend[];
  total: number;
}

const TREND_RADAR_KEY = ["trend-radar"] as const;

async function parseError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.error ?? body.message ?? fallback;
}

/**
 * @hook useTrendRadar
 * @description Fetches the account's current trend radar (non-expired
 *   scored trends ordered by relevance, populated by the TREND_RADAR
 *   worker). Read-only — refresh is automatic via TanStack defaults.
 * @returns TanStack Query result with the trend radar page.
 */
export function useTrendRadar() {
  return useQuery({
    queryKey: TREND_RADAR_KEY,
    queryFn: async (): Promise<TrendRadarPage> => {
      const response = await fetch("/api/backend/trends/radar", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await parseError(response, "Failed to load trend radar"));
      }
      const body = (await response.json()) as {
        ok: boolean;
        data?: TrendRadarPage;
        error?: string;
      };
      if (!body.ok || !body.data) {
        throw new Error(body.error ?? "Failed to load trend radar");
      }
      return body.data;
    },
  });
}
