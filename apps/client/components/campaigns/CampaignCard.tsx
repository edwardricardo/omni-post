/**
 * @file CampaignCard.tsx
 * @description Campaign card with analytics summary and actions.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { CampaignStatusBadge } from "./CampaignStatusBadge";
import { useCampaignAnalytics } from "@/hooks/api/useCampaigns";
import type { CampaignDto } from "@/hooks/api/useCampaigns";

interface CampaignCardProps {
  campaign: CampaignDto;
  onClick: (campaign: CampaignDto) => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No date";
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
export function CampaignCard({ campaign, onClick }: CampaignCardProps) {
  const { data: analytics } = useCampaignAnalytics(campaign.id);

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
        {formatDate(campaign.startDate)}
        {campaign.endDate ? ` - ${formatDate(campaign.endDate)}` : " - No end date"}
      </div>

      {analytics && analytics.totalPosts > 0 && (
        <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
          <span>{analytics.totalPosts} posts</span>
          <span>{analytics.totalViews.toLocaleString()} views</span>
          <span>{analytics.totalEngagement.toLocaleString()} engagements</span>
        </div>
      )}
    </div>
  );
}
