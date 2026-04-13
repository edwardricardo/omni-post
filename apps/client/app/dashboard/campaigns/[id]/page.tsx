/**
 * @file page.tsx
 * @description Campaign detail page with analytics and post list.
 * @layer client-pages
 */

"use client";

import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@packages/ui";
import { ArrowLeft, Archive } from "lucide-react";
import { useCampaign, useCampaignAnalytics, useArchiveCampaign } from "@/hooks/api/useCampaigns";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";

/**
 * @component CampaignDetailPage
 * @description Shows campaign details including analytics, post list, and archive controls for a specific campaign.
 */
export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const { data: campaign, isLoading } = useCampaign(campaignId);
  const { data: analytics } = useCampaignAnalytics(campaignId);
  const archiveMutation = useArchiveCampaign();

  const handleArchive = useCallback(async () => {
    await archiveMutation.mutateAsync(campaignId);
    router.push("/dashboard/campaigns");
  }, [campaignId, archiveMutation, router]);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading campaign...</div>;
  }

  if (!campaign) {
    return <div className="text-center py-8 text-muted-foreground">Campaign not found</div>;
  }

  const canArchive = campaign.status !== "ARCHIVED";

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/dashboard/campaigns")}
        className="mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Campaigns
      </Button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
          </div>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-1">{campaign.description}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {campaign.startDate
              ? new Date(campaign.startDate).toLocaleDateString()
              : "No start date"}
            {campaign.endDate ? ` - ${new Date(campaign.endDate).toLocaleDateString()}` : ""}
          </p>
        </div>
        {canArchive && (
          <Button variant="outline" onClick={handleArchive} disabled={archiveMutation.isPending}>
            <Archive className="h-4 w-4 mr-2" />
            {archiveMutation.isPending ? "Archiving..." : "Archive"}
          </Button>
        )}
      </div>

      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Posts</p>
            <p className="text-2xl font-bold">{analytics.totalPosts}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Views</p>
            <p className="text-2xl font-bold">{analytics.totalViews.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Engagement</p>
            <p className="text-2xl font-bold">{analytics.totalEngagement.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Eng. Rate</p>
            <p className="text-2xl font-bold">{analytics.avgEngagementRate.toFixed(1)}%</p>
          </div>
        </div>
      )}

      {campaign.utmSource && (
        <div className="rounded-lg border bg-muted/30 p-4 mb-6">
          <h3 className="text-sm font-medium mb-2">UTM Parameters</h3>
          <div className="flex gap-4 text-sm text-muted-foreground">
            {campaign.utmSource && <span>source: {campaign.utmSource}</span>}
            {campaign.utmMedium && <span>medium: {campaign.utmMedium}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
