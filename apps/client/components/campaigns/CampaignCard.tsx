/**
 * @file CampaignCard.tsx
 * @description Campaign card with analytics summary and actions.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { CampaignStatusBadge } from "./CampaignStatusBadge.js";
import { useCampaignAnalytics } from "@/hooks/api/useCampaigns";
import type { CampaignAnalyticsDto, CampaignDto } from "@/hooks/api/useCampaigns";

interface CampaignCardProps {
  campaign: CampaignDto;
  onClick: (campaign: CampaignDto) => void;
  /** Pre-fetched analytics. When provided, the per-campaign analytics query is skipped. */
  analytics?: CampaignAnalyticsDto;
}

function formatDate(dateStr: string | null, noDateLabel: string): string {
  if (!dateStr) return noDateLabel;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * @component CampaignCard
 * @description Individual campaign card displaying name, date range, status badge,
 * and analytics summary with click-through to the campaign detail view.
 */
export function CampaignCard({ campaign, onClick, analytics: analyticsProp }: CampaignCardProps) {
  const t = useTranslations("campaigns.components");
  // Fall back to a per-campaign fetch only when the parent did not supply
  // batched analytics. Passing "" disables the query (hook gates on campaignId).
  const { data: fetchedAnalytics } = useCampaignAnalytics(analyticsProp ? "" : campaign.id);
  const analytics = analyticsProp ?? fetchedAnalytics;

  const handleClick = useCallback(() => {
    onClick(campaign);
  }, [campaign, onClick]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleClick();
      }}
      className="rounded-lg border bg-card p-4 hover:shadow-sm transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-foreground truncate">{campaign.name}</h3>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
              {campaign.description}
            </p>
          )}
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>

      <div className="text-xs text-muted-foreground mt-2">
        {formatDate(campaign.startDate, t("noDate"))}
        {campaign.endDate
          ? ` - ${formatDate(campaign.endDate, t("noDate"))}`
          : ` - ${t("noEndDate")}`}
      </div>

      {analytics && analytics.totalPosts > 0 && (
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <span>{t("statPosts", { count: analytics.totalPosts })}</span>
          <span>{t("statViews", { count: analytics.totalViews })}</span>
          <span>{t("statEngagements", { count: analytics.totalEngagement })}</span>
        </div>
      )}
    </div>
  );
}
