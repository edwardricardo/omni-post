/**
 * @file api.ts
 * @description Internal fetch helpers for the admin-users endpoints.
 * @layer infrastructure
 */

import { ApiError } from "@/lib/parseApiError";
import type {
  AdminUser,
  AdminUsersResponse,
  CreateAdminUserInput,
  CreateAdminUserResponse,
  UpdateAdminUserData,
} from "./types";

export async function fetchAdminUsers(): Promise<AdminUser[]> {
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
}

export async function createAdminUser(
  data: CreateAdminUserInput
): Promise<CreateAdminUserResponse> {
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
}

export async function deactivateAdminUser(userId: string): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/users/${userId}/deactivate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function activateAdminUser(userId: string): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/users/${userId}/activate`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}

export async function updateAdminUser(input: {
  id: string;
  data: UpdateAdminUserData;
}): Promise<unknown> {
  const res = await fetch(`/api/backend/admin/users/${input.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input.data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  return res.json();
}
