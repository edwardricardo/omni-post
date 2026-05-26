/**
 * @file CustomerRoleRepository.ts
 * @description Port interface for reading CustomerRole + CustomerRolePermission
 *   data. The customer-side RBAC catalog: roles by name/id with their associated
 *   permission strings. Use cases that mutate CustomerUser.role read snapshots
 *   from here to populate the entity's denormalised roleName/roleLevel/permissions
 *   fields.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { DomainError } from "../errors/index.js";

/**
 * Denormalised role snapshot — the shape consumers attach to a CustomerUser.
 */
export interface CustomerRoleSnapshot {
  readonly roleId: string;
  readonly roleName: string;
  readonly roleLevel: number;
  readonly permissions: ReadonlySet<string>;
}

/**
 * @interface CustomerRoleRepository
 * @description Read-only repository for the customer RBAC catalog. Roles are
 *   seeded (system roles: OWNER / MANAGER / MEMBER / VIEWER) and don't mutate
 *   at runtime — this port intentionally exposes only readers.
 */
export interface CustomerRoleRepository {
  /**
   * @method getSnapshotById
   * @description Loads the role + its permissions by role id.
   */
  getSnapshotById(roleId: string): Promise<Result<CustomerRoleSnapshot, DomainError>>;

  /**
   * @method getSnapshotByName
   * @description Loads the role + its permissions by role name (e.g. "OWNER").
   *   Used during user creation to resolve a default role from a known name.
   */
  getSnapshotByName(roleName: string): Promise<Result<CustomerRoleSnapshot, DomainError>>;

  /**
   * @method listAll
   * @description Lists all active roles with their permission counts. Drives
   *   the role-picker UI in admin and the customer settings page.
   */
  listAll(): Promise<CustomerRoleSnapshot[]>;
}
