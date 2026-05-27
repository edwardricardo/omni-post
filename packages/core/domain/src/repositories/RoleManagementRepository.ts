/**
 * @file RoleManagementRepository.ts
 * @description Write-side port for admin RBAC roles. Distinct from the
 *   read-only `RoleRepository` (which serves the runtime permission resolver
 *   and is invoked on every request). Used by `RoleManagementService` to
 *   create, update, replace permissions, and delete custom roles.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type RoleManagementStoreError = "DATABASE_ERROR";

/** Detail projection returned by lookups/create/update. */
export interface RoleManagementDetail {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  permissions: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Lightweight projection sufficient for duplicate-name + delete-eligibility checks. */
export interface RoleManagementSummary {
  id: string;
  name: string;
  isSystem: boolean;
  userCount: number;
}

export interface RoleCreateInput {
  name: string;
  description: string;
  level: number;
  /** Initial permission names to associate with the new role. */
  permissions: string[];
}

export interface RoleUpdateInput {
  description?: string;
  level?: number;
  isActive?: boolean;
}

export interface RoleManagementRepository {
  /**
   * Read the lightweight summary for a role by its unique name. Used as
   * the duplicate-name guard at create time.
   */
  findByName(name: string): Promise<Result<RoleManagementSummary | null, RoleManagementStoreError>>;

  /**
   * Read the lightweight summary for a role by id. Used as the existence +
   * eligibility guard at delete time (`isSystem`, `userCount`).
   */
  findSummaryById(
    id: string
  ): Promise<Result<RoleManagementSummary | null, RoleManagementStoreError>>;

  /**
   * Read the full detail (permissions + user count) for a role by id.
   */
  findDetailById(
    id: string
  ): Promise<Result<RoleManagementDetail | null, RoleManagementStoreError>>;

  /** Create a new role with its initial permissions. Returns the full detail. */
  create(input: RoleCreateInput): Promise<Result<RoleManagementDetail, RoleManagementStoreError>>;

  /** Apply a partial update to the role row; returns the refreshed detail. */
  update(
    id: string,
    fields: RoleUpdateInput
  ): Promise<Result<RoleManagementDetail, RoleManagementStoreError>>;

  /**
   * Replace the role's permission set atomically (delete-all then insert-all).
   * Returns the refreshed detail.
   */
  replacePermissions(
    id: string,
    permissions: string[]
  ): Promise<Result<RoleManagementDetail, RoleManagementStoreError>>;

  /** Hard-delete a role. The caller must check `isSystem` + `userCount` first. */
  delete(id: string): Promise<Result<void, RoleManagementStoreError>>;
}
