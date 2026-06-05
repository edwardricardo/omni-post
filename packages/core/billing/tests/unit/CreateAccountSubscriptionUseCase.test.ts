/**
 * @file CreateAccountSubscriptionUseCase.test.ts
 * @description Unit tests for CreateAccountSubscriptionUseCase and ChangeAccountSubscriptionUseCase.
 *   Tier 3 — mocks the CreateSubscriptionRepository / ChangeSubscriptionRepository port boundaries.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { CreateAccountSubscriptionUseCase } from "../../src/CreateAccountSubscriptionUseCase.js";
import { ChangeAccountSubscriptionUseCase } from "../../src/ChangeAccountSubscriptionUseCase.js";
import type { CreateSubscriptionRepository } from "../../src/CreateAccountSubscriptionUseCase.js";
import type { ChangeSubscriptionRepository } from "../../src/ChangeAccountSubscriptionUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const SUB_ID = "s1000000-0000-4000-8000-000000000001";
const BUNDLE_ID = "b1000000-0000-4000-8000-000000000001";

function makeCreateRepo(
  overrides?: Partial<CreateSubscriptionRepository>
): CreateSubscriptionRepository {
  return {
    findAccount: vi.fn(async () => ({ id: ACCOUNT_ID })),
    findSubscriptionByAccountId: vi.fn(async () => null),
    findBundle: vi.fn(async () => null),
    findProviderPricingTiers: vi.fn(async () => [
      { count: 0, pricePerMonth: 0 },
      { count: 3, pricePerMonth: 29 },
    ]),
    findAccountPricingTiers: vi.fn(async () => [
      { count: 0, pricePerMonth: 0 },
      { count: 10, pricePerMonth: 199 },
    ]),
    createSubscription: vi.fn(async () => SUB_ID),
    ...overrides,
  };
}

function makeChangeRepo(
  overrides?: Partial<ChangeSubscriptionRepository>
): ChangeSubscriptionRepository {
  return {
    findSubscriptionByAccountId: vi.fn(async () => ({
      id: SUB_ID,
      bundleId: null,
      providers: ["INSTAGRAM"],
      accountCount: 1,
      pricePerMonth: 29,
      maxProjects: 3,
      status: "ACTIVE",
      cancelAtPeriodEnd: false,
      bundle: null,
    })),
    findBundle: vi.fn(async () => null),
    findProviderPricingTiers: vi.fn(async () => [
      { count: 0, pricePerMonth: 0 },
      { count: 3, pricePerMonth: 29 },
    ]),
    findAccountPricingTiers: vi.fn(async () => [
      { count: 0, pricePerMonth: 0 },
      { count: 10, pricePerMonth: 199 },
    ]),
    createPriceHistory: vi.fn(async () => undefined),
    updateSubscription: vi.fn(async () => undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CreateAccountSubscriptionUseCase
// ---------------------------------------------------------------------------

describe("CreateAccountSubscriptionUseCase", () => {
  let repo: ReturnType<typeof makeCreateRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeCreateRepo();
  });

  describe("happy path — default trial", () => {
    it("returns ok with subscriptionId when account exists and has no subscription", async () => {
      const useCase = new CreateAccountSubscriptionUseCase(repo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.subscriptionId, SUB_ID);
    });
  });

  describe("conflict — already subscribed", () => {
    it("returns CONFLICT error when account already has a subscription", async () => {
      const conflictRepo = makeCreateRepo({
        findSubscriptionByAccountId: vi.fn(async () => ({ id: SUB_ID })),
      });
      const useCase = new CreateAccountSubscriptionUseCase(conflictRepo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.CONFLICT);
    });
  });

  describe("not found — account missing", () => {
    it("returns NOT_FOUND error when account does not exist", async () => {
      const notFoundRepo = makeCreateRepo({
        findAccount: vi.fn(async () => null),
      });
      const useCase = new CreateAccountSubscriptionUseCase(notFoundRepo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("bundle not found", () => {
    it("returns NOT_FOUND when bundleId provided but bundle does not exist", async () => {
      const useCase = new CreateAccountSubscriptionUseCase(repo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID, bundleId: BUNDLE_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});

// ---------------------------------------------------------------------------
// ChangeAccountSubscriptionUseCase
// ---------------------------------------------------------------------------

describe("ChangeAccountSubscriptionUseCase", () => {
  let repo: ReturnType<typeof makeChangeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeChangeRepo();
  });

  describe("happy path — cancel at period end", () => {
    it("returns ok with subscription ids and price info when subscription exists", async () => {
      const useCase = new ChangeAccountSubscriptionUseCase(repo);

      const result = await useCase.execute({
        accountId: ACCOUNT_ID,
        cancelAtPeriodEnd: true,
      });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.subscriptionId, SUB_ID);
    });
  });

  describe("not found — no subscription", () => {
    it("returns NOT_FOUND when account has no subscription", async () => {
      const notFoundRepo = makeChangeRepo({
        findSubscriptionByAccountId: vi.fn(async () => null),
      });
      const useCase = new ChangeAccountSubscriptionUseCase(notFoundRepo);

      const result = await useCase.execute({ accountId: ACCOUNT_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("bundle switch — bundle not found", () => {
    it("returns NOT_FOUND when switching to a bundle that does not exist", async () => {
      const useCase = new ChangeAccountSubscriptionUseCase(repo);

      const result = await useCase.execute({
        accountId: ACCOUNT_ID,
        bundleId: BUNDLE_ID,
      });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });
});
