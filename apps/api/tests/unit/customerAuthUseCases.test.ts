/**
 * @file customerAuthUseCases.test.ts
 * @description Unit tests for customer authentication use cases and middleware.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import argon2 from "argon2";
import { RegisterCustomerUseCase } from "@core/customer-auth/RegisterCustomerUseCase.js";
import { LoginCustomerUseCase } from "@core/customer-auth/LoginCustomerUseCase.js";
import { RefreshCustomerTokenUseCase } from "@core/customer-auth/RefreshCustomerTokenUseCase.js";
import { ResetPasswordUseCase } from "@core/customer-auth/ResetPasswordUseCase.js";
import { RequestPasswordResetUseCase } from "@core/customer-auth/RequestPasswordResetUseCase.js";
import { LogoutCustomerUseCase } from "@core/customer-auth/LogoutCustomerUseCase.js";
import type { BruteForceProtectionPort, MfaChallengeStorePort } from "@ports/core";

/** Brute-force port mock that allows by default (the gate is exercised in its
 *  own adapter tests + the e2e smoke). */
function makeBruteForce(): BruteForceProtectionPort {
  return {
    checkLoginAttempt: vi.fn(async () => ({
      allowed: true,
      delaySeconds: 0,
      captchaRequired: false,
    })),
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
  } as unknown as BruteForceProtectionPort;
}

/** Challenge store mock — never exercised by these non-MFA login fixtures. */
function makeChallengeStore(): MfaChallengeStorePort {
  return {
    issue: vi.fn(async () => ok(undefined)),
    consume: vi.fn(async () => ok("CONSUMED")),
  } as unknown as MfaChallengeStorePort;
}
import { Argon2PasswordHasher } from "../../src/infrastructure/adapters/Argon2PasswordHasher.js";
import { CustomerTokenServiceAdapter } from "../../src/infrastructure/adapters/CustomerTokenServiceAdapter.js";
import { InMemoryCacheAdapter } from "@adapters/cache-redis";
import { CustomerUser } from "@core/domain/entities/CustomerUser.js";
import { Account } from "@core/domain/entities/Account.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";

// ---- Real adapters (stateless; sign/hash with the production implementations
// so token + password round-trips behave exactly as in production) ----

const hasher = new Argon2PasswordHasher();
const tokenService = new CustomerTokenServiceAdapter();

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
    roleId: "role-owner",
    roleName: "OWNER",
    roleLevel: 100,
    permissions: new Set(["post:read", "billing:manage"]),
    isActive: true,
    isEmailVerified: false,
    mfaEnabled: false,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

// ---- Tests ----

function makeCustomerRoleRepo() {
  return {
    getSnapshotByName: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        roleId: "role-owner",
        roleName: "OWNER",
        roleLevel: 100,
        permissions: new Set(["post:read", "billing:manage"]),
      },
    }),
    getSnapshotById: vi.fn(),
    listAll: vi.fn().mockResolvedValue([]),
  } as never;
}

