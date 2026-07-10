/**
 * @file LoginCustomerUseCase.test.ts
 * @description Unit tests for LoginCustomerUseCase.
 *   Tier 3 — mocks CustomerUserRepository, AccountRepositoryPort, PasswordHasher,
 *   CustomerTokenService, BruteForceProtectionPort, and MfaChallengeStorePort.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { LoginCustomerUseCase } from "../../src/LoginCustomerUseCase.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type { BruteForceProtectionPort, MfaChallengeStorePort } from "@ports/core";

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
    mfaEnabled: false,
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
    signMfaChallengeToken: vi.fn(() => "dummy-challenge-token"),
    verifyMfaChallengeToken: vi.fn(),
  } as unknown as CustomerTokenService;
}

function makeBruteForce(allowed = true): BruteForceProtectionPort {
  return {
    checkLoginAttempt: vi.fn(async () => ({ allowed, delaySeconds: 0, captchaRequired: false })),
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
  } as unknown as BruteForceProtectionPort;
}

function makeChallengeStore(issueOk = true): MfaChallengeStorePort {
  return {
    issue: vi.fn(async () => (issueOk ? ok(undefined) : err("STORE_ERROR"))),
    consume: vi.fn(async () => ok("CONSUMED")),
  } as unknown as MfaChallengeStorePort;
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
  let challengeStore: ReturnType<typeof makeChallengeStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    const user = makeUser();
    userRepo = makeUserRepo([user]);
    accountRepo = makeAccountRepo();
    hasher = makeHasher(true);
    tokenService = makeTokenService();
    bruteForce = makeBruteForce(true);
    challengeStore = makeChallengeStore(true);
  });

  describe("happy path — successful login", () => {
    it("returns ok with accessToken and refreshToken when credentials are valid", async () => {
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce,
        challengeStore
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(result.ok, `Expected ok, got error: ${!result.ok ? result.error : ""}`);
      assert.ok("accessToken" in result.value);
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
        bruteForce,
        challengeStore
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
        bruteForce,
        challengeStore
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
        blockedBruteForce,
        challengeStore
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
        bruteForce,
        challengeStore
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "USER_INACTIVE");
    });
  });

  describe("MFA-enabled customer — challenge branch (no session pre-MFA)", () => {
    it("returns a challenge (not tokens) when the user has MFA enabled", async () => {
      const mfaUser = makeUser({ mfaEnabled: true });
      const mfaRepo = makeUserRepo([mfaUser]);
      const useCase = new LoginCustomerUseCase(
        mfaRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce,
        challengeStore
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(result.ok, `Expected ok, got error: ${!result.ok ? result.error : ""}`);
      assert.ok("mfaRequired" in result.value, "expected a challenge output");
      assert.strictEqual(result.value.mfaRequired, true);
      assert.strictEqual(typeof result.value.challengeToken, "string");
      assert.ok(result.value.challengeToken.length > 0);
      assert.strictEqual(result.value.expiresInSeconds, 180);
      assert.deepStrictEqual([...result.value.methods], ["totp", "backup_code"]);
    });

    it("performs NO recordLogin/save/recordSuccessfulAttempt/mint on the MFA branch", async () => {
      const mfaUser = makeUser({ mfaEnabled: true });
      const mfaRepo = makeUserRepo([mfaUser]);
      const useCase = new LoginCustomerUseCase(
        mfaRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce,
        challengeStore
      );

      await useCase.execute(INPUT_BASE);

      expect(mfaUser.recordLogin).not.toHaveBeenCalled();
      expect(mfaRepo.save).not.toHaveBeenCalled();
      expect(bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      expect(tokenService.signRefreshToken).not.toHaveBeenCalled();
      // Challenge issued with the store TTL.
      expect(challengeStore.issue).toHaveBeenCalledTimes(1);
      expect(challengeStore.issue).toHaveBeenCalledWith(expect.any(String), 180);
    });

    it("returns MFA_UNAVAILABLE (fail-closed) when the challenge store issue fails", async () => {
      const mfaUser = makeUser({ mfaEnabled: true });
      const mfaRepo = makeUserRepo([mfaUser]);
      const failingStore = makeChallengeStore(false);
      const useCase = new LoginCustomerUseCase(
        mfaRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce,
        failingStore
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(!result.ok);
      assert.strictEqual(result.error, "MFA_UNAVAILABLE");
      expect(tokenService.signMfaChallengeToken).not.toHaveBeenCalled();
    });

    it("mints tokens unchanged for a customer WITHOUT MFA (never touches the store)", async () => {
      const useCase = new LoginCustomerUseCase(
        userRepo,
        accountRepo,
        hasher,
        tokenService,
        bruteForce,
        challengeStore
      );

      const result = await useCase.execute(INPUT_BASE);

      assert.ok(result.ok);
      assert.ok("accessToken" in result.value);
      expect(challengeStore.issue).not.toHaveBeenCalled();
      expect(bruteForce.recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
    });
  });
});
