/**
 * @file DataBreachReportRepository.ts
 * @description Port for the `DataBreachReport` table (security incidents +
 *   regulatory notification trail). Used by `ComplianceService` to record,
 *   list, and update breach reports.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type DataBreachStoreError = "DATABASE_ERROR";

export interface DataBreachReport {
  id: string;
  title: string;
  description: string;
  discoveredAt: Date;
  reportedAt: Date;
  reportedBy: string;
  affectedUserCount: number | null;
  dataTypesAffected: string[];
  severity: string;
  notificationSentAt: Date | null;
  notificationSentBy: string | null;
  regulatoryReportedAt: Date | null;
  regulatoryReportedTo: string | null;
  resolved: boolean;
  resolvedAt: Date | null;
  internalNotes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataBreachListFilters {
  resolved?: boolean;
  page: number;
  limit: number;
}

export interface DataBreachCreateInput {
  title: string;
  description: string;
  discoveredAt: Date;
  severity: string;
  dataTypesAffected: string[];
  reportedBy: string;
  affectedUserCount?: number;
}

export interface DataBreachUpdateInput {
  notificationSentAt?: Date | null;
  notificationSentBy?: string | null;
  regulatoryReportedAt?: Date | null;
  regulatoryReportedTo?: string | null;
  resolved?: boolean;
  resolvedAt?: Date | null;
  internalNotes?: string | null;
}

export interface DataBreachReportRepository {
  list(
    filters: DataBreachListFilters
  ): Promise<Result<{ reports: DataBreachReport[]; total: number }, DataBreachStoreError>>;

  findById(id: string): Promise<Result<DataBreachReport | null, DataBreachStoreError>>;

  create(input: DataBreachCreateInput): Promise<Result<DataBreachReport, DataBreachStoreError>>;

  update(id: string, fields: DataBreachUpdateInput): Promise<Result<void, DataBreachStoreError>>;
}
