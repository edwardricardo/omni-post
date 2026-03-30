/**
 * @file customerAuthUseCases.test.ts
 * @description Unit tests for customer authentication use cases and middleware.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import argon2 from "argon2";
import { RegisterCustomerUseCase } from "../../src/application/customer-auth/RegisterCustomerUseCase.js";
import { LoginCustomerUseCase } from "../../src/application/customer-auth/LoginCustomerUseCase.js";
import { RefreshCustomerTokenUseCase } from "../../src/application/customer-auth/RefreshCustomerTokenUseCase.js";
import { ResetPasswordUseCase } from "../../src/application/customer-auth/ResetPasswordUseCase.js";
import { RequestPasswordResetUseCase } from "../../src/application/customer-auth/RequestPasswordResetUseCase.js";
import { LogoutCustomerUseCase } from "../../src/application/customer-auth/LogoutCustomerUseCase.js";
import { CustomerUser } from "../../src/domain/entities/CustomerUser.js";
import { Account } from "../../src/domain/entities/Account.js";
import { EntityNotFoundError } from "../../src/domain/errors/index.js";
import { AccountId } from "../../src/domain/value-objects/EntityId.js";

// ---- Mock factories ----

function makeCustomerUserRepo() {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByEmailAcrossAccounts: vi.fn().mockResolvedValue([]),
    findByAccountId: vi.fn().mockResolvedValue([]),
    findByResetToken: vi.fn(),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    updatePasswordHash: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeAccountRepo() {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    hardDelete: vi.fn().mockResolvedValue(ok(undefined)),
    exists: vi.fn().mockResolvedValue(false),
    findAll: vi.fn().mockResolvedValue([]),
  };
}

function makeUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
}

function makeExistingUser(overrides?: Record<string, unknown>) {
  const now = new Date();
  return CustomerUser.reconstitute({
    id: "existing-user-001",
    accountId: "existing-acc-001",
    email: "existing@example.com",
    passwordHash: "will-be-replaced",
    firstName: "Existing",
    lastName: "User",
    role: "OWNER",
    isActive: true,
    isEmailVerified: false,
    mfaEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ---- Tests ----

describe("RegisterCustomerUseCase", () => {
  let useCase: RegisterCustomerUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;
  let accountRepo: ReturnType<typeof makeAccountRepo>;
  let unitOfWork: ReturnType<typeof makeUnitOfWork>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    accountRepo = makeAccountRepo();
    unitOfWork = makeUnitOfWork();
    useCase = new RegisterCustomerUseCase(customerUserRepo, accountRepo, unitOfWork);
  });

  it("creates Account + CustomerUser atomically and returns tokens", async () => {
    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@testco.com",
      password: "securepass123",
    });

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    expect(result.value.accessToken).toBeDefined();
    expect(result.value.refreshToken).toBeDefined();
    expect(result.value.user).toBeDefined();
    expect(result.value.account).toBeDefined();
    expect(accountRepo.save).toHaveBeenCalledTimes(1);
    expect(customerUserRepo.save).toHaveBeenCalledTimes(1);
    expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate email", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([makeExistingUser()]);

    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "Alice",
      lastName: "Smith",
      email: "existing@example.com",
      password: "securepass123",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "EMAIL_EXISTS");
  });

  it("rejects short password", async () => {
    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@testco.com",
      password: "short",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });

  it("rejects missing firstName", async () => {
    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "",
      lastName: "Smith",
      email: "alice@testco.com",
      password: "securepass123",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });
});

describe("LoginCustomerUseCase", () => {
  let useCase: LoginCustomerUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;
  let accountRepo: ReturnType<typeof makeAccountRepo>;
  let hashedPassword: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    accountRepo = makeAccountRepo();
    useCase = new LoginCustomerUseCase(customerUserRepo, accountRepo);

    // Pre-hash a password for testing
    hashedPassword = await argon2.hash("correctpassword");
  });

  it("succeeds with valid credentials", async () => {
    const user = makeExistingUser({ passwordHash: hashedPassword });
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const accountId = AccountId.fromString(user.accountId);
    if (accountId.ok) {
      const account = Account.create({ email: "co@co.com", name: "TestCo" });
      if (account.ok) {
        accountRepo.findById.mockResolvedValue(ok(account.value));
      }
    }

    const result = await useCase.execute({
      email: "existing@example.com",
      password: "correctpassword",
    });

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    expect(result.value.accessToken).toBeDefined();
    expect(result.value.refreshToken).toBeDefined();
    expect(customerUserRepo.save).toHaveBeenCalledTimes(1); // recordLogin
  });

  it("returns INVALID_CREDENTIALS for wrong password", async () => {
    const user = makeExistingUser({ passwordHash: hashedPassword });
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const result = await useCase.execute({
      email: "existing@example.com",
      password: "wrongpassword",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_CREDENTIALS");
  });

  it("returns INVALID_CREDENTIALS for non-existent email", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([]);

    const result = await useCase.execute({
      email: "nobody@example.com",
      password: "whatever",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_CREDENTIALS");
  });

  it("returns USER_INACTIVE for deactivated user", async () => {
    const user = makeExistingUser({ passwordHash: hashedPassword, isActive: false });
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const result = await useCase.execute({
      email: "existing@example.com",
      password: "correctpassword",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "USER_INACTIVE");
  });

  it("returns MULTIPLE_ACCOUNTS when multiple accounts found and no slug", async () => {
    const user1 = makeExistingUser({ accountId: "acc-1" });
    const user2 = makeExistingUser({ id: "user-2", accountId: "acc-2" });
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user1, user2]);

    const result = await useCase.execute({
      email: "existing@example.com",
      password: "correctpassword",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "MULTIPLE_ACCOUNTS");
  });
});

describe("RefreshCustomerTokenUseCase", () => {
  let useCase: RefreshCustomerTokenUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    useCase = new RefreshCustomerTokenUseCase(customerUserRepo);
  });

  it("returns INVALID_TOKEN for garbage input", async () => {
    const result = await useCase.execute({
      refreshToken: "not-a-valid-jwt",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });

  it("returns USER_INACTIVE when user is deactivated", async () => {
    // We need a real refresh token, so we use the JWT signer
    const { signCustomerRefreshToken } = await import("../../src/auth/customerJwt.js");
    const token = signCustomerRefreshToken("user-123", "session-123");
    const inactiveUser = makeExistingUser({ id: "user-123", isActive: false });
    customerUserRepo.findById.mockResolvedValue(ok(inactiveUser));

    const result = await useCase.execute({ refreshToken: token });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "USER_INACTIVE");
  });

  it("issues new tokens when refresh token is valid and user is active", async () => {
    const { signCustomerRefreshToken } = await import("../../src/auth/customerJwt.js");
    const token = signCustomerRefreshToken("user-123", "session-123");
    const activeUser = makeExistingUser({ id: "user-123", isActive: true });
    customerUserRepo.findById.mockResolvedValue(ok(activeUser));

    const result = await useCase.execute({ refreshToken: token });

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    expect(result.value.accessToken).toBeDefined();
    expect(result.value.refreshToken).toBeDefined();
  });
});

describe("LogoutCustomerUseCase", () => {
  it("always returns ok", async () => {
    const useCase = new LogoutCustomerUseCase();
    const result = await useCase.execute();

    assert.ok(result.ok);
    assert.strictEqual(result.value.message, "Logged out successfully");
  });
});

describe("RequestPasswordResetUseCase", () => {
  let useCase: RequestPasswordResetUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    useCase = new RequestPasswordResetUseCase(customerUserRepo);
  });

  it("returns ok even when email does not exist (no enumeration)", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([]);

    const result = await useCase.execute({ email: "nobody@example.com" });

    assert.ok(result.ok);
    expect(customerUserRepo.save).not.toHaveBeenCalled();
  });

  it("sets reset token when user exists", async () => {
    const user = makeExistingUser();
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const result = await useCase.execute({ email: "existing@example.com" });

    assert.ok(result.ok);
    expect(customerUserRepo.save).toHaveBeenCalledTimes(1);
  });
});

describe("ResetPasswordUseCase", () => {
  let useCase: ResetPasswordUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    useCase = new ResetPasswordUseCase(customerUserRepo);
  });

  it("returns INVALID_TOKEN when token not found", async () => {
    customerUserRepo.findByResetToken.mockResolvedValue(
      err(new EntityNotFoundError("CustomerUser", "token"))
    );

    const result = await useCase.execute({
      token: "bad-token",
      newPassword: "newsecurepass",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });

  it("returns TOKEN_EXPIRED when token is expired", async () => {
    const user = makeExistingUser();
    user.setResetToken("valid-token", new Date(Date.now() - 100000));
    customerUserRepo.findByResetToken.mockResolvedValue(ok(user));

    const result = await useCase.execute({
      token: "valid-token",
      newPassword: "newsecurepass",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "TOKEN_EXPIRED");
  });

  it("resets password when token is valid and not expired", async () => {
    const user = makeExistingUser();
    user.setResetToken("valid-token", new Date(Date.now() + 3600000));
    customerUserRepo.findByResetToken.mockResolvedValue(ok(user));

    const result = await useCase.execute({
      token: "valid-token",
      newPassword: "newsecurepass",
    });

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    expect(customerUserRepo.updatePasswordHash).toHaveBeenCalledTimes(1);
    expect(customerUserRepo.save).toHaveBeenCalledTimes(1);
  });

  it("rejects short password", async () => {
    const result = await useCase.execute({
      token: "valid-token",
      newPassword: "short",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "VALIDATION_ERROR");
  });
});

describe("customerAuthMiddleware", () => {
  it("rejects requests without Authorization header", async () => {
    const { customerAuthMiddleware } = await import("../../src/auth/customerAuthMiddleware.js");

    const request = {
      headers: {},
    } as never;

    let sentStatus = 0;
    let sentBody: Record<string, unknown> = {};

    const reply = {
      code: (c: number) => {
        sentStatus = c;
        return reply;
      },
      send: (b: Record<string, unknown>) => {
        sentBody = b;
        return reply;
      },
    } as never;

    await customerAuthMiddleware(request, reply);

    assert.strictEqual(sentStatus, 401);
    expect(sentBody).toHaveProperty("error");
  });

  it("rejects admin JWT tokens", async () => {
    const { customerAuthMiddleware } = await import("../../src/auth/customerAuthMiddleware.js");
    const jwt = await import("jsonwebtoken");

    // Sign a token that does NOT have type: 'customer'
    const adminToken = jwt.default.sign({ userId: "admin-1", type: "admin" }, "some-admin-secret", {
      expiresIn: 300,
    });

    const request = {
      headers: { authorization: `Bearer ${adminToken}` },
    } as never;

    let sentStatus = 0;
    let sentBody: Record<string, unknown> = {};

    const reply = {
      code: (c: number) => {
        sentStatus = c;
        return reply;
      },
      send: (b: Record<string, unknown>) => {
        sentBody = b;
        return reply;
      },
    } as never;

    await customerAuthMiddleware(request, reply);

    assert.strictEqual(sentStatus, 401);
    expect(sentBody).toHaveProperty("error");
  });

  it("accepts valid customer token and attaches customerUser", async () => {
    const { customerAuthMiddleware } = await import("../../src/auth/customerAuthMiddleware.js");
    const { signCustomerAccessToken } = await import("../../src/auth/customerJwt.js");

    const token = signCustomerAccessToken({
      sub: "user-001",
      accountId: "acc-001",
      role: "OWNER",
    });

    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as Record<string, unknown>;

    const reply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };

    await customerAuthMiddleware(request as never, reply as never);

    // reply.code should NOT have been called (no error)
    expect(reply.code).not.toHaveBeenCalled();
    expect((request as Record<string, unknown>).customerUser).toEqual({
      id: "user-001",
      accountId: "acc-001",
      role: "OWNER",
    });
  });
});
