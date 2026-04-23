/**
 * @file useAccountSessions.ts
 * @description TanStack Query hooks for fetching and revoking admin sessions
 *   tied to a specific account.
 * @layer infrastructure
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

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
 * @hook useAccountSessions
 * @description Fetches active sessions for a given account.
 * @param accountId - The account ID to fetch sessions for, or null to disable the query
 * @returns Query result with { data: AccountSession[], isLoading, error }
 */
export function useAccountSessions(accountId: string | null) {
  return useQuery<AccountSession[]>({
    queryKey: ["account", "sessions", accountId],
    queryFn: async () => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/sessions`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
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
 * @hook useRevokeAccountSessions
 * @description Mutation that revokes all active sessions for a given account.
 * @returns Mutation object with mutate(accountId) and status fields
 */
export function useRevokeAccountSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/revoke-sessions`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: (_data, accountId) => {
      qc.invalidateQueries({ queryKey: ["account", "sessions", accountId] });
    },
  });
}
