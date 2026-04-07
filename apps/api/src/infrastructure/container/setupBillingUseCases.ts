/**
 * @file setupBillingUseCases.ts
 * @description Registers billing use cases with their Prisma repository adapters.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { CreateAccountSubscriptionUseCase } from "../../application/billing/CreateAccountSubscriptionUseCase.js";
import { ChangeAccountSubscriptionUseCase } from "../../application/billing/ChangeAccountSubscriptionUseCase.js";
import { UpdatePricingConfigUseCase } from "../../application/billing/UpdatePricingConfigUseCase.js";
import { PrismaCreateSubscriptionRepository } from "../repositories/PrismaCreateSubscriptionRepository.js";
import { PrismaChangeSubscriptionRepository } from "../repositories/PrismaChangeSubscriptionRepository.js";

export function setupBillingUseCases(container: Container): void {
  container.register<CreateAccountSubscriptionUseCase>(
    TOKENS.CreateAccountSubscriptionUseCase,
    () => new CreateAccountSubscriptionUseCase(new PrismaCreateSubscriptionRepository())
  );

  container.register<ChangeAccountSubscriptionUseCase>(
    TOKENS.ChangeAccountSubscriptionUseCase,
    () => new ChangeAccountSubscriptionUseCase(new PrismaChangeSubscriptionRepository())
  );

  // UpdatePricingConfigUseCase requires PricingConfigRepository + NotificationJobDispatcher adapters.
  // These will be created when the grandfathering flow is wired through the use case.
  // For now, pricing CRUD goes through pricingRoutes.ts handlers directly.
  container.register<UpdatePricingConfigUseCase>(
    TOKENS.UpdatePricingConfigUseCase,
    () =>
      new UpdatePricingConfigUseCase(
        {
          updateEntity: async () => {},
          findAffectedSubscriptions: async () => [],
          setSubscriptionStatus: async () => {},
          createPriceHistory: async () => {},
        },
        { dispatch: async () => {} }
      )
  );
}
