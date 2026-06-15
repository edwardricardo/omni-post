/**
 * @file CampaignList.tsx
 * @description Filterable campaign list with status tabs.
 * @layer infrastructure
 */

"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useCampaigns } from "@/hooks/api/useCampaigns";
import type { CampaignDto } from "@/hooks/api/useCampaigns";
import { CampaignCard } from "./CampaignCard.js";

interface CampaignListProps {
  projectId: string;
  onCampaignClick: (campaign: CampaignDto) => void;
}

const STATUS_TABS = [
  { labelKey: "tabAll", value: undefined },
  { labelKey: "tabActive", value: "ACTIVE" },
  { labelKey: "tabDraft", value: "DRAFT" },
  { labelKey: "tabCompleted", value: "COMPLETED" },
  { labelKey: "tabArchived", value: "ARCHIVED" },
] as const;

/**
 * @component CampaignList
 * @description Filterable campaign listing with status tabs (All, Active, Draft,
 * Completed, Archived) rendering CampaignCard items.
 */
export function CampaignList({ projectId, onCampaignClick }: CampaignListProps) {
  const t = useTranslations("campaigns.components");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const campaignParams = useMemo(
    () => ({ projectId, ...(statusFilter ? { status: statusFilter } : {}) }),
    [projectId, statusFilter]
  );

  const { data: campaigns = [], isLoading } = useCampaigns(campaignParams);

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border overflow-hidden">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.labelKey}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">{t("loading")}</div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">{t("emptyTitle")}</p>
          <p className="text-sm mt-1">{t("emptyDescription")}</p>
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
