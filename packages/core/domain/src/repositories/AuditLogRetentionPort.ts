/**
 * @file AuditLogRetentionPort.ts
 * @description Read + retention port over the audit-log table. Separate from
 *   `AuditEmitterPort` (write) and `AuditLogRepository` (admin queries):
 *   exposes only what compliance flows need — recent-activity count + bulk
 *   deletion by age. Used by `ComplianceService.getComplianceScore` (for the
 *   "audit logs active in last 24h" check) and `DataRetentionService` (for
 *   the retention sweep).
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type AuditLogRetentionError = "DATABASE_ERROR";

export interface AuditLogRetentionPort {
  /**
   * Count audit rows whose `createdAt` is `>= since`. Used for the
   * compliance-score "audit-active" health check.
   */
  countSince(since: Date): Promise<Result<number, AuditLogRetentionError>>;

  /**
   * Delete every audit row with `createdAt < before`. Returns the number
   * of rows deleted. Used by the retention sweep.
   */
  deleteOlderThan(before: Date): Promise<Result<number, AuditLogRetentionError>>;
}
