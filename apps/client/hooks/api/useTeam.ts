/**
 * @file useTeam.ts
 * @description TanStack Query hooks for team management operations.
 * @layer infrastructure
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
  const body = (await res.json()) as { ok: boolean; data?: TeamMemberDto[] };
  return body.ok && body.data ? body.data : [];
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
  const body = (await res.json()) as { ok: boolean; data?: { id: string } };
  if (!body.ok || !body.data) throw new Error("Invitation failed");
  return body.data;
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

/**
 * @hook useTeamMembers
 * @description Fetches all team members for a given account.
 * @param accountId - The account to fetch team members for
 * @returns TanStack Query result with team member array
 */
export function useTeamMembers(accountId: string) {
  return useQuery({
    queryKey: ["team", accountId],
    queryFn: () => fetchTeamMembers(accountId),
    staleTime: 30_000,
    enabled: !!accountId,
  });
}

/**
 * @hook useInviteTeamMember
 * @description Mutation hook for inviting a new team member by email.
 * @returns TanStack Query mutation that invalidates the team list on success
 */
export function useInviteTeamMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: inviteTeamMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

/**
 * @hook useUpdateTeamMemberRole
 * @description Mutation hook for changing a team member's role.
 * @returns TanStack Query mutation that invalidates the team list on success
 */
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

/**
 * @hook useRemoveTeamMember
 * @description Mutation hook for removing a team member from the account.
 * @returns TanStack Query mutation that invalidates the team list on success
 */
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
