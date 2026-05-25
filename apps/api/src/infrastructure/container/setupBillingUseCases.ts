/**
 * @file setupBillingUseCases.ts
 * @description Registers billing use cases with their Prisma repository adapters.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { CreateAccountSubscriptionUseCase } from "@core/application/billing/CreateAccountSubscriptionUseCase.js";
import { ChangeAccountSubscriptionUseCase } from "@core/application/billing/ChangeAccountSubscriptionUseCase.js";
import { UpdatePricingConfigUseCase } from "@core/application/billing/UpdatePricingConfigUseCase.js";
import { PrismaCreateSubscriptionRepository } from "../repositories/PrismaCreateSubscriptionRepository.js";
import { PrismaChangeSubscriptionRepository } from "../repositories/PrismaChangeSubscriptionRepository.js";
import {
  GatewayAdapterRegistry,
  createGatewayRegistry,
} from "../billing/GatewayAdapterRegistry.js";
import { GatewayBillingService } from "../../billing/GatewayBillingService.js";
import { GatewaySwitchJobService } from "../../billing/GatewaySwitchJobService.js";
import type { EmailPort } from "../../domain/repositories/EmailPort.js";
import type { PrismaClient } from "@infra/prisma";
import { createRedisConnection } from "../../lib/redis.js";

export function setupBillingUseCases(container: Container): void {
  // Gateway Adapter Registry — dual-gateway access (Stripe + Paddle)
  container.register<GatewayAdapterRegistry>(
    TOKENS.GatewayAdapterRegistry,
    () => createGatewayRegistry(),
    true // singleton
  );

  // Gateway Switch Job Service — BullMQ queue management
  container.register<GatewaySwitchJobService>(
    TOKENS.GatewaySwitchJobService,
    () => {
      const redis = createRedisConnection();
      redis.on("error", () => {});
      return new GatewaySwitchJobService(redis);
    },
    true // singleton
  );

  // Gateway Billing Service — gateway switch lifecycle
  container.register<GatewayBillingService>(
    TOKENS.GatewayBillingService,
    () =>
      new GatewayBillingService(
        container.resolve<PrismaClient>(TOKENS.PrismaClient),
        container.resolve<GatewayAdapterRegistry>(TOKENS.GatewayAdapterRegistry),
        container.resolve<GatewaySwitchJobService>(TOKENS.GatewaySwitchJobService),
        container.resolve<EmailPort>(TOKENS.EmailPort)
      ),
    true // singleton
  );

  container.register<CreateAccountSubscriptionUseCase>(
    TOKENS.CreateAccountSubscriptionUseCase,
    () =>
      new CreateAccountSubscriptionUseCase(
        new PrismaCreateSubscriptionRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient))
      )
  );

  container.register<ChangeAccountSubscriptionUseCase>(
    TOKENS.ChangeAccountSubscriptionUseCase,
    () =>
      new ChangeAccountSubscriptionUseCase(
        new PrismaChangeSubscriptionRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient))
      )
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
