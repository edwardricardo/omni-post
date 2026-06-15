/**
 * @file TeamPage.tsx
 * @component TeamPage
 * @description Main team management component with member list and invite.
 * @layer infrastructure
 */

"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { useTeamMembers, useUpdateTeamMemberRole, useRemoveTeamMember } from "@/hooks/api/useTeam";
import { TeamMemberRow } from "./TeamMemberRow.js";

interface TeamPageProps {
  accountId: string;
  currentUserId: string;
  currentUserRole: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
}

export function TeamPage({ accountId, currentUserId, currentUserRole }: TeamPageProps) {
  const t = useTranslations("team");
  const { data: members = [], isLoading } = useTeamMembers(accountId);
  const updateRoleMutation = useUpdateTeamMemberRole();
  const removeMutation = useRemoveTeamMember();

  const handleUpdateRole = useCallback(
    (memberId: string, newRole: string) => {
      updateRoleMutation.mutate({ memberId, newRole, changerMemberId: currentUserId });
    },
    [currentUserId, updateRoleMutation]
  );

  const handleRemove = useCallback(
    (memberId: string) => {
      removeMutation.mutate({ memberId, changerMemberId: currentUserId });
    },
    [currentUserId, removeMutation]
  );

  const activeMembers = members.filter((m) => m.isActive);

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">{t("loading")}</div>;
  }

  if (activeMembers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("emptyTitle")}</p>
        <p className="text-sm mt-1">{t("emptyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      {activeMembers.map((member) => (
        <TeamMemberRow
          key={member.id}
          member={member}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onUpdateRole={handleUpdateRole}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}