describe("RegisterCustomerUseCase", () => {
  let useCase: RegisterCustomerUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;
  let customerRoleRepo: ReturnType<typeof makeCustomerRoleRepo>;
  let accountRepo: ReturnType<typeof makeAccountRepo>;
  let unitOfWork: ReturnType<typeof makeUnitOfWork>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    customerRoleRepo = makeCustomerRoleRepo();
    accountRepo = makeAccountRepo();
    unitOfWork = makeUnitOfWork();
    useCase = new RegisterCustomerUseCase(
      customerUserRepo,
      customerRoleRepo,
      accountRepo,
      hasher,
      tokenService,
      undefined,
      unitOfWork
    );
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
    useCase = new LoginCustomerUseCase(
      customerUserRepo,
      accountRepo,
      hasher,
      tokenService,
      makeBruteForce(),
      makeChallengeStore()
    );

    // Pre-hash a password for testing
    hashedPassword = await argon2.hash("correctpassword");
  });

  it("succeeds with valid credentials", async () => {
    // Fixture fidelity: `accountId` is a UUID FK in the real schema, and the
    // account-liveness gate fail-closes on an id it cannot resolve — the old
    // "existing-acc-001" placeholder id is unrepresentable in Postgres and the
    // former tolerant account fetch that let it pass WAS the defect (a deleted
    // or unresolvable account still logged in).
    const user = makeExistingUser({
      passwordHash: hashedPassword,
      accountId: "a1000000-0000-4000-8000-000000000001",
    });
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const accountId = AccountId.fromString(user.accountId);
    assert.ok(accountId.ok, "fixture accountId must be a valid UUID");
    const account = Account.create({ email: "co@co.com", name: "TestCo" });
    assert.ok(account.ok);
    accountRepo.findById.mockResolvedValue(ok(account.value));

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
  let cache: InMemoryCacheAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    cache = new InMemoryCacheAdapter();
    useCase = new RefreshCustomerTokenUseCase(customerUserRepo, cache, tokenService);
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

  it("returns INVALID_TOKEN when the session has been revoked via logout", async () => {
    const { signCustomerRefreshToken } = await import("../../src/auth/customerJwt.js");
    const token = signCustomerRefreshToken("user-123", "session-revoked");
    // Revoke the session before the refresh attempt
    const logoutUseCase = new LogoutCustomerUseCase(cache, tokenService);
    await logoutUseCase.execute({ refreshToken: token });

    const result = await useCase.execute({ refreshToken: token });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });
});

describe("LogoutCustomerUseCase", () => {
  let cache: InMemoryCacheAdapter;
  let useCase: LogoutCustomerUseCase;

  beforeEach(() => {
    cache = new InMemoryCacheAdapter();
    useCase = new LogoutCustomerUseCase(cache, tokenService);
  });

  it("returns ok and is a no-op when refreshToken is null", async () => {
    const result = await useCase.execute({ refreshToken: null });

    assert.ok(result.ok);
    assert.strictEqual(result.value.message, "Logged out successfully");
  });

  it("returns ok and is a no-op when refreshToken is malformed", async () => {
    const result = await useCase.execute({ refreshToken: "not-a-jwt" });

    assert.ok(result.ok);
    // Cache should be empty — nothing to revoke from a malformed token
    expect(await cache.has("customer-session-revoked:any")).toBe(false);
  });

  it("revokes the session id encoded in a valid refresh token", async () => {
    const { signCustomerRefreshToken } = await import("../../src/auth/customerJwt.js");
    const token = signCustomerRefreshToken("user-123", "session-abc");

    const result = await useCase.execute({ refreshToken: token });

    assert.ok(result.ok);
    expect(await cache.has("customer-session-revoked:session-abc")).toBe(true);
  });
});

describe("RequestPasswordResetUseCase", () => {
  let useCase: RequestPasswordResetUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    useCase = new RequestPasswordResetUseCase(customerUserRepo, "http://localhost:3200");
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
    useCase = new ResetPasswordUseCase(customerUserRepo, hasher);
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
    const { requireClientAuth: customerAuthMiddleware } =
      await import("../../src/auth/customerAuthMiddleware.js");

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
    const { requireClientAuth: customerAuthMiddleware } =
      await import("../../src/auth/customerAuthMiddleware.js");
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
    const { requireClientAuth: customerAuthMiddleware } =
      await import("../../src/auth/customerAuthMiddleware.js");
    const { signCustomerAccessToken } = await import("../../src/auth/customerJwt.js");

    const token = signCustomerAccessToken({
      sub: "user-001",
      accountId: "acc-001",
      roleId: "role-owner",
      roleName: "OWNER",
      permissions: ["post:read", "billing:manage"],
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
      roleId: "role-owner",
      roleName: "OWNER",
      permissions: ["post:read", "billing:manage"],
    });
  });
});
