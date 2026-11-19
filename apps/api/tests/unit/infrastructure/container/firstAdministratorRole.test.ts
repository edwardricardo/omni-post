/**
 * @file firstAdministratorRole.test.ts
 * @description Unit tests for `toSystemRoleDefinition`, which the first-administrator command's
 *   composition root applies to the shared `SUPER_ADMIN_ROLE`: the role's strings become
 *   `Permission` values only by a check against the enum, and a string the enum does not hold
 *   stops the composition. The shared role is imported by its path, because under vitest the
 *   `@infra/prisma` alias names a file and cannot resolve a subpath of the package.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Permission } from "@core/domain/auth/Permission.js";
import {
  SUPER_ADMIN_ROLE,
  type AdminSystemRole,
} from "../../../../../../infra/prisma/src/adminSystemRoles.js";
import { toSystemRoleDefinition } from "../../../../src/infrastructure/container/firstAdministratorRole.js";

/** A role shaped as the shared definition, with the given permission strings. */
function makeRole(permissions: readonly string[]): AdminSystemRole {
  return {
    id: "role-fixture",
    name: "FIXTURE_ROLE",
    description: "A role of the test",
    level: 7,
    isSystem: true,
    permissions,
  };
}

describe("toSystemRoleDefinition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the shared role's fields and its permissions as values of the Permission enum", () => {
    const definition = toSystemRoleDefinition(SUPER_ADMIN_ROLE);

    expect(definition).toEqual({
      id: SUPER_ADMIN_ROLE.id,
      name: SUPER_ADMIN_ROLE.name,
      description: SUPER_ADMIN_ROLE.description,
      level: SUPER_ADMIN_ROLE.level,
      isSystem: SUPER_ADMIN_ROLE.isSystem,
      permissions: [...SUPER_ADMIN_ROLE.permissions],
    });
    expect(definition.permissions.every((value) => Object.values(Permission).includes(value))).toBe(
      true
    );
  });

  it("refuses, naming the value, when a permission string is not a value of the Permission enum", () => {
    const role = makeRole([Permission.USER_READ, "user:impersonate", Permission.AUDIT_READ]);

    expect(() => toSystemRoleDefinition(role)).toThrow(
      new Error(
        "The role FIXTURE_ROLE grants a value the Permission enum does not hold: user:impersonate"
      )
    );
  });

  it("refuses when a permission string differs from an enum value only by its case", () => {
    const role = makeRole(["USER:READ"]);

    expect(() => toSystemRoleDefinition(role)).toThrow(
      "The role FIXTURE_ROLE grants a value the Permission enum does not hold: USER:READ"
    );
  });
});
