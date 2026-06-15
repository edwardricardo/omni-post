/**
 * @file CompetitiveTab.tsx
 * @description Tab panel that renders a CompetitorAnalysisCard for each competitor
 * account returned by the cross-platform analytics endpoint.
 * @component CompetitiveTab
 * @layer infrastructure
 */

import React from "react";
import { CompetitorAnalysis } from "../types.js";
import { CompetitorAnalysisCard } from "../cards/CompetitorAnalysisCard.js";

interface CompetitiveTabProps {
  competitorData: CompetitorAnalysis[];
}

/**
 * @component CompetitiveTab
 * @description Tab panel rendering a CompetitorAnalysisCard for each competitor account
 * returned by the cross-platform analytics endpoint.
 */
export const CompetitiveTab: React.FC<CompetitiveTabProps> = ({ competitorData }) => {
  return (
    <div className="space-y-6">
      {competitorData.map((competitor, index) => (
        <CompetitorAnalysisCard key={index} competitor={competitor} />
      ))}
    </div>
  );
};
