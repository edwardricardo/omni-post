/**
 * @file useAccountSessions.ts
 * @description TanStack Query hooks for fetching and revoking admin sessions
 *   tied to a specific account.
 * @layer presentation
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface AccountSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
}

/**
 * @description Fetches active sessions for a given account.
 */
export function useAccountSessions(accountId: string | null) {
  return useQuery<AccountSession[]>({
    queryKey: ["account", "sessions", accountId],
    queryFn: async () => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/sessions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const json = (await res.json()) as {
        ok?: boolean;
        data?: { sessions?: AccountSession[] };
      };
      return json.data?.sessions ?? [];
    },
    enabled: !!accountId,
    staleTime: 30_000,
    retry: 1,
  });
}

/**
 * @description Revokes all sessions for a given account.
 */
export function useRevokeAccountSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/revoke-sessions`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to revoke sessions");
      return res.json();
    },
    onSuccess: (_data, accountId) => {
      qc.invalidateQueries({ queryKey: ["account", "sessions", accountId] });
    },
  });
}
