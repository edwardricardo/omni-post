/**
 * @file useAccounts.ts
 * @description TanStack Query hooks for admin account management: fetching account summaries
 * and mutating account properties such as name, role, and active status.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminRole } from "@shared/types";
import { api } from "../../lib/apiClient";
import { ApiError } from "@/lib/parseApiError";

/**
 * @hook useAccounts
 * @description Fetches the account summary list for the admin accounts page.
 * @returns Query result with { data: Account[], isLoading, error }
 */
export function useAccounts() {
  return useQuery({
    queryKey: ["accounts", "summary"],
    queryFn: async () => {
      const response = await api.admin.getAccountSummary();

      if (!response.ok) {
        throw new Error("Failed to fetch accounts");
      }

      return response.accounts;
    },
    staleTime: 60000, // 1 minute
  });
}

interface UpdateAccountData {
  name?: string;
  email?: string;
  phone?: string;
  role?: AdminRole;
  isActive?: boolean;
  emailVerified?: boolean;
}

interface UpdateAccountResponse {
  ok: true;
  value: { account: Record<string, unknown> };
}

/**
 * @hook useUpdateAccount
 * @description Mutation that updates an account's properties (name, email, role, active status).
 *   Automatically invalidates the accounts query cache on success.
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAccountData }) => {
      const response = await fetch(`/api/backend/admin/accounts/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw ApiError.fromResponse(response.status, body);
      }

      return response.json() as Promise<UpdateAccountResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
