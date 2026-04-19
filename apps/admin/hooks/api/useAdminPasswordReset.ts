/**
 * @file useAdminPasswordReset.ts
 * @description TanStack Query mutation hook for initiating a password reset
 *   for another admin user. Triggers a backend call that sends a reset email.
 * @layer infrastructure
 */

import { useMutation } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

/**
 * @hook useAdminPasswordReset
 * @description Mutation that triggers a password reset email for a target admin user.
 * @returns Mutation object with mutate(userId) and status fields
 */
export function useAdminPasswordReset() {
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/backend/admin/users/${userId}/password-reset`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
  });
}
