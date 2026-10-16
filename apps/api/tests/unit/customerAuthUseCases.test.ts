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
import { AccountId } from "@core/domain/value-objects/EntityId.js";
import { AccountEmailTakenError } from "@core/domain/repositories/AccountRepository.js";
import { EntityNotFoundError } from "@core/domain/errors/index.js";

// ---- Real adapters (stateless; sign/hash with the production implementations
// so token + password round-trips behave exactly as in production) ----

const hasher = new Argon2PasswordHasher();
const tokenService = new CustomerTokenServiceAdapter();

// ---- Mock factories ----

/**
 * Use-case-level ERROR-CONTRACT double. It decides what each repository call
 * ANSWERS, so the tests below can pin how a use case reacts to each failure class.
 * It deliberately holds no state, so it can say nothing about what ends up stored —
 * every persisted-outcome assertion lives in `customerPasswordResetClaim.test.ts`
 * and `customerPasswordResetRequest.test.ts`, which drive the REAL adapter over a
 * stateful fake of the Prisma client.
 */
function makeCustomerUserRepo() {
  return {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    findByEmailAcrossAccounts: vi.fn().mockResolvedValue([]),
    existsDeletedByEmailAcrossAccounts: vi.fn().mockResolvedValue(false),
    findByAccountId: vi.fn().mockResolvedValue([]),
    claimPasswordReset: vi.fn().mockResolvedValue(ok(undefined)),
    issueResetToken: vi.fn().mockResolvedValue(ok(undefined)),
    create: vi.fn().mockResolvedValue(ok(undefined)),
    recordLogin: vi.fn().mockResolvedValue(ok(undefined)),
    upgradePasswordHash: vi.fn().mockResolvedValue(ok(undefined)),
    changeRole: vi.fn().mockResolvedValue(ok(undefined)),
    deactivate: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
  };
}

