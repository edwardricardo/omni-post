/**
 * @file CompetitiveTab.tsx
 * @description Tab panel that renders a CompetitorAnalysisCard for each competitor
 * account returned by the cross-platform analytics endpoint.
 */

import React from "react";
import { CompetitorAnalysis } from "../types";
import { CompetitorAnalysisCard } from "../cards/CompetitorAnalysisCard";

interface CompetitiveTabProps {
  competitorData: CompetitorAnalysis[];
}

export const CompetitiveTab: React.FC<CompetitiveTabProps> = ({ competitorData }) => {
  return (
    <div className="space-y-6">
      {competitorData.map((competitor, index) => (
        <CompetitorAnalysisCard key={index} competitor={competitor} />
      ))}
    </div>
  );
};
