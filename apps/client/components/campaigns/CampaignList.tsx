/**
 * @file CampaignList.tsx
 * @description Filterable campaign list with status tabs.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import { useCampaigns } from "@/hooks/api/useCampaigns";
import type { CampaignDto } from "@/hooks/api/useCampaigns";
import { CampaignCard } from "./CampaignCard";

interface CampaignListProps {
  projectId: string;
  onCampaignClick: (campaign: CampaignDto) => void;
}

const STATUS_TABS = [
  { label: "All", value: undefined },
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Completed", value: "COMPLETED" },
  { label: "Archived", value: "ARCHIVED" },
] as const;

/**
 * @component CampaignList
 * @description Filterable campaign listing with status tabs (All, Active, Draft,
 * Completed, Archived) rendering CampaignCard items.
 */
export function CampaignList({ projectId, onCampaignClick }: CampaignListProps) {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const { data: campaigns = [], isLoading } = useCampaigns({
    projectId,
    ...(statusFilter ? { status: statusFilter } : {}),
  });

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border overflow-hidden">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No campaigns yet</p>
          <p className="text-sm mt-1">Create your first campaign to organize your content.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} onClick={onCampaignClick} />
          ))}
        </div>
      )}
    </div>
  );
}
