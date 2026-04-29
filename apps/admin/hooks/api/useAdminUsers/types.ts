/**
 * @file types.ts
 * @description Public types for the admin-users hook module.
 * @layer infrastructure
 */

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

export interface AdminUsersResponse {
  users: AdminUser[];
}

export interface CreateAdminUserInput {
  email: string;
  name: string;
  role: string;
}

export interface CreateAdminUserResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export interface UpdateAdminUserData {
  name?: string;
  email?: string;
  department?: string;
  team?: string;
}
