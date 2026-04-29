/**
 * @file auditClient.ts
 * @description Admin audit log endpoints — list with filters and aggregate
 *              statistics.
 * @layer infrastructure
 */

import type { AuditLog, AuditLogFilters } from "../types";
import { http } from "./http";

/**
 * @const auditClient
 * @description Methods for `/admin/audit/*`.
 */
export const auditClient = {
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
};
