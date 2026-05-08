/**
 * @file ChangeAccountSubscriptionUseCase.ts
 * @description Changes an existing AccountSubscription: switch between bundle
 *              and custom provider plans, update providers, or flag for
 *              cancellation at period end. Creates price history when the
 *              monthly amount changes.
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

export interface ChangeSubscriptionInput {
  accountId: string;
  bundleId?: string | null;
  providers?: string[];
  cancelAtPeriodEnd?: boolean;
}

export interface ChangeSubscriptionOutput {
  subscriptionId: string;
  previousPrice: number;
  newPrice: number;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface ChangeSubscriptionRepository {
  /** @description Load existing subscription with its bundle */
  findSubscriptionByAccountId(accountId: string): Promise<{
    id: string;
    bundleId: string | null;
    providers: string[];
    accountCount: number;
    pricePerMonth: number;
    maxProjects: number;
    status: string;
    cancelAtPeriodEnd: boolean;
    bundle: {
      id: string;
      providers: string[];
      pricePerAccountMonth: number;
    } | null;
  } | null>;

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

  /** @description Create a price history record */
  createPriceHistory(params: {
    subscriptionId: string;
    previousPrice: number;
    newPrice: number;
    reason: string;
    effectiveAt: Date;
  }): Promise<void>;

  /** @description Update subscription fields */
  updateSubscription(
    subscriptionId: string,
    params: {
      bundleId?: string | null;
      providers?: string[];
      pricePerMonth?: number;
      maxProjects?: number;
      cancelAtPeriodEnd?: boolean;
    }
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Use Case
// ---------------------------------------------------------------------------

export class ChangeAccountSubscriptionUseCase implements UseCase<
  ChangeSubscriptionInput,
  ChangeSubscriptionOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: ChangeSubscriptionRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Changes plan or cancellation flag for an existing subscription.
   *              Records price history when amount changes.
   * @param input - Change parameters (bundle, custom providers, or cancel flag)
   * @returns Result with previous/new price, or UseCaseError on failure
   */
  async execute(
    input: ChangeSubscriptionInput
  ): Promise<Result<ChangeSubscriptionOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<ChangeSubscriptionOutput, UseCaseError>> => {
      // 1. Load existing subscription
      const subscription = await this.repo.findSubscriptionByAccountId(input.accountId);
      if (!subscription) {
        return err(
          new UseCaseError("Subscription not found for this account", USE_CASE_ERRORS.NOT_FOUND)
        );
      }

      const previousPrice = Number(subscription.pricePerMonth);
      let newPrice = previousPrice;
      let newProviders: string[] | undefined;
      let newMaxProjects: number | undefined;
      let newBundleId: string | null | undefined;

      // 3. Calculate new price based on input
      if (input.bundleId !== undefined) {
        if (input.bundleId === null) {
          // Switch to custom plan
          if (input.providers && input.providers.length > 0) {
            const providerTiers = await this.repo.findProviderPricingTiers();
            const accountTiers = await this.repo.findAccountPricingTiers();

            const customResult = PricingCalculator.calculateCustomPrice(
              input.providers.length,
              subscription.accountCount,
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

            newPrice = customResult.value.total;
            newProviders = input.providers;
            newMaxProjects = input.providers.length * 3;
            newBundleId = null;
          } else {
            // Removing bundle without providing providers
            newPrice = 0;
            newProviders = [];
            newMaxProjects = 3;
            newBundleId = null;
          }
        } else {
          // Switch to a bundle
          const bundle = await this.repo.findBundle(input.bundleId);
          if (!bundle) {
            return err(new UseCaseError("Provider bundle not found", USE_CASE_ERRORS.NOT_FOUND));
          }

          const accountTiers = await this.repo.findAccountPricingTiers();
          const bundleResult = PricingCalculator.calculateBundlePrice(
            bundle.pricePerAccountMonth,
            subscription.accountCount,
            accountTiers
          );
          if (!bundleResult.ok) {
            return err(
              new UseCaseError(
                bundleResult.error.message,
                USE_CASE_ERRORS.INTERNAL_ERROR,
                bundleResult.error
              )
            );
          }

          newPrice = bundleResult.value.total;
          newProviders = bundle.providers;
          newMaxProjects = bundle.providers.length * 3;
          newBundleId = bundle.id;
        }
      } else if (input.providers && input.providers.length > 0) {
        // Update custom providers without changing bundle flag
        const providerTiers = await this.repo.findProviderPricingTiers();
        const accountTiers = await this.repo.findAccountPricingTiers();

        const customResult = PricingCalculator.calculateCustomPrice(
          input.providers.length,
          subscription.accountCount,
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

        newPrice = customResult.value.total;
        newProviders = input.providers;
        newMaxProjects = input.providers.length * 3;
      }

      // 4. Record price history if price changed
      if (newPrice !== previousPrice) {
        await this.repo.createPriceHistory({
          subscriptionId: subscription.id,
          previousPrice,
          newPrice,
          reason: "plan_change",
          effectiveAt: new Date(),
        });
      }

      // 5. Update subscription with conditional spreading
      const updateParams: {
        bundleId?: string | null;
        providers?: string[];
        pricePerMonth?: number;
        maxProjects?: number;
        cancelAtPeriodEnd?: boolean;
      } = {
        ...(newBundleId !== undefined && { bundleId: newBundleId }),
        ...(newProviders !== undefined && { providers: newProviders }),
        ...(newPrice !== previousPrice && { pricePerMonth: newPrice }),
        ...(newMaxProjects !== undefined && { maxProjects: newMaxProjects }),
        ...(input.cancelAtPeriodEnd !== undefined && {
          cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        }),
      };

      await this.repo.updateSubscription(subscription.id, updateParams);

      // 6. Return result
      return ok({
        subscriptionId: subscription.id,
        previousPrice,
        newPrice,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<ChangeSubscriptionOutput, UseCaseError> = ok({
          subscriptionId: "",
          previousPrice: 0,
          newPrice: 0,
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
          "Failed to change account subscription",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
