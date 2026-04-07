/**
 * @file useAdminUsers.ts
 * @description TanStack Query hooks for fetching and mutating admin users.
 * Provides listing, creation, activation, and deactivation of admin accounts.
 * @layer presentation
 */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
 * @description Fetches all admin users.
 */
export function useAdminUsers() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async (): Promise<AdminUser[]> => {
      const res = await fetch("/api/backend/admin/users", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { ok: boolean; data?: AdminUsersResponse };
      if (!json.ok || !json.data) throw new Error("Failed to fetch admin users");
      return json.data.users;
    },
    staleTime: 60_000,
    retry: 2,
  });
}

/**
 * @description Mutation hook for creating a new admin user.
 * Returns the created user and a temporary password.
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
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error((err as { error?: string }).error ?? "Failed to create user");
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
 * @description Mutation hook for deactivating an admin user.
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
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error((err as { error?: string }).error ?? "Failed to deactivate user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/**
 * @description Mutation hook for activating an admin user.
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
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error((err as { error?: string }).error ?? "Failed to activate user");
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
 * @description Mutation hook for updating an admin user's profile data.
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
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error((err as { error?: string }).error ?? "Failed to update user");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
