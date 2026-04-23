/**
 * @file useAdminUsers.ts
 * @description TanStack Query hooks for fetching and mutating admin users.
 * Provides listing, creation, activation, and deactivation of admin accounts.
 * @layer infrastructure
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface AdminUsersResponse {
  users: AdminUser[];
}

interface CreateAdminUserResponse {
  user: AdminUser;
  temporaryPassword: string;
}

/**
 * @hook useAdminUsers
 * @description Fetches all admin users including their roles, MFA status, and last login.
 * @returns Query result with { data: AdminUser[], isLoading, error }
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async (): Promise<AdminUser[]> => {
      const res = await fetch("/api/backend/admin/users", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data?: AdminUsersResponse };
      if (!json.ok || !json.data) throw new Error("Failed to fetch admin users");
      return json.data.users;
    },
    staleTime: 60_000,
    retry: 2,
  });
}

/**
 * @hook useCreateAdminUser
 * @description Mutation that creates a new admin user. Returns the created user and a temporary password.
 * @returns Mutation object with mutate({ email, name, role }) and status fields
 */
export function useCreateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      email: string;
      name: string;
      role: string;
    }): Promise<CreateAdminUserResponse> => {
      const res = await fetch("/api/backend/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data?: CreateAdminUserResponse };
      if (!json.ok || !json.data) throw new Error("Unexpected response");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/**
 * @hook useDeactivateAdminUser
 * @description Mutation that deactivates an admin user by ID.
 * @returns Mutation object with mutate(userId) and status fields
 */
export function useDeactivateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/backend/admin/users/${userId}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/**
 * @hook useActivateAdminUser
 * @description Mutation that activates a previously deactivated admin user by ID.
 * @returns Mutation object with mutate(userId) and status fields
 */
export function useActivateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/backend/admin/users/${userId}/activate`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

interface UpdateAdminUserData {
  name?: string;
  email?: string;
  department?: string;
  team?: string;
}

/**
 * @hook useUpdateAdminUser
 * @description Mutation that updates an admin user's profile data (name, email, department, team).
 * @returns Mutation object with mutate({ id, data }) and status fields
 */
export function useUpdateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAdminUserData }) => {
      const res = await fetch(`/api/backend/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
