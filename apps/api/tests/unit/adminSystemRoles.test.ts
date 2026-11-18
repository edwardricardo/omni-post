/**
 * @file adminSystemRoles.test.ts
 * @description Pins `SUPER_ADMIN_ROLE` (`infra/prisma/src/adminSystemRoles.ts`), the one definition
 *   of the `SUPER_ADMIN` role that the development seed writes: what is true of any right list of
 *   permissions (each one is a value of the `Permission` enum, the vocabulary the API checks, and
 *   none appears twice) and the identity the seed wrote before the definition moved (its id, name
 *   and level). Which permissions the list holds, and how many, is not decided, so neither is pinned.
 * @layer infrastructure
 */

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Permission } from "@core/domain/auth/Permission.js";
import { SUPER_ADMIN_ROLE } from "../../../../infra/prisma/src/adminSystemRoles.js";

/** The identity `infra/prisma/seed.ts` wrote for the role before the definition moved. */
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

  it("keeps the id, name and level the seed wrote when the role is read", () => {
    const { id, name, level } = SUPER_ADMIN_ROLE;

    assert.deepStrictEqual({ id, name, level }, SEEDED_SUPER_ADMIN_IDENTITY);
  });
});
