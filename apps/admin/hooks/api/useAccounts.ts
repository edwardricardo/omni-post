/**
 * @file useAccounts.ts
 * @description TanStack Query hooks for admin account management: fetching account summaries
 * and mutating account properties such as name, role, and active status.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AdminRole } from "@shared/types";
import { api } from "../../lib/apiClient";

/**
 * Hook to fetch account summary data
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
 * Hook to update an account
 * Automatically invalidates the accounts query on success
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
        const errorData = await response
          .json()
          .catch(() => ({ message: "Failed to update account" }));
        throw new Error((errorData as { message?: string }).message ?? "Failed to update account");
      }

      return response.json() as Promise<UpdateAccountResponse>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}
