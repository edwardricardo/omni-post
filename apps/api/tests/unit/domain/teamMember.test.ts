/**
 * @file teamMember.test.ts
 * @description Unit tests for TeamMemberId, TeamRole, and TeamMemberEntity domain objects.
 * @layer domain
 */

import { describe, it, expect } from "vitest";
import { TeamMemberId } from "../../../src/domain/value-objects/TeamMemberId.js";
import { TeamRole, TEAM_ROLE } from "../../../src/domain/value-objects/TeamRole.js";
import { TeamMemberEntity } from "../../../src/domain/entities/TeamMember.js";

describe("TeamMemberId", () => {
  it("generates a valid UUID", () => {
    const id = TeamMemberId.generate();
    expect(id.value.length > 0).toBeTruthy();
  });

  it("creates from valid UUID string", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const result = TeamMemberId.fromString(uuid);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.value).toBe(uuid);
    }
  });

  it("rejects empty string", () => {
    const result = TeamMemberId.fromString("");
    expect(result.ok).toBeFalsy();
  });

  it("rejects invalid UUID format", () => {
    const result = TeamMemberId.fromString("not-a-uuid");
    expect(result.ok).toBeFalsy();
  });

  it("creates from string unsafe without validation", () => {
    const id = TeamMemberId.fromStringUnsafe("any-string-value");
    expect(id.value).toBe("any-string-value");
  });

  it("supports equality check", () => {
    const uuid = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const id1 = TeamMemberId.fromStringUnsafe(uuid);
    const id2 = TeamMemberId.fromStringUnsafe(uuid);
    expect(id1.equals(id2)).toBeTruthy();
  });

  it("detects inequality", () => {
    const id1 = TeamMemberId.generate();
    const id2 = TeamMemberId.generate();
    expect(id1.equals(id2)).toBeFalsy();
  });
});

