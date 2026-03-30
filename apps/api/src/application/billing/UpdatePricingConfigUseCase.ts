/**
 * @file UpdatePricingConfigUseCase.ts
 * @description Updates a pricing configuration entity (tier or bundle) and
 *              grandfathers existing active subscriptions. Creates price history
 *              records and sets affected subscriptions to GRANDFATHERED status
 *              during a configurable notification window.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface UpdatePricingConfigInput {
  adminRole: string;
  entityType: "provider_tier" | "account_tier" | "bundle";
  entityId: string;
  field: string;
  newValue: number;
  notificationWindowDays: number;
}

export interface UpdatePricingConfigOutput {
  affectedSubscriptions: number;
  effectiveAt: Date;
}

export interface PricingConfigRepository {
  updateEntity(entityType: string, entityId: string, field: string, value: number): Promise<void>;
  findAffectedSubscriptions(
    entityType: string,
    entityId: string
  ): Promise<Array<{ id: string; pricePerMonth: number }>>;
  setSubscriptionStatus(subscriptionId: string, status: string): Promise<void>;
  createPriceHistory(params: {
    subscriptionId: string;
    previousPrice: number;
    newPrice: number;
    reason: string;
    effectiveAt: Date;
  }): Promise<void>;
}

export interface NotificationJobDispatcher {
  dispatch(params: {
    subscriptionId: string;
    previousPrice: number;
    newPrice: number;
    effectiveAt: Date;
  }): Promise<void>;
}

export class UpdatePricingConfigUseCase implements UseCase<
  UpdatePricingConfigInput,
  UpdatePricingConfigOutput,
  UseCaseError
> {
  constructor(
    private readonly repo: PricingConfigRepository,
    private readonly notificationDispatcher: NotificationJobDispatcher,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: UpdatePricingConfigInput
  ): Promise<Result<UpdatePricingConfigOutput, UseCaseError>> {
    if (input.adminRole !== "SUPER_ADMIN") {
      return err(
        new UseCaseError(
          "Only SUPER_ADMIN can update pricing configuration",
          USE_CASE_ERRORS.FORBIDDEN
        )
      );
    }

    const doWork = async (): Promise<Result<UpdatePricingConfigOutput, UseCaseError>> => {
      const effectiveAt = new Date(Date.now() + input.notificationWindowDays * 24 * 60 * 60 * 1000);

      const affected = await this.repo.findAffectedSubscriptions(input.entityType, input.entityId);

      for (const sub of affected) {
        await this.repo.createPriceHistory({
          subscriptionId: sub.id,
          previousPrice: sub.pricePerMonth,
          newPrice: input.newValue,
          reason: "price_update",
          effectiveAt,
        });

        await this.repo.setSubscriptionStatus(sub.id, "GRANDFATHERED");

        await this.notificationDispatcher.dispatch({
          subscriptionId: sub.id,
          previousPrice: sub.pricePerMonth,
          newPrice: input.newValue,
          effectiveAt,
        });
      }

      await this.repo.updateEntity(input.entityType, input.entityId, input.field, input.newValue);

      return ok({ affectedSubscriptions: affected.length, effectiveAt });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<UpdatePricingConfigOutput, UseCaseError> = ok({
          affectedSubscriptions: 0,
          effectiveAt: new Date(),
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
          "Failed to update pricing config",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
