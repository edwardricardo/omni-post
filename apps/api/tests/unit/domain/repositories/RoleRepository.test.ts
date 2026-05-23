/**
 * @file RoleRepository.test.ts
 * @description Contract tests for the admin RBAC role port. Exercises an in-memory
 *              reference implementation against the semantics every adapter must
 *              honour: name lookup, permission-name listing (empty when absent),
 *              enriched role+permissions+userCount lookup, and active-role listing
 *              ordered by level descending.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  RoleRepository,
  RoleDto,
  RoleWithPermissionsDto,
} from "../../../../src/domain/repositories/RoleRepository.js";

interface RoleSeed extends RoleDto {
  permissions: string[];
  userCount: number;
}

class InMemoryRoleRepository implements RoleRepository {
  constructor(private readonly seeds: RoleSeed[]) {}

  private find(name: string): RoleSeed | undefined {
    return this.seeds.find((r) => r.name === name);
  }

  async findByName(name: string): Promise<RoleDto | null> {
    const r = this.find(name);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      level: r.level,
      isSystem: r.isSystem,
      isActive: r.isActive,
    };
  }

  async findPermissionNamesByName(name: string): Promise<string[]> {
    return this.find(name)?.permissions ?? [];
  }

  async findInfoByName(name: string): Promise<RoleWithPermissionsDto | null> {
    const r = this.find(name);
    if (!r) return null;
    return {
      ...(await this.findByName(name))!,
      permissions: r.permissions,
      userCount: r.userCount,
    };
  }

  async findAllActiveInfo(): Promise<RoleWithPermissionsDto[]> {
    return this.seeds
      .filter((r) => r.isActive)
      .slice()
      .sort((a, b) => b.level - a.level)
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        level: r.level,
        isSystem: r.isSystem,
        isActive: r.isActive,
        permissions: r.permissions,
        userCount: r.userCount,
      }));
  }
}

const seeds: RoleSeed[] = [
  {
    id: "role-admin",
    name: "ADMIN",
    description: "Admin",
    level: 5,
    isSystem: true,
    isActive: true,
    permissions: ["POSTS_READ", "POSTS_WRITE"],
    userCount: 3,
  },
  {
    id: "role-super",
    name: "SUPER_ADMIN",
    description: "Super",
    level: 10,
    isSystem: true,
    isActive: true,
    permissions: ["ALL"],
    userCount: 1,
  },
  {
    id: "role-legacy",
    name: "LEGACY",
    description: "Legacy",
    level: 1,
    isSystem: false,
    isActive: false,
    permissions: [],
    userCount: 0,
  },
];

describe("RoleRepository contract", () => {
  let repo: InMemoryRoleRepository;
  beforeEach(() => {
    repo = new InMemoryRoleRepository(seeds);
  });

  it("findByName returns the role DTO", async () => {
    const role = await repo.findByName("ADMIN");
    assert.strictEqual(role?.id, "role-admin");
    assert.strictEqual(role?.level, 5);
  });

  it("findByName returns null for an unknown role", async () => {
    assert.strictEqual(await repo.findByName("NOPE"), null);
  });

  it("findPermissionNamesByName returns the permission names", async () => {
    const perms = await repo.findPermissionNamesByName("ADMIN");
    assert.deepStrictEqual(perms, ["POSTS_READ", "POSTS_WRITE"]);
  });

  it("findPermissionNamesByName returns [] when the role is absent", async () => {
    assert.deepStrictEqual(await repo.findPermissionNamesByName("NOPE"), []);
  });

  it("findInfoByName returns permissions and user count", async () => {
    const info = await repo.findInfoByName("ADMIN");
    assert.strictEqual(info?.userCount, 3);
    assert.deepStrictEqual(info?.permissions, ["POSTS_READ", "POSTS_WRITE"]);
  });

  it("findInfoByName returns null for an unknown role", async () => {
    assert.strictEqual(await repo.findInfoByName("NOPE"), null);
  });

  it("findAllActiveInfo excludes inactive roles and orders by level descending", async () => {
    const roles = await repo.findAllActiveInfo();
    assert.deepStrictEqual(
      roles.map((r) => r.name),
      ["SUPER_ADMIN", "ADMIN"]
    );
  });
});
