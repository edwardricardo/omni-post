/**
 * Account Lifecycle Types
 *
 * Type definitions and interfaces for the account lifecycle management system.
 * Used by AccountLifecycleService, AccountSessionService, and related routes.
 *
 * @module admin/accountLifecycleTypes
 */

import type { AdminRole } from "@shared/types";

export interface AccountProfile {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  emailVerified: boolean;
  lastLoginAt: Date | null;
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  sessionCount: number;
  lastActivity: Date | null;
}

export interface CreateAccountRequest {
  email: string;
  password: string;
  name: string;
  role?: AdminRole;
  sendWelcomeEmail?: boolean;
}

export interface UpdateAccountRequest {
  name?: string;
  role?: AdminRole;
  isActive?: boolean;
  emailVerified?: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
  requirePasswordChange?: boolean;
}

export interface AccountFilters {
  role?: AdminRole;
  isActive?: boolean;
  emailVerified?: boolean;
  mfaEnabled?: boolean;
  lastLoginAfter?: Date;
  lastLoginBefore?: Date;
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string; // Search by email or name
}

export interface AccountStats {
  totalAccounts: number;
  activeAccounts: number;
  inactiveAccounts: number;
  emailVerifiedAccounts: number;
  mfaEnabledAccounts: number;
  accountsByRole: Record<AdminRole, number>;
  recentLogins: number; // Last 7 days
  recentRegistrations: number; // Last 30 days
}
