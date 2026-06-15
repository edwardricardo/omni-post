/**
 * @file queries.ts
 * @description Read-only hook for admin users.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAdminUsers } from "./api.js";

/**
 * @hook useAdminUsers
 * @description Fetches all admin users including their roles, MFA status, and last login.
 * @returns Query result with { data: AdminUser[], isLoading, error }
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: fetchAdminUsers,
    staleTime: 60_000,
    retry: 2,
  });
}