function makeAccountRepo() {
  return {
    findById: vi.fn(),
    findByIdIncludingDeleted: vi.fn(),
    findByEmail: vi.fn().mockResolvedValue(null),
    existsDeletedByEmail: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(ok(undefined)),
    delete: vi.fn().mockResolvedValue(ok(undefined)),
    restore: vi.fn().mockResolvedValue(ok(undefined)),
    hardDelete: vi.fn().mockResolvedValue(ok(undefined)),
    exists: vi.fn().mockResolvedValue(false),
    findAll: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Unit of Work double that records what a real one would do with each unit: a
 * Result-returning unit commits on `ok` and rolls back on `err`, so a test can pin
 * that a failure inside the unit is a rollback rather than a commit.
 */
function makeUnitOfWork() {
  const outcomes: ("commit" | "rollback")[] = [];
  return {
    outcomes,
    executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
    executeResultInTransaction: vi.fn(async (fn: () => Promise<{ readonly ok: boolean }>) => {
      const result = await fn();
      outcomes.push(result.ok ? "commit" : "rollback");
      return result;
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
  const LIVE_ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
  const SUPPORT_EMAIL = "help@test.io";

  let useCase: RegisterCustomerUseCase;
  let customerUserRepo: ReturnType<typeof makeCustomerUserRepo>;
  let customerRoleRepo: ReturnType<typeof makeCustomerRoleRepo>;
  let accountRepo: ReturnType<typeof makeAccountRepo>;
  let unitOfWork: ReturnType<typeof makeUnitOfWork>;
  let logger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  let welcomeMailer: { sendWelcome: ReturnType<typeof vi.fn> };
  let noticeMailer: { notifyRegistrationAttemptOnDeletedAccount: ReturnType<typeof vi.fn> };

  /** Lets the fire-and-forget e-mail chains, all on resolved doubles, run to the end. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const input = (overrides?: { email?: string; accountEmail?: string }) => ({
    accountName: "TestCo",
    accountEmail: overrides?.accountEmail ?? "alice@testco.com",
    firstName: "Alice",
    lastName: "Smith",
    email: overrides?.email ?? "alice@testco.com",
    password: "securepass123",
  });

  const liveAccount = () => {
    const created = Account.create({ email: "alice@testco.com", name: "TestCo" });
    assert.ok(created.ok);
    return created.value;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    customerRoleRepo = makeCustomerRoleRepo();
    accountRepo = makeAccountRepo();
    unitOfWork = makeUnitOfWork();
    logger = { error: vi.fn(), warn: vi.fn() };
    welcomeMailer = { sendWelcome: vi.fn().mockResolvedValue(ok(undefined)) };
    noticeMailer = {
      notifyRegistrationAttemptOnDeletedAccount: vi.fn().mockResolvedValue(ok(undefined)),
    };
    useCase = new RegisterCustomerUseCase(
      customerUserRepo,
      customerRoleRepo,
      accountRepo,
      hasher,
      tokenService,
      logger,
      undefined,
      welcomeMailer,
      {
        getPlatformCredentials: vi
          .fn()
          .mockResolvedValue(ok({ baseUrl: "https://app.test", supportEmail: SUPPORT_EMAIL })),
      },
      noticeMailer,
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
    expect(customerUserRepo.create).toHaveBeenCalledTimes(1);
    expect(unitOfWork.executeResultInTransaction).toHaveBeenCalledTimes(1);
    expect(unitOfWork.executeInTransaction).not.toHaveBeenCalled();
    assert.deepStrictEqual(unitOfWork.outcomes, ["commit"]);
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("returns EMAIL_EXISTS with no notice when a live user of a live account holds the address", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([
      makeExistingUser({ accountId: LIVE_ACCOUNT_ID }),
    ]);
    accountRepo.findById.mockResolvedValue(ok(liveAccount()));

    const result = await useCase.execute(input({ email: "existing@example.com" }));

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    expect(accountRepo.save).not.toHaveBeenCalled();
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("returns EMAIL_EXISTS with no notice when a live account with no user holds the address", async () => {
    accountRepo.findByEmail.mockResolvedValue(liveAccount());

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    expect(accountRepo.save).not.toHaveBeenCalled();
    expect(unitOfWork.executeResultInTransaction).not.toHaveBeenCalled();
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).not.toHaveBeenCalled();
  });

  it("returns EMAIL_EXISTS and notifies the address when its live user belongs to a soft-deleted account", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([
      makeExistingUser({ accountId: LIVE_ACCOUNT_ID }),
    ]);
    accountRepo.findById.mockResolvedValue(
      err(new EntityNotFoundError("Account", LIVE_ACCOUNT_ID))
    );

    const result = await useCase.execute(input({ email: "Existing@Example.com" }));

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    expect(accountRepo.save).not.toHaveBeenCalled();
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledExactlyOnceWith(
      "existing@example.com",
      { supportEmail: SUPPORT_EMAIL }
    );
  });

  it("returns EMAIL_EXISTS and notifies the address when a soft-deleted user holds it", async () => {
    customerUserRepo.existsDeletedByEmailAcrossAccounts.mockResolvedValue(true);

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    expect(accountRepo.save).not.toHaveBeenCalled();
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledExactlyOnceWith(
      "alice@testco.com",
      { supportEmail: SUPPORT_EMAIL }
    );
  });

  it("returns EMAIL_EXISTS and notifies the account address when a soft-deleted account holds it", async () => {
    accountRepo.existsDeletedByEmail.mockResolvedValue(true);

    const result = await useCase.execute(input({ accountEmail: "billing@testco.com" }));

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    expect(accountRepo.existsDeletedByEmail).toHaveBeenCalledWith("billing@testco.com");
    expect(accountRepo.save).not.toHaveBeenCalled();
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledExactlyOnceWith(
      "billing@testco.com",
      { supportEmail: SUPPORT_EMAIL }
    );
  });

  it("sends one notice when a soft-deleted user and a soft-deleted account hold the same address", async () => {
    customerUserRepo.existsDeletedByEmailAcrossAccounts.mockResolvedValue(true);
    accountRepo.existsDeletedByEmail.mockResolvedValue(true);

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    await settle();
    expect(noticeMailer.notifyRegistrationAttemptOnDeletedAccount).toHaveBeenCalledTimes(1);
  });

  it("answers a deleted holder exactly as it answers a live one", async () => {
    accountRepo.findByEmail.mockResolvedValue(liveAccount());
    const liveRefusal = await useCase.execute(input());

    accountRepo.findByEmail.mockResolvedValue(null);
    accountRepo.existsDeletedByEmail.mockResolvedValue(true);
    const deletedRefusal = await useCase.execute(input());

    assert.deepStrictEqual(deletedRefusal, liveRefusal);
  });

  it("still returns EMAIL_EXISTS, and logs without the address, when the notice fails", async () => {
    accountRepo.existsDeletedByEmail.mockResolvedValue(true);
    noticeMailer.notifyRegistrationAttemptOnDeletedAccount.mockResolvedValue(
      err(new Error("transport down"))
    );

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.deletedAccountNotice" }),
      "A registration e-mail was not sent"
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("alice@testco.com");
  });

  it("still returns EMAIL_EXISTS, and logs, when the notice throws", async () => {
    accountRepo.existsDeletedByEmail.mockResolvedValue(true);
    noticeMailer.notifyRegistrationAttemptOnDeletedAccount.mockRejectedValue(
      new Error("render failed")
    );

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.deletedAccountNotice" }),
      "A registration e-mail was not sent"
    );
  });

  it("logs a failed welcome e-mail instead of swallowing it, and keeps the registration", async () => {
    welcomeMailer.sendWelcome.mockResolvedValue(err(new Error("transport down")));

    const result = await useCase.execute(input());

    assert.ok(result.ok);
    await settle();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.welcomeEmail" }),
      "A registration e-mail was not sent"
    );
  });

  it("returns EMAIL_EXISTS and rolls back when the account save loses the race for the address", async () => {
    accountRepo.save.mockResolvedValue(err(new AccountEmailTakenError()));

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("EMAIL_EXISTS"));
    assert.deepStrictEqual(unitOfWork.outcomes, ["rollback"]);
    expect(customerUserRepo.create).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns INTERNAL_ERROR, rolls back and logs when the account save fails otherwise", async () => {
    accountRepo.save.mockResolvedValue(err(new Error("connection lost")));

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("INTERNAL_ERROR"));
    assert.deepStrictEqual(unitOfWork.outcomes, ["rollback"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer.saveAccount" }),
      "The account could not be saved during registration"
    );
  });

  it("returns INTERNAL_ERROR and logs when the holder lookup throws", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockRejectedValue(new Error("database down"));

    const result = await useCase.execute(input());

    assert.deepStrictEqual(result, err("INTERNAL_ERROR"));
    expect(accountRepo.save).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "registerCustomer" }),
      "Customer registration failed"
    );
  });

  it("reports EMAIL_EXISTS when the creation write itself reports the address taken", async () => {
    // The pre-flight lookup finds nothing, so this is the race it cannot close:
    // the database's unique constraint answers instead, and the use case must
    // report the SAME class it reports for a duplicate it did see. Anything else
    // makes a registration that lost a race read as a server fault.
    customerUserRepo.create.mockResolvedValue(err("EMAIL_EXISTS"));

    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@testco.com",
      password: "securepass123",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "EMAIL_EXISTS");
    // The account saved before the losing insert goes back with it.
    assert.deepStrictEqual(unitOfWork.outcomes, ["rollback"]);
  });

  it("reports INTERNAL_ERROR when the creation write fails for any other reason", async () => {
    customerUserRepo.create.mockResolvedValue(err("INTERNAL_ERROR"));

    const result = await useCase.execute({
      accountName: "TestCo",
      accountEmail: "admin@testco.com",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@testco.com",
      password: "securepass123",
    });

    assert.ok(!result.ok);
    assert.strictEqual(
      result.error,
      "INTERNAL_ERROR",
      "the duplicate branch must not absorb every write failure — the two classes stay distinguishable"
    );
    assert.deepStrictEqual(unitOfWork.outcomes, ["rollback"]);
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
    expect(customerUserRepo.recordLogin).toHaveBeenCalledTimes(1);
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
  let emailPort: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    customerUserRepo = makeCustomerUserRepo();
    emailPort = { send: vi.fn().mockResolvedValue(ok(undefined)) };
    useCase = new RequestPasswordResetUseCase(
      customerUserRepo,
      "http://localhost:3200",
      emailPort as never
    );
  });

  it("returns ok even when email does not exist (no enumeration)", async () => {
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([]);

    const result = await useCase.execute({ email: "nobody@example.com" });

    assert.ok(result.ok);
    expect(customerUserRepo.issueResetToken).not.toHaveBeenCalled();
    expect(emailPort.send).not.toHaveBeenCalled();
  });

  it("issues one token per matched row and reports none unpersisted", async () => {
    const user = makeExistingUser();
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);

    const result = await useCase.execute({ email: "existing@example.com" });

    assert.ok(result.ok);
    assert.strictEqual(result.value.unpersistedCount, 0);
    expect(customerUserRepo.issueResetToken).toHaveBeenCalledTimes(1);
    const [issuedFor, token, expiresAt] = customerUserRepo.issueResetToken.mock.calls[0] as [
      string,
      string,
      Date,
    ];
    assert.strictEqual(
      issuedFor,
      user.id,
      "the token is issued for the matched ROW, not the address"
    );
    assert.ok(token.length >= 32, "the token must be high-entropy");
    assert.ok(expiresAt.getTime() > Date.now(), "the token must be issued with a future expiry");
    expect(emailPort.send).toHaveBeenCalledTimes(1);
  });

  it("counts a row whose token could not be persisted instead of discarding it", async () => {
    const user = makeExistingUser();
    customerUserRepo.findByEmailAcrossAccounts.mockResolvedValue([user]);
    customerUserRepo.issueResetToken.mockResolvedValue(err("INTERNAL_ERROR"));

    const result = await useCase.execute({ email: "existing@example.com" });

    assert.ok(result.ok, "the uniform response survives a per-row failure");
    assert.strictEqual(result.value.unpersistedCount, 1);
    expect(emailPort.send).not.toHaveBeenCalled();
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

  it("returns INVALID_TOKEN when the claim matches no row", async () => {
    customerUserRepo.claimPasswordReset.mockResolvedValue(err("INVALID_TOKEN"));

    const result = await useCase.execute({
      token: "bad-token",
      newPassword: "newsecurepass",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN for an expired token, produced by the claim predicate", async () => {
    // The expiry is enforced INSIDE the claim's own `where` (a strictly future
    // `resetTokenExpiry`), so an expired token simply matches zero rows and is
    // reported as the single unusable-token code. There is no separate expiry
    // verdict left to emit: distinguishing "expired" from "unknown" would be a
    // token-validity oracle.
    customerUserRepo.claimPasswordReset.mockResolvedValue(err("INVALID_TOKEN"));

    const result = await useCase.execute({
      token: "expired-token",
      newPassword: "newsecurepass",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INVALID_TOKEN");
    assert.notStrictEqual(
      result.error as string,
      "TOKEN_EXPIRED",
      "the expired-token code is gone from this flow"
    );
  });

  it("surfaces INTERNAL_ERROR from the claim without collapsing it into a token verdict", async () => {
    customerUserRepo.claimPasswordReset.mockResolvedValue(err("INTERNAL_ERROR"));

    const result = await useCase.execute({
      token: "valid-token",
      newPassword: "newsecurepass",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "INTERNAL_ERROR");
  });

  it("reaches the row with exactly ONE write, carrying a hash of the new password", async () => {
    const result = await useCase.execute({
      token: "valid-token",
      newPassword: "newsecurepass",
    });

    assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
    expect(customerUserRepo.claimPasswordReset).toHaveBeenCalledTimes(1);
    // The prohibition is on the flow's SHAPE, not only on its outcome: a second
    // write after the claim can revert the hash the claim just stored, which is
    // the defect this flow exists to retire. The snapshot writers themselves are
    // no longer named here because they no longer exist on the port or the
    // adapter — there is nothing left to call, exactly as with the token READ
    // that used to precede the write. What remains assertable, and what this
    // pins, is that NO other write command follows the claim.
    for (const command of [
      "create",
      "recordLogin",
      "upgradePasswordHash",
      "changeRole",
      "deactivate",
      "issueResetToken",
      "delete",
    ] as const) {
      expect(
        customerUserRepo[command],
        `${command} must not follow the claim`
      ).not.toHaveBeenCalled();
    }

    const [claimedToken, claimedHash] = customerUserRepo.claimPasswordReset.mock.calls[0] as [
      string,
      string,
    ];
    assert.strictEqual(claimedToken, "valid-token");
    assert.strictEqual(
      await argon2.verify(claimedHash, "newsecurepass"),
      true,
      "the claim must carry a hash of the NEW password"
    );
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
