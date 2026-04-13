/**
 * @file TeamPage.tsx
 * @component TeamPage
 * @description Main team management component with member list and invite.
 * @layer client-components
 */

"use client";

import { useCallback } from "react";
import { useTeamMembers, useUpdateTeamMemberRole, useRemoveTeamMember } from "@/hooks/api/useTeam";
import { TeamMemberRow } from "./TeamMemberRow";

interface TeamPageProps {
  accountId: string;
  currentUserId: string;
  currentUserRole: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
}

export function TeamPage({ accountId, currentUserId, currentUserRole }: TeamPageProps) {
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
    return <div className="text-center py-8 text-muted-foreground">Loading team...</div>;
  }

  if (activeMembers.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No team members yet</p>
        <p className="text-sm mt-1">Invite someone to get started.</p>
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
