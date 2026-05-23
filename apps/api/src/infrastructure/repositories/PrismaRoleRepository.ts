/**
 * @file PrismaRoleRepository.ts
 * @description Prisma adapter implementing RoleRepository for admin RBAC roles.
 *              Read-only — receives PrismaClient via constructor injection.
 * @layer infrastructure
 */

import type { PrismaClient, Role, RolePermission } from "@infra/prisma";
import type {
  RoleRepository,
  RoleDto,
  RoleWithPermissionsDto,
} from "../../domain/repositories/RoleRepository.js";

/** Role row with its permissions and assigned-user count eagerly loaded. */
type RoleWithDetails = Role & {
  permissions: RolePermission[];
  _count: { users: number };
};

/** Map a base Role row to RoleDto. */
function toRoleDto(role: Role): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    level: role.level,
    isSystem: role.isSystem,
    isActive: role.isActive,
  };
}

/** Map a Role row with permissions + count to RoleWithPermissionsDto. */
function toRoleWithPermissionsDto(role: RoleWithDetails): RoleWithPermissionsDto {
  return {
    ...toRoleDto(role),
    permissions: role.permissions.map((rp) => rp.permission),
    userCount: role._count.users,
  };
}

/**
 * Prisma implementation of RoleRepository.
 *
 * Register as a singleton in the DI container via TOKENS.RoleRepository.
 */
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find a role by its unique name.
   *
   * @param name - Role name
   * @returns The role as a RoleDto, or null when absent
   */
  async findByName(name: string): Promise<RoleDto | null> {
    const role = await this.prisma.role.findUnique({ where: { name } });
    return role ? toRoleDto(role) : null;
  }

  /**
   * List the permission names granted to a role.
   *
   * @param name - Role name
   * @returns Permission name strings; empty array when the role is absent
   */
  async findPermissionNamesByName(name: string): Promise<string[]> {
    const role = await this.prisma.role.findUnique({
      where: { name },
      include: { permissions: true },
    });
    if (!role) return [];
    return role.permissions.map((rp) => rp.permission);
  }

  /**
   * Find a role with its permissions and assigned-user count.
   *
   * @param name - Role name
   * @returns The enriched role, or null when absent
   */
  async findInfoByName(name: string): Promise<RoleWithPermissionsDto | null> {
    const role = await this.prisma.role.findUnique({
      where: { name },
      include: { permissions: true, _count: { select: { users: true } } },
    });
    return role ? toRoleWithPermissionsDto(role) : null;
  }

  /**
   * List every active role with permissions and user counts, highest level first.
   *
   * @returns Active roles enriched with permissions and user counts
   */
  async findAllActiveInfo(): Promise<RoleWithPermissionsDto[]> {
    const roles = await this.prisma.role.findMany({
      where: { isActive: true },
      include: { permissions: true, _count: { select: { users: true } } },
      orderBy: { level: "desc" },
    });
    return roles.map(toRoleWithPermissionsDto);
  }
}
