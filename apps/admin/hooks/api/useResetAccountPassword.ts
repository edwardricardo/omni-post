/**
 * @file useResetAccountPassword.ts
 * @description TanStack Query mutation hook for resetting a customer account's password.
 *   Used by the /accounts page's Reset Password action button.
 * @layer presentation
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";

interface ResetPasswordInput {
  accountId: string;
  newPassword: string;
  requirePasswordChange?: boolean;
}

/**
 * @function useResetAccountPassword
 * @description Mutation to reset a customer account's password via admin action.
 */
export function useResetAccountPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, newPassword, requirePasswordChange }: ResetPasswordInput) => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          newPassword,
          ...(requirePasswordChange !== undefined && { requirePasswordChange }),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast({ title: "Success", description: "Password reset successfully" });
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to reset password",
        variant: "destructive",
      });
    },
  });
}
