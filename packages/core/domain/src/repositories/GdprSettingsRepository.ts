/**
 * @file GdprSettingsRepository.ts
 * @description Port for the singleton `GdprSettings` row (privacy policy URLs,
 *   DPO config, retention windows, jurisdiction defaults, feature toggles).
 *   Used by `ComplianceService` for read/update and by `DataRetentionService`
 *   to gate auto-deletion.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type GdprSettingsStoreError = "DATABASE_ERROR";

export type DpoType = "INTERNAL" | "EXTERNAL";
export type JurisdictionType = "GDPR" | "LGPD" | "CCPA" | "PIPEDA" | "OTHER";

export interface GdprSettings {
  id: string;
  privacyPolicyUrl: string | null;
  cookiePolicyUrl: string | null;
  termsOfServiceUrl: string | null;
  dpoType: DpoType;
  dpoEmail: string | null;
  dpoUrl: string | null;
  dataRetentionDays: number;
  auditLogRetentionDays: number;
  enableAutoDataDeletion: boolean;
  dsarResponseDays: number;
  defaultJurisdiction: JurisdictionType;
  enableRightToErasure: boolean;
  enableDataExport: boolean;
  enableDataAccess: boolean;
  enableBreachNotification: boolean;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface GdprSettingsRepository {
  /** Read the singleton row, or `null` when uninitialised. */
  findSingleton(): Promise<Result<GdprSettings | null, GdprSettingsStoreError>>;

  /**
   * Create the singleton row with default values + the caller-supplied id
   * (typically `"gdpr-singleton"`). Idempotent at the call-site — callers
   * should `findSingleton` first.
   */
  createDefault(id: string): Promise<Result<GdprSettings, GdprSettingsStoreError>>;

  /** Apply a partial update to the singleton row. */
  update(
    id: string,
    fields: Partial<Omit<GdprSettings, "id" | "updatedAt">>
  ): Promise<Result<GdprSettings, GdprSettingsStoreError>>;
}
