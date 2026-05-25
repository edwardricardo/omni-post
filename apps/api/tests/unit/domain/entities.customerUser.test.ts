/**
 * @file entities.customerUser.test.ts
 * @description Unit tests for the CustomerUser domain entity.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CustomerUser } from "@core/domain/entities/CustomerUser.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

const MEMBER_PERMISSIONS: ReadonlySet<string> = new Set([
  "post:read",
  "post:create",
  "channel:read",
]);

const OWNER_PERMISSIONS: ReadonlySet<string> = new Set([
  "post:read",
  "post:create",
  "channel:manage",
  "billing:manage",
  "member:manage_roles",
]);

const memberRole = {
  roleId: "role-member",
  roleName: "MEMBER",
  roleLevel: 20,
  permissions: MEMBER_PERMISSIONS,
};

const ownerRole = {
  roleId: "role-owner",
  roleName: "OWNER",
  roleLevel: 100,
  permissions: OWNER_PERMISSIONS,
};

const makeInput = (overrides?: Record<string, unknown>) => ({
  id: VALID_UUID,
  accountId: "acc-001",
  email: "customer@example.com",
  passwordHash: "$argon2id$v=19$hashed",
  firstName: "Jane",
  lastName: "Doe",
  roleId: memberRole.roleId,
  roleName: memberRole.roleName,
  roleLevel: memberRole.roleLevel,
  permissions: memberRole.permissions,
  ...overrides,
});

const makeReconstituteProps = (overrides?: Record<string, unknown>) => ({
  id: VALID_UUID,
  accountId: "acc-001",
  email: "customer@example.com",
  passwordHash: "hash",
  firstName: "Jane",
  lastName: "Doe",
  roleId: memberRole.roleId,
  roleName: memberRole.roleName,
  roleLevel: memberRole.roleLevel,
  permissions: memberRole.permissions,
  isActive: true,
  isEmailVerified: false,
  mfaEnabled: false,
  joinedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("CustomerUser Entity", () => {
  describe("create", () => {
    it("returns ok when given valid data", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok, "Should succeed");
      assert.strictEqual(result.value.email, "customer@example.com");
      assert.strictEqual(result.value.firstName, "Jane");
      assert.strictEqual(result.value.lastName, "Doe");
      assert.strictEqual(result.value.roleId, "role-member");
      assert.strictEqual(result.value.roleName, "MEMBER");
      assert.strictEqual(result.value.roleLevel, 20);
      assert.strictEqual(result.value.isActive, true);
      assert.strictEqual(result.value.isEmailVerified, false);
      assert.strictEqual(result.value.mfaEnabled, false);
    });

    it("normalizes email to lowercase and trims whitespace", () => {
      const result = CustomerUser.create(makeInput({ email: "  UPPER@CASE.COM  " }));
      assert.ok(result.ok);
      assert.strictEqual(result.value.email, "upper@case.com");
    });

    it("trims firstName and lastName", () => {
      const result = CustomerUser.create(
        makeInput({ firstName: "  Alice  ", lastName: "  Smith  " })
      );
      assert.ok(result.ok);
      assert.strictEqual(result.value.firstName, "Alice");
      assert.strictEqual(result.value.lastName, "Smith");
    });

    it("accepts custom role snapshot", () => {
      const result = CustomerUser.create(
        makeInput({
          roleId: ownerRole.roleId,
          roleName: ownerRole.roleName,
          roleLevel: ownerRole.roleLevel,
          permissions: ownerRole.permissions,
        })
      );
      assert.ok(result.ok);
      assert.strictEqual(result.value.roleName, "OWNER");
      assert.strictEqual(result.value.roleLevel, 100);
    });

    it("rejects invalid email", () => {
      const result = CustomerUser.create(makeInput({ email: "not-an-email" }));
      assert.ok(!result.ok, "Should fail");
      expect(result.error.message).toContain("email");
    });

    it("rejects empty email", () => {
      const result = CustomerUser.create(makeInput({ email: "" }));
      assert.ok(!result.ok);
    });

    it("rejects empty firstName", () => {
      const result = CustomerUser.create(makeInput({ firstName: "" }));
      assert.ok(!result.ok);
      expect(result.error.message).toContain("First name");
    });

    it("rejects whitespace-only firstName", () => {
      const result = CustomerUser.create(makeInput({ firstName: "   " }));
      assert.ok(!result.ok);
    });

    it("rejects empty lastName", () => {
      const result = CustomerUser.create(makeInput({ lastName: "" }));
      assert.ok(!result.ok);
      expect(result.error.message).toContain("Last name");
    });

    it("rejects whitespace-only lastName", () => {
      const result = CustomerUser.create(makeInput({ lastName: "   " }));
      assert.ok(!result.ok);
    });

    it("rejects missing roleId", () => {
      const result = CustomerUser.create(makeInput({ roleId: "" }));
      assert.ok(!result.ok);
      expect(result.error.message).toContain("Role");
    });

    it("rejects missing accountId", () => {
      const result = CustomerUser.create(makeInput({ accountId: "" }));
      assert.ok(!result.ok);
      expect(result.error.message).toContain("Account");
    });
  });

  describe("reconstitute", () => {
    it("recreates entity from persisted props without validation", () => {
      const now = new Date();
      const user = CustomerUser.reconstitute({
        id: "cuid-recon-001",
        accountId: "acc-002",
        email: "recon@example.com",
        passwordHash: "hash",
        firstName: "Bob",
        lastName: "Builder",
        roleId: "role-owner",
        roleName: "OWNER",
        roleLevel: 100,
        permissions: new Set(["post:read"]),
        isActive: true,
        isEmailVerified: true,
        mfaEnabled: false,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      assert.strictEqual(user.id, "cuid-recon-001");
      assert.strictEqual(user.isEmailVerified, true);
      assert.strictEqual(user.roleName, "OWNER");
      assert.strictEqual(user.isOwner, true);
    });
  });

  describe("toJSON", () => {
    it("never includes passwordHash", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const json = result.value.toJSON();
      assert.strictEqual("passwordHash" in json, false);
    });

    it("never includes mfaSecret", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({ mfaEnabled: true, mfaSecret: "super-secret-totp" })
      );
      const json = user.toJSON();
      assert.strictEqual("mfaSecret" in json, false);
    });

    it("never includes emailVerifyToken", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({ emailVerifyToken: "token-abc" })
      );
      const json = user.toJSON();
      assert.strictEqual("emailVerifyToken" in json, false);
    });

    it("never includes resetToken", () => {
      const user = CustomerUser.reconstitute(makeReconstituteProps({ resetToken: "reset-xyz" }));
      const json = user.toJSON();
      assert.strictEqual("resetToken" in json, false);
    });

    it("never includes inviteToken", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({ inviteToken: "invite-abc", passwordHash: "" })
      );
      const json = user.toJSON();
      assert.strictEqual("inviteToken" in json, false);
    });

    it("includes expected public fields", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const json = result.value.toJSON();
      assert.strictEqual(json.id, VALID_UUID);
      assert.strictEqual(json.email, "customer@example.com");
      assert.strictEqual(json.firstName, "Jane");
      assert.strictEqual(json.lastName, "Doe");
      assert.strictEqual(json.roleName, "MEMBER");
      assert.strictEqual(json.roleLevel, 20);
      assert.strictEqual(json.isActive, true);
      assert.strictEqual(json.isEmailVerified, false);
      assert.strictEqual(json.mfaEnabled, false);
      assert.strictEqual(json.lastLoginAt, null);
      assert.ok(Array.isArray(json.permissions));
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
      expect(json.joinedAt).toBeDefined();
    });
  });

  describe("hasPermission", () => {
    it("returns true for granted permissions", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      assert.strictEqual(result.value.hasPermission("post:read"), true);
      assert.strictEqual(result.value.hasPermission("post:create"), true);
    });

    it("returns false for non-granted permissions", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      assert.strictEqual(result.value.hasPermission("billing:manage"), false);
      assert.strictEqual(result.value.hasPermission("account:delete"), false);
    });
  });

  describe("canManageRoleLevel", () => {
    it("returns true when this user outranks the target level", () => {
      const owner = CustomerUser.reconstitute(
        makeReconstituteProps({ roleName: "OWNER", roleLevel: 100 })
      );
      assert.strictEqual(owner.canManageRoleLevel(20), true);
      assert.strictEqual(owner.canManageRoleLevel(50), true);
    });

    it("returns false when this user is at or below the target level", () => {
      const member = CustomerUser.create(makeInput());
      assert.ok(member.ok);
      assert.strictEqual(member.value.canManageRoleLevel(20), false);
      assert.strictEqual(member.value.canManageRoleLevel(100), false);
    });
  });

  describe("updateRole", () => {
    it("succeeds when changer outranks both current and target", () => {
      const user = CustomerUser.create(makeInput()).value!; // MEMBER (level 20)
      const result = user.updateRole(
        "role-viewer",
        "VIEWER",
        10,
        new Set(["post:read"]),
        100 // changer is OWNER
      );
      assert.ok(result.ok);
      assert.strictEqual(user.roleName, "VIEWER");
      assert.strictEqual(user.roleLevel, 10);
    });

    it("rejects when changer does not outrank the current role", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({ roleName: "OWNER", roleLevel: 100 })
      );
      const result = user.updateRole("role-member", "MEMBER", 20, MEMBER_PERMISSIONS, 50);
      assert.ok(!result.ok);
      expect(result.error.message).toContain("equal or higher role");
    });

    it("rejects when changer does not outrank the new role", () => {
      const user = CustomerUser.create(makeInput()).value!;
      const result = user.updateRole("role-owner", "OWNER", 100, OWNER_PERMISSIONS, 50);
      assert.ok(!result.ok);
      expect(result.error.message).toContain("equal to or higher than your own");
    });
  });

  describe("markEmailVerified", () => {
    it("sets isEmailVerified to true and clears verify token", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({
          emailVerifyToken: "verify-abc",
          emailVerifyExpiry: new Date(Date.now() + 100000),
        })
      );

      user.markEmailVerified();

      assert.strictEqual(user.isEmailVerified, true);
      assert.strictEqual(user.emailVerifyToken, undefined);
      assert.strictEqual(user.emailVerifyExpiry, undefined);
    });
  });

  describe("recordLogin", () => {
    it("sets lastLoginAt to a recent date", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const user = result.value;

      assert.strictEqual(user.lastLoginAt, undefined);

      const before = new Date();
      user.recordLogin();
      const after = new Date();

      assert.ok(user.lastLoginAt !== undefined);
      assert.ok(user.lastLoginAt.getTime() >= before.getTime());
      assert.ok(user.lastLoginAt.getTime() <= after.getTime());
    });
  });

  describe("deactivate", () => {
    it("sets isActive to false for non-owner", () => {
      const result = CustomerUser.create(makeInput()); // MEMBER
      assert.ok(result.ok);
      const user = result.value;

      assert.strictEqual(user.isActive, true);

      const r = user.deactivate();
      assert.ok(r.ok);
      assert.strictEqual(user.isActive, false);
    });

    it("refuses to deactivate an OWNER", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({ roleName: "OWNER", roleLevel: 100 })
      );
      const r = user.deactivate();
      assert.ok(!r.ok);
      expect(r.error.message).toContain("Cannot deactivate the account owner");
      assert.strictEqual(user.isActive, true);
    });
  });

  describe("updateName", () => {
    it("updates both first and last names", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const r = result.value.updateName("Alice", "Smith");
      assert.ok(r.ok);
      assert.strictEqual(result.value.firstName, "Alice");
      assert.strictEqual(result.value.lastName, "Smith");
    });

    it("rejects empty firstName", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const r = result.value.updateName("", "Smith");
      assert.ok(!r.ok);
    });
  });

  describe("setInviteToken / acceptInvitation", () => {
    it("setInviteToken updates the token + expiry", () => {
      const user = CustomerUser.create(makeInput()).value!;
      const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      user.setInviteToken("invite-xyz", expiry);
      assert.strictEqual(user.inviteToken, "invite-xyz");
      assert.strictEqual(user.inviteTokenExpiry?.getTime(), expiry.getTime());
    });

    it("acceptInvitation clears the token + marks email verified", () => {
      const user = CustomerUser.reconstitute(
        makeReconstituteProps({
          passwordHash: "",
          inviteToken: "invite-abc",
          inviteTokenExpiry: new Date(Date.now() + 100000),
        })
      );
      assert.strictEqual(user.isPendingInvitation, true);

      const r = user.acceptInvitation("$argon2id$new-hash");
      assert.ok(r.ok);
      assert.strictEqual(user.passwordHash, "$argon2id$new-hash");
      assert.strictEqual(user.inviteToken, undefined);
      assert.strictEqual(user.isEmailVerified, true);
      assert.strictEqual(user.isPendingInvitation, false);
    });

    it("acceptInvitation refuses without an existing invite", () => {
      const user = CustomerUser.create(makeInput()).value!;
      const r = user.acceptInvitation("hash");
      assert.ok(!r.ok);
      expect(r.error.message).toContain("No pending invitation");
    });
  });

  describe("setResetToken and isResetTokenExpired", () => {
    let user: InstanceType<typeof CustomerUser>;

    beforeEach(() => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      user = result.value;
    });

    it("sets token and expiry", () => {
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      user.setResetToken("reset-token-123", expiry);

      assert.strictEqual(user.resetToken, "reset-token-123");
      assert.strictEqual(user.resetTokenExpiry?.getTime(), expiry.getTime());
    });

    it("reports non-expired token as not expired", () => {
      const expiry = new Date(Date.now() + 60 * 60 * 1000);
      user.setResetToken("token", expiry);

      assert.strictEqual(user.isResetTokenExpired(), false);
    });

    it("reports expired token as expired", () => {
      const pastExpiry = new Date(Date.now() - 1000);
      user.setResetToken("token", pastExpiry);

      assert.strictEqual(user.isResetTokenExpired(), true);
    });

    it("reports missing token as expired", () => {
      assert.strictEqual(user.isResetTokenExpired(), true);
    });
  });

  describe("clearResetToken", () => {
    it("removes reset token and expiry", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const user = result.value;

      user.setResetToken("token", new Date(Date.now() + 100000));
      assert.strictEqual(user.resetToken, "token");

      user.clearResetToken();

      assert.strictEqual(user.resetToken, undefined);
      assert.strictEqual(user.resetTokenExpiry, undefined);
    });
  });
});
