/**
 * @file usePredictiveData.ts
 * @description TanStack Query hook fetching predictive analytics data
 *              (timing, ROI, audience, competitive) from the four backend
 *              endpoints. Timing, ROI, and competitive are wired to real use
 *              cases; audience (`/ai/predict-audience`) is still 501 until an
 *              audience model lands — this hook surfaces non-2xx / `ok:false` as
 *              an explicit `error` so that tab renders a clear "feature in
 *              development" banner instead of silently showing empty arrays.
 *              Mappers + API types live under `./usePredictiveData/`.
 * @hook usePredictiveData
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import type {
  AudienceInsight,
  CompetitorAnalysis,
  PerformancePrediction,
  ROIForecast,
  Timeframe,
} from "../types.js";
import type {
  ApiEnvelope,
  CrossPlatformApiValue,
  PredictAudienceApiValue,
  PredictTimingApiValue,
  ROIApiValue,
} from "./usePredictiveData/apiTypes.js";
import { mapToAudienceInsights } from "./usePredictiveData/mapAudienceInsights.js";
import { mapToCompetitorAnalysis } from "./usePredictiveData/mapCompetitorAnalysis.js";
import { mapToPerformancePredictions } from "./usePredictiveData/mapTimingPredictions.js";
import { mapToROIForecasts } from "./usePredictiveData/mapROIForecasts.js";
import { toMLProvider } from "./usePredictiveData/providerMap.js";

const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Throws an explicit error when a predictive-analytics endpoint comes
 * back non-2xx or with `ok: false`, so the hook's `error` field
 * accurately reflects the unavailability of the feature instead of
 * silently degrading to empty data.
 */
async function fetchEnvelope<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? "";
    } catch {
      // body wasn't JSON; surface status only
    }
    throw new Error(
      detail
        ? `${input.toString()} → ${res.status} ${detail}`
        : `${input.toString()} → ${res.status}`
    );
  }
  const body = (await res.json()) as ApiEnvelope<T>;
  if (!body.ok || body.data === undefined) {
    throw new Error(body.error ?? body.message ?? `${input.toString()} returned ok=false`);
  }
  return body.data;
}

interface UsePredictiveDataOptions {
  accountId: string;
  platforms: string[];
  timeframe: Timeframe;
  onPredictionUpdate?: (predictions: PerformancePrediction[]) => void;
}

interface UsePredictiveDataResult {
  predictions: PerformancePrediction[];
  roiForecasts: ROIForecast[];
  audienceInsights: AudienceInsight[];
  competitorData: CompetitorAnalysis[];
  isLoading: boolean;
  /** True when at least one of the four queries failed. */
  isError: boolean;
  /** First non-null error from the four queries; useful for banners. */
  error: Error | null;
}

export const usePredictiveData = ({
  accountId,
  platforms,
  timeframe,
  onPredictionUpdate,
}: UsePredictiveDataOptions): UsePredictiveDataResult => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const firstProvider = toMLProvider(platforms[0] ?? "twitter");

  const timingQuery = useQuery<PredictTimingApiValue[]>({
    queryKey: ["predictions-timing", platforms, timeframe],
    enabled: platforms.length > 0,
    staleTime: STALE_TIME_MS,
    queryFn: () =>
      Promise.all(
        platforms.map((p) =>
          fetchEnvelope<PredictTimingApiValue>("/api/backend/ai/predict-timing", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId,
              provider: toMLProvider(p),
              contentType: "text",
              timezone: tz,
              includeActivityPatterns: true,
            }),
          })
        )
      ),
  });

  const roiQuery = useQuery<ROIApiValue>({
    queryKey: ["roi-forecast", accountId, timeframe],
    staleTime: STALE_TIME_MS,
    queryFn: () =>
      fetchEnvelope<ROIApiValue>(
        `/api/backend/analytics/roi?accountId=${accountId}&timeRange=${timeframe}`,
        { credentials: "include" }
      ),
  });

  const audienceQuery = useQuery<PredictAudienceApiValue>({
    queryKey: ["audience-prediction", accountId, firstProvider],
    enabled: platforms.length > 0,
    staleTime: STALE_TIME_MS,
    queryFn: () =>
      fetchEnvelope<PredictAudienceApiValue>("/api/backend/ai/predict-audience", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          contentDescription: {
            type: "mixed",
            topic: "general",
            tone: "professional",
            provider: firstProvider,
          },
          includeOptimizationSuggestions: true,
        }),
      }),
  });

  const competitiveQuery = useQuery<CrossPlatformApiValue>({
    queryKey: ["competitive-analysis", accountId],
    staleTime: STALE_TIME_MS,
    queryFn: () =>
      fetchEnvelope<CrossPlatformApiValue>(
        `/api/backend/analytics/cross-platform?accountId=${accountId}&includeCompetitive=true`,
        { credentials: "include" }
      ),
  });

  const predictions = useMemo(
    () => mapToPerformancePredictions(timingQuery.data, platforms),
    [timingQuery.data, platforms]
  );
  const roiForecasts = useMemo(
    () => mapToROIForecasts(roiQuery.data, timeframe),
    [roiQuery.data, timeframe]
  );
  const audienceInsights = useMemo(
    () => mapToAudienceInsights(audienceQuery.data),
    [audienceQuery.data]
  );
  const competitorData = useMemo(
    () => mapToCompetitorAnalysis(competitiveQuery.data),
    [competitiveQuery.data]
  );

  const isLoading =
    (timingQuery.isLoading && platforms.length > 0) ||
    roiQuery.isLoading ||
    (audienceQuery.isLoading && platforms.length > 0) ||
    competitiveQuery.isLoading;

  const isError =
    timingQuery.isError || roiQuery.isError || audienceQuery.isError || competitiveQuery.isError;

  const error =
    (timingQuery.error as Error | null) ??
    (roiQuery.error as Error | null) ??
    (audienceQuery.error as Error | null) ??
    (competitiveQuery.error as Error | null) ??
    null;

  useEffect(() => {
    if (predictions.length > 0) {
      onPredictionUpdate?.(predictions);
    }
  }, [predictions, onPredictionUpdate]);

  return {
    predictions,
    roiForecasts,
    audienceInsights,
    competitorData,
    isLoading,
    isError,
    error,
  };
};
