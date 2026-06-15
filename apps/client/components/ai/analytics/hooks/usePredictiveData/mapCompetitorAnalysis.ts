/**
 * @file mapCompetitorAnalysis.ts
 * @description Adapter from `CrossPlatformApiValue` to the UI-friendly
 *              `CompetitorAnalysis[]`. `threats`, `opportunities`, and
 *              `topContentTypes` come straight from the backend — empty
 *              arrays when not provided, never fabricated.
 * @layer infrastructure
 */

import type { CompetitorAnalysis } from "../../types.js";
import type { CrossPlatformApiValue } from "./apiTypes.js";
import { TOP_LIST_CAP } from "./providerMap.js";

function classifyAgainstAverage(value: number, average: number): "above" | "below" | "similar" {
  if (value > average) return "above";
  if (value < average * 0.9) return "below";
  return "similar";
}

export function mapToCompetitorAnalysis(
  crossData: CrossPlatformApiValue | undefined
): CompetitorAnalysis[] {
  if (!crossData) return [];

  const { summary, byProvider, recommendations } = crossData;

  // No provider breakdown — surface the industry-average benchmark.
  if (!byProvider || Object.keys(byProvider).length === 0) {
    return [
      {
        competitor: "Industry Average",
        performance: {
          avgEngagement: summary.avgEngagementRate,
          postFrequency: Math.round(summary.totalPosts / 4),
          topContentTypes: [],
        },
        opportunities: recommendations?.slice(0, TOP_LIST_CAP) ?? [],
        threats: [],
        benchmarkComparison: {
          engagement:
            summary.avgEngagementRate > 3
              ? "above"
              : summary.avgEngagementRate > 1
                ? "similar"
                : "below",
          reach:
            summary.totalReach > 10000 ? "above" : summary.totalReach > 1000 ? "similar" : "below",
          growth: "similar",
        },
      },
    ];
  }

  return Object.entries(byProvider).map(([providerKey, providerData]) => {
    const avgEngagement =
      typeof providerData.avgEngagementRate === "number"
        ? providerData.avgEngagementRate
        : summary.avgEngagementRate;
    const postCount =
      typeof providerData.totalPosts === "number" ? providerData.totalPosts : summary.totalPosts;

    return {
      competitor: providerKey,
      performance: {
        avgEngagement,
        postFrequency: postCount,
        topContentTypes: Array.isArray(providerData.topContentTypes)
          ? providerData.topContentTypes.slice(0, TOP_LIST_CAP)
          : [],
      },
      opportunities: recommendations?.slice(0, TOP_LIST_CAP) ?? [],
      threats: providerData.threats ?? [],
      benchmarkComparison: {
        engagement: classifyAgainstAverage(avgEngagement, summary.avgEngagementRate),
        reach: "similar",
        growth: "similar",
      },
    };
  });
}
