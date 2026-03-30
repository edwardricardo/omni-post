/**
 * @file useTeam.ts
 * @description TanStack Query hooks for team management operations.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamMemberDto {
  id: string;
  accountId: string;
  email: string;
  name: string;
  role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
  isActive: boolean;
  joinedAt: string;
  createdAt: string;
}

export interface InviteTeamMemberInput {
  accountId: string;
  email: string;
  name: string;
  role?: "MANAGER" | "MEMBER" | "VIEWER";
  invitedBy?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchTeamMembers(accountId: string): Promise<TeamMemberDto[]> {
  const res = await fetch(`/api/backend/team?accountId=${accountId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch team members");
  const data = (await res.json()) as { ok: boolean; value?: TeamMemberDto[] };
  return data.ok && data.value ? data.value : [];
}

async function inviteTeamMember(input: InviteTeamMemberInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/team/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status === 409) throw new Error("This email is already on your team");
    throw new Error("Failed to invite team member");
  }
  const data = (await res.json()) as { ok: boolean; value?: { id: string } };
  if (!data.ok || !data.value) throw new Error("Invitation failed");
  return data.value;
}

async function updateTeamMemberRole(
  memberId: string,
  newRole: string,
  changerMemberId: string
): Promise<void> {
  const res = await fetch(`/api/backend/team/${memberId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ newRole, changerMemberId }),
  });
  if (!res.ok) throw new Error("Failed to update role");
}

async function removeTeamMember(memberId: string, changerMemberId: string): Promise<void> {
  const res = await fetch(`/api/backend/team/${memberId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ changerMemberId }),
  });
  if (!res.ok) throw new Error("Failed to remove team member");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useTeamMembers(accountId: string) {
  return useQuery({
    queryKey: ["team", accountId],
    queryFn: () => fetchTeamMembers(accountId),
    staleTime: 30_000,
    enabled: !!accountId,
  });
}

export function useInviteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inviteTeamMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useUpdateTeamMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      memberId,
      newRole,
      changerMemberId,
    }: {
      memberId: string;
      newRole: string;
      changerMemberId: string;
    }) => updateTeamMemberRole(memberId, newRole, changerMemberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useRemoveTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, changerMemberId }: { memberId: string; changerMemberId: string }) =>
      removeTeamMember(memberId, changerMemberId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
