/**
 * @file AudienceTab.tsx
 * @description Tab panel that renders an AudienceInsightCard for each audience
 * segment returned by the predictive analytics API.
 */

import React from "react";
import { AudienceInsight } from "../types";
import { AudienceInsightCard } from "../cards/AudienceInsightCard";

interface AudienceTabProps {
  audienceInsights: AudienceInsight[];
}

/**
 * @component AudienceTab
 * @description Tab panel rendering an AudienceInsightCard for each audience segment
 * returned by the predictive analytics API.
 */
export const AudienceTab: React.FC<AudienceTabProps> = ({ audienceInsights }) => {
  return (
    <div className="space-y-6">
      {audienceInsights.map((insight, index) => (
        <AudienceInsightCard key={index} insight={insight} />
      ))}
    </div>
  );
};
