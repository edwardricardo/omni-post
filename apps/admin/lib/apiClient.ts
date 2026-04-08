/**
 * @file apiClient.ts
 * @description Typed HTTP client and API facade for the admin dashboard. Wraps fetch with
 * JSON defaults and exposes methods for posts, admin dashboard stats, accounts, subscriptions,
 * analytics, and security (MFA/RBAC) endpoints.
 */
import type { PlanType } from "@shared/types";

const API_URL = "/api/backend";

/**
 * HTTP client that unwraps the BaseRouteHandler envelope.
 * Backend always returns `{ ok, data: T }`. This function returns the
 * full envelope so callers can check `ok` and access the payload via
 * the shape they declare in the generic — which should match the `data`
 * contents, NOT the outer envelope.
 */
async function http<T>(path: string, init?: RequestInit): Promise<{ ok: boolean } & T> {
  const res = await fetch(API_URL + path, {
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
    ...init,
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`HTTP ${res.status}: ${error}`);
  }
  const json: { ok: boolean; data?: T } = await res.json();
  // Unwrap: merge `ok` + spread `data` so callers see { ok, ...fields }
  return { ok: json.ok, ...(json.data as T) } as { ok: boolean } & T;
}

// Interface definitions
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

export interface SubscriptionSummary {
  subscriptions: Array<{
    id: string;
    email: string;
    name: string;
    plan?: {
      type: string;
      name: string;
      status: string;
      providers: string[];
      pricePerMonth: number;
    };
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
    plan?: {
      type: string;
      name: string;
      status: string;
      providers: string[];
      pricePerMonth: number;
    };
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

// Audit interfaces
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

// Security interfaces
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

export const api = {
  // Health check
  health: () => http<{ ok: boolean }>(`/health`),

  // Legacy endpoints
  listPosts: (q: { projectId?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.projectId) p.set("projectId", q.projectId);
    if (q.limit) p.set("limit", String(q.limit));
    if (q.offset) p.set("offset", String(q.offset));
    return http<{ ok: boolean; value: unknown[] }>(`/posts?${p.toString()}`);
  },
  createPost: (body: Record<string, unknown>) =>
    http<{ ok: boolean; value: unknown }>(`/posts`, { method: "POST", body: JSON.stringify(body) }),
  getPost: (id: string) => http<{ ok: boolean; value: unknown }>(`/posts/${id}`),
  publish: (postId: string, body: { channelIds: string[]; scheduledAt?: string }) =>
    http<{ ok: boolean; value: unknown }>(`/publish/${postId}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listLogs: (q: Record<string, unknown> = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v != null) p.set(k, String(v));
    return http<{ ok: boolean; value: unknown[] }>(`/logs?${p.toString()}`);
  },

  // Admin Dashboard endpoints
  admin: {
    // Dashboard statistics
    getDashboardStats: () =>
      http<{ ok: boolean; stats: DashboardStats; timestamp: string }>("/admin/dashboard/stats"),

    // Account management
    getAccountSummary: () =>
      http<{ ok: boolean; accounts: AccountSummary[]; total: number; timestamp: string }>(
        "/admin/accounts/summary"
      ),

    // Account listing with filters and pagination
    getAccounts: (filters?: {
      role?: string;
      isActive?: boolean;
      mfaEnabled?: boolean;
      search?: string;
      page?: number;
      limit?: number;
    }) => {
      const p = new URLSearchParams();
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v != null) p.set(k, String(v));
        }
      }
      const qs = p.toString();
      return http<{
        accounts: Array<{
          id: string;
          email: string;
          name: string;
          role: string;
          isActive: boolean;
          mfaEnabled: boolean;
        }>;
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
          hasNext: boolean;
          hasPrev: boolean;
        };
      }>(`/admin/accounts${qs ? `?${qs}` : ""}`);
    },

    // Projects belonging to a specific account
    getAccountProjects: (accountId: string) =>
      http<{
        ok: boolean;
        value: Array<{
          id: string;
          accountId: string;
          name: string;
          locale: string;
          createdAt: string;
        }>;
      }>(`/accounts/${accountId}/projects`),

    // Subscription management
    getSubscriptionSummary: () =>
      http<{ ok: boolean } & SubscriptionSummary & { timestamp: string }>(
        "/admin/subscriptions/summary"
      ),
  },

  // Audit log endpoints
  audit: {
    getLogs: (filters?: AuditLogFilters) => {
      const p = new URLSearchParams();
      if (filters) {
        if (filters.userId) p.set("userId", filters.userId);
        if (filters.action) p.set("action", filters.action);
        if (filters.resource) p.set("resource", filters.resource);
        if (filters.startDate) p.set("startDate", filters.startDate);
        if (filters.endDate) p.set("endDate", filters.endDate);
        if (filters.limit !== undefined) p.set("limit", String(filters.limit));
        if (filters.offset !== undefined) p.set("offset", String(filters.offset));
      }
      const qs = p.toString();
      return http<{ logs: AuditLog[]; filters: Record<string, unknown> }>(
        `/admin/audit/logs${qs ? `?${qs}` : ""}`
      );
    },
    getStats: () => http<{ stats: Record<string, unknown> }>("/admin/audit/stats"),
  },

  // Delete post
  deletePost: (id: string) => http<{ ok: boolean }>(`/posts/${id}`, { method: "DELETE" }),

  // Security API endpoints (cookie-based auth — token optional for admin proxy)
  security: {
    // Authentication endpoints
    login: (credentials: { email: string; password: string; mfaToken?: string }) =>
      http<{ ok: boolean; user?: unknown; tokens?: unknown; mfaRequired?: boolean }>(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify(credentials),
        }
      ),

    // MFA endpoints
    mfa: {
      getStatus: () => http<{ ok: boolean; mfa: MfaStatus }>("/auth/mfa/status"),

      setup: () =>
        http<{ ok: boolean; setup: unknown }>("/auth/mfa/setup", {
          method: "POST",
        }),

      verifySetup: (mfaToken: string) =>
        http<{ ok: boolean; backupCodes: string[] }>("/auth/mfa/verify-setup", {
          method: "POST",
          body: JSON.stringify({ token: mfaToken }),
        }),

      disable: (mfaToken: string) =>
        http<{ ok: boolean }>("/auth/mfa/disable", {
          method: "POST",
          body: JSON.stringify({ token: mfaToken }),
        }),

      regenerateBackupCodes: (mfaToken: string) =>
        http<{ ok: boolean; backupCodes: string[] }>("/auth/mfa/regenerate-backup-codes", {
          method: "POST",
          body: JSON.stringify({ token: mfaToken }),
        }),

      // Admin MFA endpoints
      getUserStatus: (userId: string) =>
        http<{ ok: boolean; mfa: MfaStatus }>(`/admin/users/${userId}/mfa/status`),

      forceDisable: (userId: string, reason: string) =>
        http<{ ok: boolean }>(`/admin/users/${userId}/mfa/force-disable`, {
          method: "POST",
          body: JSON.stringify({ reason }),
        }),
    },

    // RBAC endpoints
    rbac: {
      getPermissions: () => http<{ ok: boolean } & UserPermissions>("/auth/permissions"),

      getRoles: () =>
        http<{ ok: boolean; roles: RoleInfo[]; permissionCategories: Record<string, string[]> }>(
          "/admin/rbac/roles"
        ),

      getRole: (role: string) => http<{ ok: boolean; role: RoleInfo }>(`/admin/rbac/roles/${role}`),

      getUsersByRole: (role: string) =>
        http<{ ok: boolean; users: unknown[]; count: number }>(`/admin/rbac/roles/${role}/users`),

      updateUserRole: (userId: string, role: string, reason: string) =>
        http<{ ok: boolean }>(`/admin/rbac/users/${userId}/role`, {
          method: "PUT",
          body: JSON.stringify({ role, reason }),
        }),

      assignPermission: (role: string, permission: string) =>
        http<{ ok: boolean }>(`/admin/rbac/roles/${role}/permissions`, {
          method: "POST",
          body: JSON.stringify({ permission }),
        }),

      revokePermission: (role: string, permission: string) =>
        http<{ ok: boolean }>(`/admin/rbac/roles/${role}/permissions/${permission}`, {
          method: "DELETE",
        }),

      createRole: (data: {
        name: string;
        description: string;
        level: number;
        permissions: string[];
      }) =>
        http<{ ok: boolean; role: unknown }>("/admin/rbac/roles", {
          method: "POST",
          body: JSON.stringify(data),
        }),

      updateRole: (roleId: string, data: { description?: string; level?: number }) =>
        http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),

      setRolePermissions: (roleId: string, permissions: string[]) =>
        http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}/permissions`, {
          method: "PUT",
          body: JSON.stringify({ permissions }),
        }),

      deleteRole: (roleId: string) =>
        http<{ ok: boolean }>(`/admin/rbac/roles/${roleId}`, {
          method: "DELETE",
        }),

      checkPermissions: (permissions: string[], requireAll = false) =>
        http<{ ok: boolean; hasAccess: boolean; permissions: unknown }>("/auth/permissions/check", {
          method: "POST",
          body: JSON.stringify({ permissions, requireAll }),
        }),

      getHierarchy: () => http<{ ok: boolean } & RbacHierarchy>("/admin/rbac/hierarchy"),

      getStatus: () => http<{ ok: boolean } & SecurityStats>("/admin/rbac/status"),
    },
  },
};
