/**
 * @file CreateAccountSubscriptionUseCase.ts
 * @description Creates an AccountSubscription for a new account.
 *              Called during registration or when starting a trial.
 *              Supports bundle selection, custom provider selection, or default trial.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  PricingCalculator,
  type ProviderTier,
  type AccountTier,
} from "../../domain/billing/PricingCalculator.js";

// ---------------------------------------------------------------------------
// Input / Output
// ---------------------------------------------------------------------------

export interface CreateSubscriptionInput {
  accountId: string;
  bundleId?: string;
  providers?: string[];
  startTrial?: boolean;
  trialDays?: number;
}

export interface CreateSubscriptionOutput {
  subscriptionId: string;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface CreateSubscriptionRepository {
  /** @description Check whether account exists */
  findAccount(accountId: string): Promise<{ id: string } | null>;

  /** @description Check whether a subscription already exists for the account */
  findSubscriptionByAccountId(accountId: string): Promise<{ id: string } | null>;

  /** @description Load a provider bundle by id */
  findBundle(bundleId: string): Promise<{
    id: string;
    providers: string[];
    pricePerAccountMonth: number;
    isActive: boolean;
  } | null>;

  /** @description Load active provider pricing tiers */
  findProviderPricingTiers(): Promise<ProviderTier[]>;

  /** @description Load active account pricing tiers */
  findAccountPricingTiers(): Promise<AccountTier[]>;

  /** @description Persist a new AccountSubscription and return its id */
  createSubscription(params: {
    accountId: string;
    bundleId?: string;
    providers: string[];
    pricePerMonth: number;
    maxProjects: number;
    status: string;
    trialEndsAt?: Date;
  }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

const DEFAULT_TRIAL_DAYS = 14;

export class CreateAccountSubscriptionUseCase implements UseCase<
  CreateSubscriptionInput,
  CreateSubscriptionOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: CreateSubscriptionRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Creates an AccountSubscription. Supports three modes:
   *   1. Bundle-based (bundleId provided)
   *   2. Custom providers (providers[] provided)
   *   3. Default trial (neither)
   * @param input - Subscription creation parameters
   * @returns Result<CreateSubscriptionOutput> on success, UseCaseError on failure
   */
  async execute(
    input: CreateSubscriptionInput
  ): Promise<Result<CreateSubscriptionOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<CreateSubscriptionOutput, UseCaseError>> => {
      // 1. Verify account exists
      const account = await this.repo.findAccount(input.accountId);
      if (!account) {
        return err(new UseCaseError("Account not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      // 2. Check no existing subscription
      const existing = await this.repo.findSubscriptionByAccountId(input.accountId);
      if (existing) {
        return err(
          new UseCaseError("Account already has a subscription", USE_CASE_ERRORS.CONFLICT)
        );
      }

      // Determine subscription parameters
      let providers: string[] = [];
      let pricePerMonth = 0;
      let maxProjects = 3;
      let status = "TRIALING";
      let bundleId: string | undefined;

      // 3. Bundle-based subscription
      if (input.bundleId) {
        const bundle = await this.repo.findBundle(input.bundleId);
        if (!bundle) {
          return err(new UseCaseError("Provider bundle not found", USE_CASE_ERRORS.NOT_FOUND));
        }

        bundleId = bundle.id;
        providers = bundle.providers;
        pricePerMonth = bundle.pricePerAccountMonth;
        maxProjects = bundle.providers.length * 3;
        status = input.startTrial === false ? "ACTIVE" : "TRIALING";
      }
      // 4. Custom provider selection
      else if (input.providers && input.providers.length > 0) {
        const providerTiers = await this.repo.findProviderPricingTiers();
        const accountTiers = await this.repo.findAccountPricingTiers();

        const customResult = PricingCalculator.calculateCustomPrice(
          input.providers.length,
          1,
          providerTiers,
          accountTiers
        );
        if (!customResult.ok) {
          return err(
            new UseCaseError(
              customResult.error.message,
              USE_CASE_ERRORS.INTERNAL_ERROR,
              customResult.error
            )
          );
        }

        providers = input.providers;
        pricePerMonth = customResult.value.total;
        maxProjects = input.providers.length * 3;
        status = input.startTrial === false ? "ACTIVE" : "TRIALING";
      }
      // 5. Default trial (no bundle, no providers)
      else {
        providers = [];
        pricePerMonth = 0;
        maxProjects = 3;
        status = "TRIALING";
      }

      // Calculate trial end date
      const trialDays = input.trialDays ?? DEFAULT_TRIAL_DAYS;
      const trialEndsAt =
        status === "TRIALING" ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : undefined;

      // 6. Create subscription
      const subscriptionId = await this.repo.createSubscription({
        accountId: input.accountId,
        providers,
        pricePerMonth,
        maxProjects,
        status,
        ...(bundleId !== undefined && { bundleId }),
        ...(trialEndsAt !== undefined && { trialEndsAt }),
      });

      // 7. Return result
      return ok({ subscriptionId });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateSubscriptionOutput, UseCaseError> = ok({
          subscriptionId: "",
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create account subscription",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
