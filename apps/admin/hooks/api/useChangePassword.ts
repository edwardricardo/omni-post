/**
 * @file useChangePassword.ts
 * @description TanStack Query mutation hook for changing the admin user's password.
 *   Used by the /security page's Change Password form.
 * @layer presentation
 */

import { useMutation } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * @function useChangePassword
 * @description Mutation to change the current admin user's password.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async ({ currentPassword, newPassword }: ChangePasswordInput) => {
      const res = await fetch("/api/backend/admin/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Password changed successfully" });
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });
}
