/**
 * @file entities.customerUser.test.ts
 * @description Unit tests for the CustomerUser domain entity.
 */

import { describe, it, expect, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CustomerUser, CUSTOMER_ROLE } from "../../../src/domain/entities/CustomerUser.js";

const makeInput = (overrides?: Record<string, unknown>) => ({
  id: "cuid-test-001",
  accountId: "acc-001",
  email: "customer@example.com",
  passwordHash: "$argon2id$v=19$hashed",
  firstName: "Jane",
  lastName: "Doe",
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
      assert.strictEqual(result.value.role, CUSTOMER_ROLE.MEMBER);
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

    it("accepts custom role", () => {
      const result = CustomerUser.create(makeInput({ role: CUSTOMER_ROLE.OWNER }));
      assert.ok(result.ok);
      assert.strictEqual(result.value.role, CUSTOMER_ROLE.OWNER);
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
        role: "OWNER",
        isActive: true,
        isEmailVerified: true,
        mfaEnabled: false,
        createdAt: now,
        updatedAt: now,
      });

      assert.strictEqual(user.id, "cuid-recon-001");
      assert.strictEqual(user.isEmailVerified, true);
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
      const user = CustomerUser.reconstitute({
        ...makeInput(),
        role: "MEMBER",
        isActive: true,
        isEmailVerified: false,
        mfaEnabled: true,
        mfaSecret: "super-secret-totp",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const json = user.toJSON();
      assert.strictEqual("mfaSecret" in json, false);
    });

    it("never includes emailVerifyToken", () => {
      const user = CustomerUser.reconstitute({
        ...makeInput(),
        role: "MEMBER",
        isActive: true,
        isEmailVerified: false,
        emailVerifyToken: "token-abc",
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const json = user.toJSON();
      assert.strictEqual("emailVerifyToken" in json, false);
    });

    it("never includes resetToken", () => {
      const user = CustomerUser.reconstitute({
        ...makeInput(),
        role: "MEMBER",
        isActive: true,
        isEmailVerified: false,
        resetToken: "reset-xyz",
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const json = user.toJSON();
      assert.strictEqual("resetToken" in json, false);
    });

    it("includes expected public fields", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const json = result.value.toJSON();
      assert.strictEqual(json.id, "cuid-test-001");
      assert.strictEqual(json.email, "customer@example.com");
      assert.strictEqual(json.firstName, "Jane");
      assert.strictEqual(json.lastName, "Doe");
      assert.strictEqual(json.role, "MEMBER");
      assert.strictEqual(json.isActive, true);
      assert.strictEqual(json.isEmailVerified, false);
      assert.strictEqual(json.mfaEnabled, false);
      assert.strictEqual(json.lastLoginAt, null);
      expect(json.createdAt).toBeDefined();
      expect(json.updatedAt).toBeDefined();
    });
  });

  describe("markEmailVerified", () => {
    it("sets isEmailVerified to true and clears verify token", () => {
      const user = CustomerUser.reconstitute({
        ...makeInput(),
        role: "MEMBER",
        isActive: true,
        isEmailVerified: false,
        emailVerifyToken: "verify-abc",
        emailVerifyExpiry: new Date(Date.now() + 100000),
        mfaEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

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
    it("sets isActive to false", () => {
      const result = CustomerUser.create(makeInput());
      assert.ok(result.ok);
      const user = result.value;

      assert.strictEqual(user.isActive, true);

      user.deactivate();

      assert.strictEqual(user.isActive, false);
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
