/**
 * @file page.tsx
 * @component TeamSettingsPage
 * @description Team management settings page.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { Button } from "@packages/ui";
import { UserPlus } from "lucide-react";
import { TeamPage } from "@/components/team/TeamPage";
import { InviteMemberModal } from "@/components/team/InviteMemberModal";
import { useTeamMembers } from "@/hooks/api/useTeam";

export default function TeamSettingsPage() {
  const { user } = useAuth();
  const [showInvite, setShowInvite] = useState(false);

  const accountId = ((user as Record<string, unknown> | null)?.accountId as string) ?? "";
  const userId = user?.id ?? "";
  const userRole = ((user as Record<string, unknown> | null)?.role as string) ?? "MEMBER";
  const typedRole = (
    ["OWNER", "MANAGER", "MEMBER", "VIEWER"].includes(userRole) ? userRole : "MEMBER"
  ) as "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";

  const { data: members = [] } = useTeamMembers(accountId);
  const activeCount = members.filter((m) => m.isActive).length;
  const canInvite = typedRole === "OWNER" || typedRole === "MANAGER";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeCount} member{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        {canInvite && (
          <Button onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      <TeamPage accountId={accountId} currentUserId={userId} currentUserRole={typedRole} />

      <InviteMemberModal
        accountId={accountId}
        invitedBy={userId}
        open={showInvite}
        onClose={() => setShowInvite(false)}
      />
    </div>
  );
}
