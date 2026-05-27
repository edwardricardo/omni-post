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
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { PrismaClient } from "@infra/prisma";
import { createRedisConnection } from "../../lib/redis.js";
import { PrismaGatewaySwitchEventRepository } from "../repositories/PrismaGatewaySwitchEventRepository.js";
import type { GatewaySwitchEventRepository } from "@core/domain/repositories/GatewaySwitchEventRepository.js";
import { PrismaBillingEventRepository } from "../repositories/PrismaBillingEventRepository.js";
import type { BillingEventRepository } from "@core/domain/repositories/BillingEventRepository.js";
import { PrismaInvoiceRepository } from "../repositories/PrismaInvoiceRepository.js";
import type { InvoiceRepository } from "@core/domain/repositories/InvoiceRepository.js";
import { PrismaProviderBundleRepository } from "../repositories/PrismaProviderBundleRepository.js";
import type { ProviderBundleReader } from "@core/domain/repositories/ProviderBundleReader.js";
import type { GatewaySwitchJobPort } from "@core/domain/repositories/GatewaySwitchJobPort.js";
import type { AccountBillingRepository } from "@core/domain/repositories/AccountBillingRepository.js";
import type { AccountSubscriptionBillingRepository } from "@core/domain/repositories/AccountSubscriptionBillingRepository.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

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

  // S3.4b scaffolding — port aliases + new billing repositories. The
  // GatewaySwitchJobPort token resolves to the existing job-service
  // instance (which now declares `implements GatewaySwitchJobPort`).
  container.register<GatewaySwitchJobPort>(
    TOKENS.GatewaySwitchJobPort,
    () => container.resolve<GatewaySwitchJobService>(TOKENS.GatewaySwitchJobService),
    true
  );
  container.register<GatewaySwitchEventRepository>(
    TOKENS.GatewaySwitchEventRepository,
    () =>
      new PrismaGatewaySwitchEventRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<BillingEventRepository>(
    TOKENS.BillingEventRepository,
    () => new PrismaBillingEventRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<InvoiceRepository>(
    TOKENS.InvoiceRepository,
    () => new PrismaInvoiceRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<ProviderBundleReader>(
    TOKENS.ProviderBundleReader,
    () => new PrismaProviderBundleRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );

  // Gateway Billing Service — gateway switch lifecycle (S3.4c canon refactor)
  container.register<GatewayBillingService>(
    TOKENS.GatewayBillingService,
    () =>
      new GatewayBillingService(
        container.resolve<AccountBillingRepository>(TOKENS.AccountBillingRepository),
        container.resolve<AccountSubscriptionBillingRepository>(
          TOKENS.AccountSubscriptionBillingRepository
        ),
        container.resolve<GatewaySwitchEventRepository>(TOKENS.GatewaySwitchEventRepository),
        container.resolve<BillingEventRepository>(TOKENS.BillingEventRepository),
        container.resolve<InvoiceRepository>(TOKENS.InvoiceRepository),
        container.resolve<ProviderBundleReader>(TOKENS.ProviderBundleReader),
        container.resolve<GatewayAdapterRegistry>(TOKENS.GatewayAdapterRegistry),
        container.resolve<GatewaySwitchJobPort>(TOKENS.GatewaySwitchJobPort),
        container.resolve<EmailPort>(TOKENS.EmailPort),
        container.resolve<AuditEmitterPort>(TOKENS.AuditEmitterPort),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
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
