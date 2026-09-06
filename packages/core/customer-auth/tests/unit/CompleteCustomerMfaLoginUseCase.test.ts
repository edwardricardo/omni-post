/**
 * @file CompleteCustomerMfaLoginUseCase.test.ts
 * @description Unit tests for customer login step 2. Fake ports throughout; the
 *   challenge store is a real in-memory allowlist so the single-use / concurrency
 *   anchors exercise the actual atomic-consume semantics.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import { CompleteCustomerMfaLoginUseCase } from "../../src/CompleteCustomerMfaLoginUseCase.js";
import { sha256Hex } from "../../src/challengeBinding.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountRepositoryPort } from "@core/domain/repositories/AccountRepository.js";
import type { CustomerTokenService } from "@core/domain/repositories/CustomerTokenService.js";
import type {
  BruteForceProtectionPort,
  MfaChallengeStorePort,
  MfaVerificationPort,
} from "@ports/core";

const ACCOUNT_ID = "a2000000-0000-4000-8000-000000000002";
const USER_ID = "u2000000-0000-4000-8000-000000000002";
const EMAIL = "mfa-user@example.com";
const JTI = "0123456789abcdef0123456789abcdef";
const IP = "203.0.113.9";
const UA = "test-agent/9.0";

function makeClaims(overrides?: Record<string, unknown>) {
  return {
    sub: USER_ID,
    accountId: ACCOUNT_ID,
    jti: JTI,
    iph: sha256Hex(IP),
    uah: sha256Hex(UA),
    ...overrides,
  };
}

function makeUser(overrides?: Record<string, unknown>) {
  return {
    id: USER_ID,
    accountId: ACCOUNT_ID,
    email: EMAIL,
    roleId: "r1",
    roleName: "OWNER",
    permissions: ["posts.read"],
    isActive: true,
    mfaEnabled: true,
    recordLogin: vi.fn(),
    toJSON: vi.fn(() => ({ id: USER_ID, email: EMAIL })),
    ...overrides,
  };
}

function makeUserRepo(userFactory: () => ReturnType<typeof makeUser>): CustomerUserRepository {
  return {
    findById: vi.fn(async () => ok(userFactory())),
    save: vi.fn(async () => ok(undefined)),
  } as unknown as CustomerUserRepository;
}

function makeAccountRepo(): AccountRepositoryPort {
  return {
    findById: vi.fn(async () => ok({ toJSON: () => ({ id: ACCOUNT_ID }) })),
  } as unknown as AccountRepositoryPort;
}

function makeTokenService(
  claimsResult: Result<ReturnType<typeof makeClaims>, "INVALID_TOKEN"> = ok(makeClaims())
): CustomerTokenService {
  return {
    verifyMfaChallengeToken: vi.fn(() => claimsResult),
    signAccessToken: vi.fn(() => "dummy-access-token"),
    signRefreshToken: vi.fn(() => "dummy-refresh-token"),
  } as unknown as CustomerTokenService;
}

function makeMfaVerification(
  result: Result<{ verified: boolean; usedBackupCode: boolean }, string> = ok({
    verified: true,
    usedBackupCode: false,
  })
): MfaVerificationPort {
  return {
    verifyMfaToken: vi.fn(async () => result),
  } as unknown as MfaVerificationPort;
}

function makeBruteForce(allowed = true): BruteForceProtectionPort {
  return {
    checkLoginAttempt: vi.fn(async () => ({ allowed, delaySeconds: 0, captchaRequired: false })),
    recordFailedAttempt: vi.fn(async () => undefined),
    recordSuccessfulAttempt: vi.fn(async () => undefined),
  } as unknown as BruteForceProtectionPort;
}

/** Real in-memory allowlist store — atomic consume by Set.delete semantics. */
function makeStore(seeded: string[] = [JTI]): MfaChallengeStorePort {
  const set = new Set(seeded);
  return {
    issue: vi.fn(async (jti: string) => {
      set.add(jti);
      return ok(undefined);
    }),
    consume: vi.fn(async (jti: string) => (set.delete(jti) ? ok("CONSUMED") : ok("NOT_FOUND"))),
  } as unknown as MfaChallengeStorePort;
}

function makeUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
  };
}

const INPUT_BASE = { challengeToken: "challenge-jwt", code: "123456", ip: IP, userAgent: UA };

describe("CompleteCustomerMfaLoginUseCase", () => {
  let userRepo: CustomerUserRepository;
  let accountRepo: AccountRepositoryPort;
  let tokenService: CustomerTokenService;
  let mfaVerification: MfaVerificationPort;
  let bruteForce: BruteForceProtectionPort;
  let store: MfaChallengeStorePort;
  let uow: ReturnType<typeof makeUnitOfWork>;

  function build(): CompleteCustomerMfaLoginUseCase {
    return new CompleteCustomerMfaLoginUseCase(
      userRepo,
      accountRepo,
      mfaVerification,
      tokenService,
      store,
      bruteForce,
      uow
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    userRepo = makeUserRepo(() => makeUser());
    accountRepo = makeAccountRepo();
    tokenService = makeTokenService();
    mfaVerification = makeMfaVerification();
    bruteForce = makeBruteForce();
    store = makeStore();
    uow = makeUnitOfWork();
  });

  describe("happy path", () => {
    it("mints a session on a valid TOTP challenge", async () => {
      const result = await build().execute(INPUT_BASE);

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error : ""}`);
      assert.strictEqual(typeof result.value.accessToken, "string");
      assert.strictEqual(typeof result.value.refreshToken, "string");
      expect(store.consume).toHaveBeenCalledWith(JTI);
      expect(userRepo.save).toHaveBeenCalledTimes(1);
      expect(uow.executeInTransaction).toHaveBeenCalledTimes(1);
    });

    it("mints a session on a valid backup code", async () => {
      mfaVerification = makeMfaVerification(ok({ verified: true, usedBackupCode: true }));
      const result = await build().execute(INPUT_BASE);
      assert.ok(result.ok);
      assert.strictEqual(typeof result.value.accessToken, "string");
    });

    it("records BF success only AFTER the MFA code verifies (post-MFA)", async () => {
      await build().execute(INPUT_BASE);
      expect(bruteForce.recordSuccessfulAttempt).toHaveBeenCalledTimes(1);
      expect(bruteForce.recordSuccessfulAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ identifier: EMAIL })
      );
    });
  });

  describe("account liveness gate — soft-deleted account", () => {
    it("returns ACCOUNT_DEACTIVATED, mints nothing, and does NOT burn the challenge when the account was soft-deleted between the two steps", async () => {
      // Mock-fidelity note: PrismaAccountRepository.findById is a
      // `findFirst({ where: { id, deletedAt: null } })`, so an account
      // soft-deleted after step 1 issued the challenge surfaces here as
      // err(EntityNotFoundError) — exactly what this mock returns.
      accountRepo = {
        findById: vi.fn(async () => err(new Error("Account not found"))),
      } as unknown as AccountRepositoryPort;

      const result = await build().execute(INPUT_BASE);

      assert.ok(!result.ok, "a deleted account must not complete an MFA login");
      assert.strictEqual(result.error, "ACCOUNT_DEACTIVATED");
      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
      expect(tokenService.signRefreshToken).not.toHaveBeenCalled();
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();
      // Mirrors USER_INACTIVE: the block is an account-state verdict, not a
      // legitimate attempt to spend the challenge.
      expect(store.consume).not.toHaveBeenCalled();
    });
  });

  describe("single-use under concurrency", () => {
    it("mints exactly ONE session for two concurrent valid step-2 requests", async () => {
      // Shared store + shared instance; both requests verify then race on consume.
      const useCase = build();
      const [a, b] = await Promise.all([useCase.execute(INPUT_BASE), useCase.execute(INPUT_BASE)]);

      const winners = [a, b].filter((r) => r.ok);
      const losers = [a, b].filter((r) => !r.ok);
      assert.strictEqual(winners.length, 1, "exactly one session minted");
      assert.strictEqual(losers.length, 1);
      const loser = losers[0]!;
      assert.ok(!loser.ok);
      assert.strictEqual(loser.error, "INVALID_CHALLENGE");
    });
  });

  describe("wrong code", () => {
    it("does NOT consume the challenge, records MFA_FAILED, and a retry succeeds", async () => {
      // First attempt: wrong code.
      mfaVerification = makeMfaVerification(err("INVALID_TOKEN"));
      const first = await build().execute(INPUT_BASE);
      assert.ok(!first.ok);
      assert.strictEqual(first.error, "INVALID_MFA_CODE");
      expect(bruteForce.recordFailedAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ failureReason: "MFA_FAILED" })
      );
      expect(store.consume).not.toHaveBeenCalled();
      expect(bruteForce.recordSuccessfulAttempt).not.toHaveBeenCalled();

      // Retry with a correct code against the SAME (unconsumed) store succeeds.
      mfaVerification = makeMfaVerification(ok({ verified: true, usedBackupCode: false }));
      const second = await build().execute(INPUT_BASE);
      assert.ok(second.ok, `Expected ok on retry, got: ${!second.ok ? second.error : ""}`);
    });
  });

  describe("anti-oracle challenge failures", () => {
    it("returns INVALID_CHALLENGE when the challenge token fails to verify", async () => {
      tokenService = makeTokenService(err("INVALID_TOKEN"));
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "INVALID_CHALLENGE");
      expect(store.consume).not.toHaveBeenCalled();
    });

    it("returns INVALID_CHALLENGE when the jti was already consumed", async () => {
      store = makeStore([]); // jti absent → consume returns NOT_FOUND
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "INVALID_CHALLENGE");
    });

    it("returns CHALLENGE_BINDING_MISMATCH on an IP/UA binding mismatch (route collapses to 401)", async () => {
      const result = await build().execute({ ...INPUT_BASE, ip: "198.51.100.200" });
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "CHALLENGE_BINDING_MISMATCH");
      expect(store.consume).not.toHaveBeenCalled();
    });

    it("returns INVALID_CHALLENGE — byte-identical to expiry — when the challenge's accountId does not match the loaded user's account, and does NOT consume the jti", async () => {
      // The challenge claims a DIFFERENT account than the row `sub` resolves to
      // (defense-in-depth per design Decision 7 — not reachable via a forged
      // token since the JWT is HMAC-signed, but the invariant must be enforced,
      // not merely assumed).
      tokenService = makeTokenService(
        ok(makeClaims({ accountId: "a9999999-0000-4000-8000-000000000099" }))
      );

      const mismatched = await build().execute(INPUT_BASE);
      assert.ok(!mismatched.ok);
      assert.strictEqual(mismatched.error, "INVALID_CHALLENGE");
      expect(store.consume).not.toHaveBeenCalled();

      // Same outcome as an expired/invalid-signature challenge — byte-identical,
      // so the response carries no tenant oracle.
      tokenService = makeTokenService(err("INVALID_TOKEN"));
      const expired = await build().execute(INPUT_BASE);
      assert.ok(!expired.ok);
      assert.strictEqual(expired.error, mismatched.error);
    });
  });

  describe("fail-closed + row state", () => {
    it("returns MFA_UNAVAILABLE when the consume store errors", async () => {
      store = {
        issue: vi.fn(async () => ok(undefined)),
        consume: vi.fn(async () => err("STORE_ERROR")),
      } as unknown as MfaChallengeStorePort;
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "MFA_UNAVAILABLE");
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it("returns USER_INACTIVE when the row was deactivated between steps", async () => {
      userRepo = makeUserRepo(() => makeUser({ isActive: false }));
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "USER_INACTIVE");
    });

    it("returns INVALID_CHALLENGE when MFA was disabled between steps", async () => {
      userRepo = makeUserRepo(() => makeUser({ mfaEnabled: false }));
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "INVALID_CHALLENGE");
    });

    it("returns RATE_LIMITED when the BF gate denies the attempt", async () => {
      bruteForce = makeBruteForce(false);
      const result = await build().execute(INPUT_BASE);
      assert.ok(!result.ok);
      assert.strictEqual(result.error, "RATE_LIMITED");
    });
  });
});
