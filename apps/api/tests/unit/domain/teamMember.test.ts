/**
 * @file teamMember.test.ts
 * @description Unit tests for TeamMemberId, TeamRole, and TeamMemberEntity domain objects.
 * @layer domain
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { TeamMemberId } from "../../../src/domain/value-objects/TeamMemberId.js";
import { TeamRole, TEAM_ROLE } from "../../../src/domain/value-objects/TeamRole.js";
import { TeamMemberEntity } from "../../../src/domain/entities/TeamMember.js";

describe("TeamMemberId", () => {
  it("generates a valid UUID", () => {
    const id = TeamMemberId.generate();
    assert.ok(id.value.length > 0, "Generated ID should have a value");
  });

  it("creates from valid UUID string", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const result = TeamMemberId.fromString(uuid);
    assert.ok(result.ok, "Should accept valid UUID");
    if (result.ok) {
      assert.equal(result.value.value, uuid);
    }
  });

  it("rejects empty string", () => {
    const result = TeamMemberId.fromString("");
    assert.ok(!result.ok, "Should reject empty string");
  });

  it("rejects invalid UUID format", () => {
    const result = TeamMemberId.fromString("not-a-uuid");
    assert.ok(!result.ok, "Should reject invalid UUID");
  });

  it("creates from string unsafe without validation", () => {
    const id = TeamMemberId.fromStringUnsafe("any-string-value");
    assert.equal(id.value, "any-string-value");
  });

  it("supports equality check", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const id1 = TeamMemberId.fromStringUnsafe(uuid);
    const id2 = TeamMemberId.fromStringUnsafe(uuid);
    assert.ok(id1.equals(id2), "Same UUID should be equal");
  });

  it("detects inequality", () => {
    const id1 = TeamMemberId.generate();
    const id2 = TeamMemberId.generate();
    assert.ok(!id1.equals(id2), "Different UUIDs should not be equal");
  });
});

describe("TeamRole", () => {
  describe("fromString", () => {
    it("creates OWNER from string", () => {
      const result = TeamRole.fromString("OWNER");
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.value, "OWNER");
        assert.ok(result.value.isOwner());
      }
    });

    it("creates role from lowercase string", () => {
      const result = TeamRole.fromString("manager");
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.value, "MANAGER");
      }
    });

    it("rejects invalid role string", () => {
      const result = TeamRole.fromString("SUPERUSER");
      assert.ok(!result.ok, "Should reject invalid role");
    });
  });

  describe("factory methods", () => {
    it("creates OWNER via factory", () => {
      const role = TeamRole.owner();
      assert.ok(role.isOwner());
      assert.ok(!role.isManager());
    });

    it("creates MANAGER via factory", () => {
      const role = TeamRole.manager();
      assert.ok(role.isManager());
    });

    it("creates MEMBER via factory", () => {
      const role = TeamRole.member();
      assert.ok(role.isMember());
    });

    it("creates VIEWER via factory", () => {
      const role = TeamRole.viewer();
      assert.ok(role.isViewer());
    });
  });

  describe("permissions", () => {
    it("OWNER has all permissions", () => {
      const role = TeamRole.owner();
      assert.ok(role.hasPermission("READ"));
      assert.ok(role.hasPermission("WRITE"));
      assert.ok(role.hasPermission("PUBLISH"));
      assert.ok(role.hasPermission("APPROVE"));
      assert.ok(role.hasPermission("MANAGE_MEMBERS"));
    });

    it("VIEWER has only READ permission", () => {
      const role = TeamRole.viewer();
      assert.ok(role.hasPermission("READ"));
      assert.ok(!role.hasPermission("WRITE"));
      assert.ok(!role.hasPermission("PUBLISH"));
      assert.ok(!role.hasPermission("MANAGE_MEMBERS"));
    });

    it("MEMBER has READ, WRITE, PUBLISH but not MANAGE_MEMBERS", () => {
      const role = TeamRole.member();
      assert.ok(role.hasPermission("READ"));
      assert.ok(role.hasPermission("WRITE"));
      assert.ok(role.hasPermission("PUBLISH"));
      assert.ok(!role.hasPermission("MANAGE_MEMBERS"));
    });

    it("returns full permissions list", () => {
      const role = TeamRole.member();
      const perms = role.permissions();
      assert.ok(perms.includes("READ"));
      assert.ok(perms.includes("WRITE"));
      assert.ok(perms.includes("PUBLISH"));
      assert.equal(perms.length, 3);
    });
  });

  describe("canManageRole", () => {
    it("OWNER can manage MANAGER", () => {
      assert.ok(TeamRole.owner().canManageRole(TeamRole.manager()));
    });

    it("MANAGER can manage MEMBER", () => {
      assert.ok(TeamRole.manager().canManageRole(TeamRole.member()));
    });

    it("MEMBER cannot manage MANAGER", () => {
      assert.ok(!TeamRole.member().canManageRole(TeamRole.manager()));
    });

    it("same role cannot manage itself", () => {
      assert.ok(!TeamRole.manager().canManageRole(TeamRole.manager()));
    });

    it("VIEWER cannot manage anyone", () => {
      assert.ok(!TeamRole.viewer().canManageRole(TeamRole.viewer()));
      assert.ok(!TeamRole.viewer().canManageRole(TeamRole.member()));
    });
  });

  describe("equality", () => {
    it("same roles are equal", () => {
      assert.ok(TeamRole.owner().equals(TeamRole.owner()));
    });

    it("different roles are not equal", () => {
      assert.ok(!TeamRole.owner().equals(TeamRole.member()));
    });
  });
});

describe("TeamMemberEntity", () => {
  const validParams = {
    accountId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    email: "test@example.com",
    name: "Test User",
  };

  describe("create", () => {
    it("creates a valid member with default role MEMBER", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok, "Should create successfully");
      if (result.ok) {
        const member = result.value;
        assert.equal(member.email, "test@example.com");
        assert.equal(member.name, "Test User");
        assert.equal(member.role.value, TEAM_ROLE.MEMBER);
        assert.ok(member.isActive);
        assert.ok(member.id.value.length > 0);
      }
    });

    it("creates member with specified role", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "MANAGER",
      });
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.role.value, TEAM_ROLE.MANAGER);
      }
    });

    it("normalizes email to lowercase", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "TEST@EXAMPLE.COM",
      });
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.email, "test@example.com");
      }
    });

    it("trims name whitespace", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        name: "  Test User  ",
      });
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.name, "Test User");
      }
    });

    it("stores invitedBy when provided", () => {
      const inviterId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
      const result = TeamMemberEntity.create({
        ...validParams,
        invitedBy: inviterId,
      });
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.value.invitedBy, inviterId);
      }
    });

    it("rejects invalid email", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "not-an-email",
      });
      assert.ok(!result.ok, "Should reject invalid email");
    });

    it("rejects empty email", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "",
      });
      assert.ok(!result.ok, "Should reject empty email");
    });

    it("rejects empty name", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        name: "",
      });
      assert.ok(!result.ok, "Should reject empty name");
    });

    it("rejects empty accountId", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        accountId: "",
      });
      assert.ok(!result.ok, "Should reject empty accountId");
    });

    it("rejects invalid role string", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "SUPERADMIN" as "OWNER",
      });
      assert.ok(!result.ok, "Should reject invalid role");
    });
  });

  describe("updateRole", () => {
    it("allows OWNER to change MEMBER to MANAGER", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        const member = result.value;
        const updateResult = member.updateRole(TeamRole.manager(), TeamRole.owner());
        assert.ok(updateResult.ok, "OWNER should be able to promote MEMBER");
        assert.equal(member.role.value, TEAM_ROLE.MANAGER);
      }
    });

    it("rejects when changer has equal role", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        const updateResult = result.value.updateRole(TeamRole.viewer(), TeamRole.member());
        assert.ok(!updateResult.ok, "MEMBER should not manage another MEMBER");
      }
    });

    it("rejects assigning role equal to changer", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "VIEWER",
      });
      assert.ok(result.ok);
      if (result.ok) {
        const updateResult = result.value.updateRole(TeamRole.manager(), TeamRole.manager());
        assert.ok(!updateResult.ok, "Cannot assign role equal to own");
      }
    });
  });

  describe("deactivate", () => {
    it("deactivates a non-owner member", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        const deactivateResult = result.value.deactivate();
        assert.ok(deactivateResult.ok);
        assert.ok(!result.value.isActive);
      }
    });

    it("rejects deactivation of owner", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "OWNER",
      });
      assert.ok(result.ok);
      if (result.ok) {
        const deactivateResult = result.value.deactivate();
        assert.ok(!deactivateResult.ok, "Cannot deactivate owner");
      }
    });
  });

  describe("hasPermission", () => {
    it("MEMBER has READ permission", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.hasPermission("READ"));
      }
    });

    it("VIEWER lacks WRITE permission", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "VIEWER",
      });
      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(!result.value.hasPermission("WRITE"));
      }
    });
  });

  describe("updateName", () => {
    it("updates name successfully", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        const updateResult = result.value.updateName("New Name");
        assert.ok(updateResult.ok);
        assert.equal(result.value.name, "New Name");
      }
    });

    it("rejects empty name", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        const updateResult = result.value.updateName("");
        assert.ok(!updateResult.ok, "Should reject empty name");
      }
    });
  });

  describe("reactivate", () => {
    it("reactivates a deactivated member", () => {
      const result = TeamMemberEntity.create(validParams);
      assert.ok(result.ok);
      if (result.ok) {
        result.value.deactivate();
        assert.ok(!result.value.isActive);
        result.value.reactivate();
        assert.ok(result.value.isActive);
      }
    });
  });

  describe("reconstitute", () => {
    it("rebuilds entity from persisted props", () => {
      const now = new Date();
      const member = TeamMemberEntity.reconstitute({
        id: TeamMemberId.fromStringUnsafe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"),
        accountId: "account-123",
        email: "restored@example.com",
        name: "Restored User",
        role: TeamRole.manager(),
        isActive: true,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      assert.equal(member.email, "restored@example.com");
      assert.equal(member.role.value, TEAM_ROLE.MANAGER);
      assert.ok(member.isActive);
    });
  });
});
