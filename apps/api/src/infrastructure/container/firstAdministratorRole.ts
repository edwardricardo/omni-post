/**
 * @file firstAdministratorRole.ts
 * @description Turns the shared definition of an administration system role, plain data whose
 *              permissions are strings, into the `SystemRoleDefinition` the first-administrator
 *              use case writes, whose permissions are `Permission` values. Each string becomes a
 *              value only by a check against the enum; a string the enum does not hold stops the
 *              composition, so no role is written with a permission no route checks.
 * @layer infrastructure
 */

import type { AdminSystemRole } from "@infra/prisma/adminSystemRoles.js";
import { Permission } from "@core/domain/auth/Permission.js";
import type { SystemRoleDefinition } from "@core/domain/repositories/SystemRoleRepository.js";

/** Every value of the `Permission` enum, as the wire strings the role's rows hold. */
const PERMISSION_VALUES: ReadonlySet<string> = new Set<string>(Object.values(Permission));

/**
 * @param value - A permission string of the shared definition
 * @returns True when the string is a value of the `Permission` enum
 */
function isPermission(value: string): value is Permission {
  return PERMISSION_VALUES.has(value);
}

/**
 * @function toSystemRoleDefinition
 * @description Copies the role's fields and checks each permission string against the
 *   `Permission` enum, exactly as it is written, case included.
 * @param role - The shared definition of the role
 * @returns The role with its permissions as `Permission` values, in the definition's order
 * @throws Error naming the first string the enum does not hold
 */
export function toSystemRoleDefinition(role: AdminSystemRole): SystemRoleDefinition {
  const permissions: Permission[] = [];
  for (const value of role.permissions) {
    if (!isPermission(value)) {
      throw new Error(
        `The role ${role.name} grants a value the Permission enum does not hold: ${value}`
      );
    }
    permissions.push(value);
  }
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    level: role.level,
    isSystem: role.isSystem,
    permissions,
  };
}
