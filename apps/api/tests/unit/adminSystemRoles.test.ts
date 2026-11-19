/**
 * @file adminSystemRoles.test.ts
 * @description Pins `SUPER_ADMIN_ROLE` (`infra/prisma/src/adminSystemRoles.ts`), the one definition
 *   of the `SUPER_ADMIN` role: its permissions are the `Permission` enum, the vocabulary the API
 *   checks (each one is a value of the enum, none appears twice, and no value of the enum is
 *   absent), and its identity is fixed: its id, which rows reference, its name, by which the API
 *   recognises the role, and its level.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Permission } from "@core/domain/auth/Permission.js";
import { SUPER_ADMIN_ROLE } from "../../../../infra/prisma/src/adminSystemRoles.js";

/** The role's identity: rows reference it by this id, and the API recognises it by this name. */
const SEEDED_SUPER_ADMIN_IDENTITY = {
  id: "role-super-admin",
  name: "SUPER_ADMIN",
  level: 100,
} as const;

describe("SUPER_ADMIN_ROLE", () => {
  it("holds only values of the Permission enum when its permissions are read", () => {
    const vocabulary = new Set<string>(Object.values(Permission));
    const outsideVocabulary = SUPER_ADMIN_ROLE.permissions.filter(
      (permission) => !vocabulary.has(permission)
    );

    assert.ok(SUPER_ADMIN_ROLE.permissions.length > 0, "the role grants at least one permission");
    assert.deepStrictEqual(outsideVocabulary, []);
  });

  it("holds no permission twice when its permissions are read", () => {
    const repeated = SUPER_ADMIN_ROLE.permissions.filter(
      (permission, index, permissions) => permissions.indexOf(permission) !== index
    );

    assert.deepStrictEqual(repeated, []);
  });

  it("holds every value of the Permission enum when its permissions are read", () => {
    const granted = new Set<string>(SUPER_ADMIN_ROLE.permissions);
    const absent = Object.values(Permission).filter((permission) => !granted.has(permission));

    assert.deepStrictEqual(absent, []);
  });

  it("keeps the id, name and level the seed wrote when the role is read", () => {
    const { id, name, level } = SUPER_ADMIN_ROLE;

    assert.deepStrictEqual({ id, name, level }, SEEDED_SUPER_ADMIN_IDENTITY);
  });
});