describe("TeamRole", () => {
  describe("fromString", () => {
    it("creates OWNER from string", () => {
      const result = TeamRole.fromString("OWNER");
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.value).toBe("OWNER");
        expect(result.value.isOwner()).toBeTruthy();
      }
    });

    it("creates role from lowercase string", () => {
      const result = TeamRole.fromString("manager");
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.value).toBe("MANAGER");
      }
    });

    it("rejects invalid role string", () => {
      const result = TeamRole.fromString("SUPERUSER");
      expect(result.ok).toBeFalsy();
    });
  });

  describe("factory methods", () => {
    it("creates OWNER via factory", () => {
      const role = TeamRole.owner();
      expect(role.isOwner()).toBeTruthy();
      expect(role.isManager()).toBeFalsy();
    });

    it("creates MANAGER via factory", () => {
      const role = TeamRole.manager();
      expect(role.isManager()).toBeTruthy();
    });

    it("creates MEMBER via factory", () => {
      const role = TeamRole.member();
      expect(role.isMember()).toBeTruthy();
    });

    it("creates VIEWER via factory", () => {
      const role = TeamRole.viewer();
      expect(role.isViewer()).toBeTruthy();
    });
  });

  describe("permissions", () => {
    it("OWNER has all permissions", () => {
      const role = TeamRole.owner();
      expect(role.hasPermission("READ")).toBeTruthy();
      expect(role.hasPermission("WRITE")).toBeTruthy();
      expect(role.hasPermission("PUBLISH")).toBeTruthy();
      expect(role.hasPermission("APPROVE")).toBeTruthy();
      expect(role.hasPermission("MANAGE_MEMBERS")).toBeTruthy();
    });

    it("VIEWER has only READ permission", () => {
      const role = TeamRole.viewer();
      expect(role.hasPermission("READ")).toBeTruthy();
      expect(role.hasPermission("WRITE")).toBeFalsy();
      expect(role.hasPermission("PUBLISH")).toBeFalsy();
      expect(role.hasPermission("MANAGE_MEMBERS")).toBeFalsy();
    });

    it("MEMBER has READ, WRITE, PUBLISH but not MANAGE_MEMBERS", () => {
      const role = TeamRole.member();
      expect(role.hasPermission("READ")).toBeTruthy();
      expect(role.hasPermission("WRITE")).toBeTruthy();
      expect(role.hasPermission("PUBLISH")).toBeTruthy();
      expect(role.hasPermission("MANAGE_MEMBERS")).toBeFalsy();
    });

    it("returns full permissions list", () => {
      const role = TeamRole.member();
      const perms = role.permissions();
      expect(perms.includes("READ")).toBeTruthy();
      expect(perms.includes("WRITE")).toBeTruthy();
      expect(perms.includes("PUBLISH")).toBeTruthy();
      expect(perms.length).toBe(3);
    });
  });

  describe("canManageRole", () => {
    it("OWNER can manage MANAGER", () => {
      expect(TeamRole.owner().canManageRole(TeamRole.manager())).toBeTruthy();
    });

    it("MANAGER can manage MEMBER", () => {
      expect(TeamRole.manager().canManageRole(TeamRole.member())).toBeTruthy();
    });

    it("MEMBER cannot manage MANAGER", () => {
      expect(TeamRole.member().canManageRole(TeamRole.manager())).toBeFalsy();
    });

    it("same role cannot manage itself", () => {
      expect(TeamRole.manager().canManageRole(TeamRole.manager())).toBeFalsy();
    });

    it("VIEWER cannot manage anyone", () => {
      expect(TeamRole.viewer().canManageRole(TeamRole.viewer())).toBeFalsy();
      expect(TeamRole.viewer().canManageRole(TeamRole.member())).toBeFalsy();
    });
  });

  describe("equality", () => {
    it("same roles are equal", () => {
      expect(TeamRole.owner().equals(TeamRole.owner())).toBeTruthy();
    });

    it("different roles are not equal", () => {
      expect(TeamRole.owner().equals(TeamRole.member())).toBeFalsy();
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
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const member = result.value;
        expect(member.email).toBe("test@example.com");
        expect(member.name).toBe("Test User");
        expect(member.role.value).toBe(TEAM_ROLE.MEMBER);
        expect(member.isActive).toBeTruthy();
        expect(member.id.value.length > 0).toBeTruthy();
      }
    });

    it("creates member with specified role", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "MANAGER",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.role.value).toBe(TEAM_ROLE.MANAGER);
      }
    });

    it("normalizes email to lowercase", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "TEST@EXAMPLE.COM",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.email).toBe("test@example.com");
      }
    });

    it("trims name whitespace", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        name: "  Test User  ",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.name).toBe("Test User");
      }
    });

    it("stores invitedBy when provided", () => {
      const inviterId = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
      const result = TeamMemberEntity.create({
        ...validParams,
        invitedBy: inviterId,
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.invitedBy).toBe(inviterId);
      }
    });

    it("rejects invalid email", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "not-an-email",
      });
      expect(result.ok).toBeFalsy();
    });

    it("rejects empty email", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        email: "",
      });
      expect(result.ok).toBeFalsy();
    });

    it("rejects empty name", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        name: "",
      });
      expect(result.ok).toBeFalsy();
    });

    it("rejects empty accountId", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        accountId: "",
      });
      expect(result.ok).toBeFalsy();
    });

    it("rejects invalid role string", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "SUPERADMIN" as "OWNER",
      });
      expect(result.ok).toBeFalsy();
    });
  });

  describe("updateRole", () => {
    it("allows OWNER to change MEMBER to MANAGER", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const member = result.value;
        const updateResult = member.updateRole(TeamRole.manager(), TeamRole.owner());
        expect(updateResult.ok).toBeTruthy();
        expect(member.role.value).toBe(TEAM_ROLE.MANAGER);
      }
    });

    it("rejects when changer has equal role", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updateResult = result.value.updateRole(TeamRole.viewer(), TeamRole.member());
        expect(updateResult.ok).toBeFalsy();
      }
    });

    it("rejects assigning role equal to changer", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "VIEWER",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updateResult = result.value.updateRole(TeamRole.manager(), TeamRole.manager());
        expect(updateResult.ok).toBeFalsy();
      }
    });
  });

  describe("deactivate", () => {
    it("deactivates a non-owner member", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const deactivateResult = result.value.deactivate();
        expect(deactivateResult.ok).toBeTruthy();
        expect(result.value.isActive).toBeFalsy();
      }
    });

    it("rejects deactivation of owner", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "OWNER",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const deactivateResult = result.value.deactivate();
        expect(deactivateResult.ok).toBeFalsy();
      }
    });
  });

  describe("hasPermission", () => {
    it("MEMBER has READ permission", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.hasPermission("READ")).toBeTruthy();
      }
    });

    it("VIEWER lacks WRITE permission", () => {
      const result = TeamMemberEntity.create({
        ...validParams,
        role: "VIEWER",
      });
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.hasPermission("WRITE")).toBeFalsy();
      }
    });
  });

  describe("updateName", () => {
    it("updates name successfully", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updateResult = result.value.updateName("New Name");
        expect(updateResult.ok).toBeTruthy();
        expect(result.value.name).toBe("New Name");
      }
    });

    it("rejects empty name", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        const updateResult = result.value.updateName("");
        expect(updateResult.ok).toBeFalsy();
      }
    });
  });

  describe("reactivate", () => {
    it("reactivates a deactivated member", () => {
      const result = TeamMemberEntity.create(validParams);
      expect(result.ok).toBeTruthy();
      if (result.ok) {
        result.value.deactivate();
        expect(result.value.isActive).toBeFalsy();
        result.value.reactivate();
        expect(result.value.isActive).toBeTruthy();
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

      expect(member.email).toBe("restored@example.com");
      expect(member.role.value).toBe(TEAM_ROLE.MANAGER);
      expect(member.isActive).toBeTruthy();
    });
  });
});
