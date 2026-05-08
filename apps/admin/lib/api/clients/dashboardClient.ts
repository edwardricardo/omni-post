/**
 * @file dashboardClient.ts
 * @description Admin dashboard, accounts, and subscriptions endpoints.
 *              Powers the admin home page, the accounts table, and the
 *              subscriptions overview.
 * @layer infrastructure
 */

import type {
  AccountListFilters,
  AccountListResponse,
  AccountProject,
  AccountSummary,
  DashboardStats,
  SubscriptionSummary,
} from "../types";
import { http } from "./http";

/**
 * @const dashboardClient
 * @description Methods for `/admin/dashboard/*`, `/admin/accounts/*`,
 *              `/admin/subscriptions/*`, and `/accounts/:id/projects`.
 */
export const dashboardClient = {
  getDashboardStats: () =>
    http<{ ok: boolean; stats: DashboardStats; timestamp: string }>("/admin/dashboard/stats"),

  getAccountSummary: () =>
    http<{ ok: boolean; accounts: AccountSummary[]; total: number; timestamp: string }>(
      "/admin/accounts/summary"
    ),

  getAccounts: (filters?: AccountListFilters) => {
    const p = new URLSearchParams();
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v != null) p.set(k, String(v));
      }
    }
    const qs = p.toString();
    return http<AccountListResponse>(`/admin/accounts${qs ? `?${qs}` : ""}`);
  },

  getAccountProjects: (accountId: string) =>
    http<{ ok: boolean; value: AccountProject[] }>(`/accounts/${accountId}/projects`),

  getSubscriptionSummary: () =>
    http<{ ok: boolean } & SubscriptionSummary & { timestamp: string }>(
      "/admin/subscriptions/summary"
    ),
};
