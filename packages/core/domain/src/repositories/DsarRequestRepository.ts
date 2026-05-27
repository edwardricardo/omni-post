/**
 * @file DsarRequestRepository.ts
 * @description Port for the `DsarRequest` table (Data Subject Access Request
 *   lifecycle under GDPR/LGPD/CCPA/PIPEDA). Used by `ComplianceService` for
 *   the full lifecycle (submit → acknowledge → complete/reject) and by
 *   `DataRetentionService` for the expired-overdue sweep.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";
import type { JurisdictionType } from "./GdprSettingsRepository.js";

export type DsarRequestStoreError = "DATABASE_ERROR";

export type DsarRequestType = "EXPORT" | "DELETION" | "ACCESS";
export type DsarStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "EXPIRED";

export interface DsarRequestRow {
  id: string;
  accountId: string | null;
  requestorEmail: string;
  requestorName: string | null;
  type: DsarRequestType;
  jurisdiction: JurisdictionType;
  status: DsarStatus;
  deadlineAt: Date;
  requestedAt: Date;
  acknowledgedAt: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  exportUrl: string | null;
  exportExpiresAt: Date | null;
  notes: string | null;
  ipAddress: string | null;
  verificationToken: string | null;
}

export interface DsarRequestRowWithAccount extends DsarRequestRow {
  account: { id: string; name: string; email: string } | null;
}

export interface DsarListFilters {
  status?: DsarStatus;
  type?: DsarRequestType;
  page: number;
  limit: number;
}

export interface DsarRequestCreateInput {
  requestorEmail: string;
  requestorName?: string;
  type: DsarRequestType;
  jurisdiction: JurisdictionType;
  deadlineAt: Date;
  verificationToken: string;
  accountId?: string;
  ipAddress?: string;
}

export interface DsarRequestUpdateInput {
  status?: DsarStatus;
  acknowledgedAt?: Date | null;
  completedAt?: Date | null;
  completedBy?: string | null;
  rejectedAt?: Date | null;
  rejectedBy?: string | null;
  rejectionReason?: string | null;
  exportUrl?: string | null;
  exportExpiresAt?: Date | null;
}

export interface DsarRequestRepository {
  listWithAccount(
    filters: DsarListFilters
  ): Promise<
    Result<{ requests: DsarRequestRowWithAccount[]; total: number }, DsarRequestStoreError>
  >;

  findByIdWithAccount(
    id: string
  ): Promise<Result<DsarRequestRowWithAccount | null, DsarRequestStoreError>>;

  findById(id: string): Promise<Result<DsarRequestRow | null, DsarRequestStoreError>>;

  countPendingByEmail(email: string): Promise<Result<number, DsarRequestStoreError>>;

  create(input: DsarRequestCreateInput): Promise<Result<DsarRequestRow, DsarRequestStoreError>>;

  update(
    id: string,
    fields: DsarRequestUpdateInput
  ): Promise<Result<DsarRequestRow, DsarRequestStoreError>>;

  /**
   * Mark every PENDING/IN_PROGRESS row whose `deadlineAt < now` as `EXPIRED`.
   * Returns the number of rows updated.
   */
  markOverdueAsExpired(now: Date): Promise<Result<number, DsarRequestStoreError>>;
}
