/**
 * @file LoginCustomerUseCase.test.ts
 * @description Unit tests for LoginCustomerUseCase.
 *   Tier 3 — mocks CustomerUserRepository, AccountRepositoryPort, PasswordHasher,
 *   CustomerTokenService, and BruteForceProtectionPort.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { LoginCustomerUseCase } from "../../src/LoginCustomerUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { BruteForceProtectionPort } from "@ports/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const USER_ID = "u1000000-0000-4000-8000-000000000001";
const HASH = "dummy-hash-for-test";

function makeUser(overrides?: Record<string, unknown>) {
  return {
    id: USER_ID,
    accountId: ACCOUNT_ID,
    email: "user@example.com",
    passwordHash: HASH,
    roleId: "r1",
    roleName: "admin",
    permissions: ["posts.read"],
    isActive: true,
    recordLogin: vi.fn(),
    toJSON: vi.fn(() => ({ id: USER_ID, email: "user@example.com" })),
    ...overrides,
  };
}

function makeUserRepo(users: ReturnType<typeof makeUser>[]): CustomerUserRepository {
  return {
    findByEmailAcrossAccounts: vi.fn(async () => users),
    findById: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    updatePasswordHash: vi.fn(async () => undefined),
  } as unknown as CustomerUserRepository;
}

function makeAccountRepo(): AccountRepositoryPort {
  return {
    findById: vi.fn(async () => ({
      ok: true,
      value: { slug: "test-account", toJSON: () => ({ id: ACCOUNT_ID }) },
    })),
    findBySlug: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
  } as unknown as AccountRepositoryPort;
}

function makeHasher(valid = true): PasswordHasher {
  return {
    hash: vi.fn(async () => "new-hash"),
    verify: vi.fn(async () => valid),
    needsRehash: vi.fn(() => false),
  } as unknown as PasswordHasher;
}

function makeTokenService(): CustomerTokenService {
  return {
    signAccessToken: vi.fn(() => "dummy-access-token"),
    signRefreshToken: vi.fn(() => "dummy-refresh-token"),
  } as unknown as CustomerTokenService;
}

function makeBruteForce(allowed = true): BruteForceProtectionPort {
  return {
    checkLoginAttempt: vi.fn(async () => ({ allowed, delaySeconds: 0, captchaRequired: false })),
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
  } as unknown as BruteForceProtectionPort;
}

const INPUT_BASE = {
  email: "user@example.com",
  password: "valid-password-123",
  ip: "127.0.0.1",
  userAgent: "test-agent/1.0",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LoginCustomerUseCase", () => {
  let userRepo: ReturnType<typeof makeUserRepo>;
  let accountRepo: ReturnType<typeof makeAccountRepo>;
  let hasher: ReturnType<typeof makeHasher>;
  let tokenService: ReturnType<typeof makeTokenService>;
  let bruteForce: ReturnType<typeof makeBruteForce>;

  beforeEach(() => {
    vi.clearAllMocks();
    const user = makeUser();
    userRepo = makeUserRepo([user]);
    accountRepo = makeAccountRepo();
    hasher = makeHasher(true);
    tokenService = makeTokenService();
    bruteForce = makeBruteForce(true);
  });

  describe("happy path — successful login", () => {
    it("returns ok with accessToken and refreshToken when credentials are valid", async () => {
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(result.ok, `Expected ok, got error: ${!result.ok ? result.error : ""}`);
      assert.strictEqual(typeof result.value.accessToken, "string");
      assert.ok(result.value.accessToken.length > 0);
      assert.strictEqual(typeof result.value.refreshToken, "string");
    });
  });

  describe("invalid credentials — wrong password", () => {
    it("returns INVALID_CREDENTIALS error when password hash does not match", async () => {
      const wrongPassHasher = makeHasher(false);
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        wrongPassHasher,
        tokenService,
        bruteForce
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "INVALID_CREDENTIALS");
    });
  });

  describe("invalid credentials — empty email", () => {
    it("returns INVALID_CREDENTIALS when email is empty string", async () => {
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce
      );

      const result = await useCase.execute({ ...INPUT_BASE, email: "" });

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "INVALID_CREDENTIALS");
    });
  });

  describe("rate limited", () => {
    it("returns RATE_LIMITED when brute force gate denies the attempt", async () => {
      const blockedBruteForce = makeBruteForce(false);
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        hasher,
        tokenService,
        blockedBruteForce
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "RATE_LIMITED");
    });
  });

  describe("user inactive", () => {
    it("returns USER_INACTIVE when user account is disabled", async () => {
      const inactiveUser = makeUser({ isActive: false });
      const inactiveUserRepo = makeUserRepo([inactiveUser]);
      const useCase = new LoginCustomerUseCase(
        inactiveUserRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "USER_INACTIVE");
    });
  });
});
