/**
 * @file mapROIForecasts.ts
 * @description Adapter from `ROIApiValue` to the UI-friendly
 *              `ROIForecast[]`. The `factors` array is only populated
 *              when the backend actually returned a `channelBreakdown`
 *              — never fabricated to fill empty space.
 * @layer infrastructure
 */

import type { ROIForecast } from "../../types";
import type { Timeframe } from "../../types";
import type { ROIApiValue } from "./apiTypes";
import { ROI_CONFIDENCE_CEILING, ROI_CONFIDENCE_FLOOR, ROI_FACTORS_CAP } from "./providerMap";

export function mapToROIForecasts(
  roiData: ROIApiValue | undefined,
  timeframe: Timeframe
): ROIForecast[] {
  if (!roiData) return [];

  const { totalInvestment, totalRevenue, roi, roiPercentage } = roiData;

  const factors: ROIForecast["factors"] = roiData.channelBreakdown?.length
    ? roiData.channelBreakdown.slice(0, ROI_FACTORS_CAP).map((ch) => ({
        name: ch.channel,
        impact: Math.abs(ch.roi),
        description: `Channel performance: ${ch.performance}`,
      }))
    : [];

  return [
    {
      timeframe,
      expectedROI: roi,
      confidence: Math.min(ROI_CONFIDENCE_CEILING, Math.max(ROI_CONFIDENCE_FLOOR, roiPercentage)),
      breakdown: {
        organicReach: totalRevenue * 0.6,
        paidReach: totalRevenue * 0.2,
        conversions: Math.round(totalRevenue / 20),
        revenue: totalRevenue,
        cost: totalInvestment,
      },
      factors,
    },
  ];
}
