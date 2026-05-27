/**
 * @file SecuritySettingsRepository.ts
 * @description Port for the singleton `SecuritySettings` row (2FA toggle,
 *   session/password/login policies, IP allowlist).
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type SecuritySettingsStoreError = "DATABASE_ERROR";

export interface SecuritySettings {
  id: string;
  require2FA: boolean;
  sessionTimeoutMinutes: number;
  maxLoginAttempts: number;
  passwordMinLength: number;
  requireUppercase: boolean;
  requireSpecialChar: boolean;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  updatedAt: Date;
  updatedBy: string | null;
}

export interface SecuritySettingsRepository {
  /** Read the singleton row, or `null` when uninitialised. */
  findSingleton(): Promise<Result<SecuritySettings | null, SecuritySettingsStoreError>>;

  /** Create the singleton row with the caller-supplied id. */
  createDefault(id: string): Promise<Result<SecuritySettings, SecuritySettingsStoreError>>;

  /** Apply a partial update to the singleton row. */
  update(
    id: string,
    fields: Partial<Omit<SecuritySettings, "id" | "updatedAt">>
  ): Promise<Result<SecuritySettings, SecuritySettingsStoreError>>;
}
