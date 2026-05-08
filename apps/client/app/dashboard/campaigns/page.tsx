/**
 * @file page.tsx
 * @description Campaigns list page.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";
import { Plus } from "lucide-react";
import { CampaignList } from "@/components/campaigns/CampaignList";
import { CreateCampaignModal } from "@/components/campaigns/CreateCampaignModal";
import type { CampaignDto } from "@/hooks/api/useCampaigns";

/**
 * @component CampaignsPage
 * @description Lists all campaigns for the current project with creation modal and navigation to campaign details.
 */
export default function CampaignsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);

  const projectId = ((user as Record<string, unknown> | null)?.projectId as string) ?? "default";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Organize posts by campaign and track performance
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </Button>
      </div>

      <CampaignList
        projectId={projectId}
        onCampaignClick={(c: CampaignDto) => router.push(`/dashboard/campaigns/${c.id}`)}
      />

      <CreateCampaignModal
        projectId={projectId}
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}
