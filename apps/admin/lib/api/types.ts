/**
 * @file types.ts
 * @description Shared types for the admin API surface — dashboard, accounts,
 *              subscriptions, audit logs, MFA, and RBAC. Re-exported by
 *              `apiClient.ts` so existing consumers continue to import them
 *              from `@/lib/apiClient`.
 * @layer infrastructure
 */

import type { PlanType } from "@shared/types";

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardStats {
  accounts: {
    total: number;
    active: number;
    trialsActive: number;
    trialsExpiring: number;
  };
  subscriptions?: {
    TRIALING: number;
    ACTIVE: number;
    PAST_DUE: number;
    CANCELED: number;
    GRANDFATHERED: number;
  };
  plans?: {
    custom: number;
    bundle: number;
    trial: number;
    none: number;
  };
  revenue?: {
    monthly: number;
    yearly: number;
    total: number;
  };
  activity: {
    loginsToday?: number;
    newAccountsToday: number;
    subscriptionChangesToday?: number;
  };
  projects: number;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface AccountSummary {
  id: string;
  email: string;
  name: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  plan: {
    type: PlanType;
    name: string;
    status: string;
    providers: string[];
    pricePerMonth: number;
  };
  trial: {
    isOnTrial: boolean;
    trialDaysRemaining: number;
    trialExpired: boolean;
  };
  usage: {
    projectsUsed: number;
    projectsRemaining: number;
    utilizationPercent: number;
  };
}

interface AccountListItem {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
}

interface AccountListPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface AccountListResponse {
  accounts: AccountListItem[];
  pagination: AccountListPagination;
}

export interface AccountListFilters {
  role?: string;
  isActive?: boolean;
  mfaEnabled?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export interface AccountProject {
  id: string;
  accountId: string;
  name: string;
  locale: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

interface SubscriptionPlan {
  type: string;
  name: string;
  status: string;
  providers: string[];
  pricePerMonth: number;
}

export interface SubscriptionSummary {
  subscriptions: Array<{
    id: string;
    email: string;
    name: string;
    plan?: SubscriptionPlan;
    billingCycle: string;
    autoRenewal: boolean;
    nextBillingDate: string | null;
    lastBillingDate: string | null;
    createdAt: string;
  }>;
  trials: Array<{
    id: string;
    email: string;
    name: string;
    plan?: SubscriptionPlan;
    trialStartDate: string;
    trialEndDate: string;
    trialDaysRemaining: number;
    autoRenewal: boolean;
    status: string;
  }>;
  stats: {
    totalRevenue: number;
    monthlyRevenue: number;
    activeSubscriptions: number;
    activeTrials: number;
    expiringTrials: number;
    conversionRate: number;
  };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Actor discriminator carried by every audit row. Mirrors the backend
 * `AuditActorType` enum: readers switch on this instead of inferring the actor
 * from a null FK (a `SYSTEM` row and a `CUSTOMER` row both have a null admin
 * `userId`, so the null user alone is ambiguous).
 */
export const AUDIT_ACTOR_TYPE = {
  SYSTEM: "SYSTEM",
  ADMIN: "ADMIN",
  CUSTOMER: "CUSTOMER",
} as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPE)[keyof typeof AUDIT_ACTOR_TYPE];

/** Identity of the CUSTOMER actor behind an audit row (`customerUser` relation). */
interface AuditActorCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  success: boolean;
  error: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  /**
   * Actor discriminator. Additive: admin rows carry `ADMIN`, so existing admin
   * consumers read the same shape they always did while customer/system rows
   * become distinguishable.
   */
  actorType: AuditActorType;
  /** CUSTOMER actor FK; `null` on ADMIN and SYSTEM rows. Additive. */
  customerUserId: string | null;
  /** Resolved CUSTOMER actor; absent/`null` on ADMIN and SYSTEM rows. Additive. */
  customerUser?: AuditActorCustomer | null;
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  resource?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Security — MFA + RBAC
// ---------------------------------------------------------------------------

export interface MfaStatus {
  enabled: boolean;
  backupCodesCount: number;
}

export interface RoleInfo {
  id: string;
  role: string;
  permissions: string[];
  description: string;
  userCount: number;
  isSystem: boolean;
  level: number;
}

export interface UserPermissions {
  user: {
    id: string;
    role: string;
  };
  permissions: string[];
  permissionCategories: Record<string, string[]>;
}

export interface RbacHierarchy {
  hierarchy: Record<string, { level: number; name: string }>;
  permissionMatrix: Record<string, string[]>;
  roles: RoleInfo[];
  currentUser: {
    role: string;
    canModifyRoles: boolean;
  };
  permissionCategories: Record<string, string[]>;
}

export interface SecurityStats {
  status: string;
  statistics: {
    totalUsers: number;
    totalRoles: number;
    totalPermissions: number;
    mfaEnabled: number;
    roleDistribution: Array<{
      role: string;
      userCount: number;
      percentage: number;
    }>;
    permissionCategories: number;
  };
  roles: RoleInfo[];
}

export interface CreateRoleInput {
  name: string;
  description: string;
  level: number;
  permissions: string[];
}

export interface UpdateRoleInput {
  description?: string;
  level?: number;
}
