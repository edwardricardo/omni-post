/**
 * @file RoleRepository.ts
 * @description Repository port for admin RBAC roles (the Role / RolePermission
 *              tables). Distinct from the customer-side CustomerRoleRepository.
 *              All methods are read-only.
 * @layer domain
 */

/**
 * Flat DTO for a persisted Role row.
 */
export interface RoleDto {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
}

/**
 * Role DTO enriched with its permission names and assigned-user count.
 */
export interface RoleWithPermissionsDto extends RoleDto {
  permissions: string[];
  userCount: number;
}

/**
 * Port interface for admin role lookups.
 *
 * Consumers receive this interface via constructor injection —
 * they never import a concrete Prisma implementation directly.
 */
export interface RoleRepository {
  /**
   * Find a role by its unique name.
   *
   * @param name - Role name (e.g. "SUPER_ADMIN", "ADMIN")
   * @returns The role as a RoleDto, or null when no role matches
   */
  findByName(name: string): Promise<RoleDto | null>;

  /**
   * List the permission names granted to a role.
   *
   * @param name - Role name
   * @returns Permission name strings; an empty array when the role is absent
   */
  findPermissionNamesByName(name: string): Promise<string[]>;

  /**
   * Find a role with its permissions and assigned-user count.
   *
   * @param name - Role name
   * @returns The enriched role, or null when no role matches
   */
  findInfoByName(name: string): Promise<RoleWithPermissionsDto | null>;

  /**
   * List every active role with permissions and user counts, highest level first.
   *
   * @returns Active roles enriched with permissions and user counts
   */
  findAllActiveInfo(): Promise<RoleWithPermissionsDto[]>;
}
