/**
 * @file setupIntegrationUseCases.ts
 * @description Registers all integration-related repositories, use cases, and services
 *   in the DI container. Supports Zapier, Make, and future integration platforms.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { IntegrationApiKeyRepository } from "@core/domain/repositories/IntegrationApiKeyRepository.js";
import type { PasswordHasher } from "@core/domain/repositories/PasswordHasher.js";
import type { IntegrationSubscriptionRepository } from "@core/domain/repositories/IntegrationSubscriptionRepository.js";
import { PrismaIntegrationApiKeyRepository } from "../repositories/PrismaIntegrationApiKeyRepository.js";
import { PrismaIntegrationSubscriptionRepository } from "../repositories/PrismaIntegrationSubscriptionRepository.js";
import { GenerateIntegrationApiKeyUseCase } from "@core/application/integrations/GenerateIntegrationApiKeyUseCase.js";
import { RevokeIntegrationApiKeyUseCase } from "@core/application/integrations/RevokeIntegrationApiKeyUseCase.js";
import { ListIntegrationApiKeysQuery } from "@core/application/integrations/ListIntegrationApiKeysQuery.js";
import { SubscribeIntegrationTriggerUseCase } from "@core/application/integrations/SubscribeIntegrationTriggerUseCase.js";
import { UnsubscribeIntegrationTriggerUseCase } from "@core/application/integrations/UnsubscribeIntegrationTriggerUseCase.js";
import { TriggerIntegrationEventService } from "@core/application/integrations/TriggerIntegrationEventService.js";
import { IntegrationEventDeliveryHandler } from "../../integrations/IntegrationEventDeliveryHandler.js";

/**
 * @method setupIntegrationUseCases
 * @description Register all integration repositories, use cases, and services.
 */
export function setupIntegrationUseCases(container: Container): void {
  // Repositories
  container.register<IntegrationApiKeyRepository>(
    TOKENS.IntegrationApiKeyRepository,
    () => new PrismaIntegrationApiKeyRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<IntegrationSubscriptionRepository>(
    TOKENS.IntegrationSubscriptionRepository,
    () => new PrismaIntegrationSubscriptionRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  // Use Cases
  container.register<GenerateIntegrationApiKeyUseCase>(
    TOKENS.GenerateIntegrationApiKeyUseCase,
    () =>
      new GenerateIntegrationApiKeyUseCase(
        container.resolve<IntegrationApiKeyRepository>(TOKENS.IntegrationApiKeyRepository),
        container.resolve<PasswordHasher>(TOKENS.PasswordHasher)
      ),
    true
  );

  container.register<RevokeIntegrationApiKeyUseCase>(
    TOKENS.RevokeIntegrationApiKeyUseCase,
    () =>
      new RevokeIntegrationApiKeyUseCase(
        container.resolve<IntegrationApiKeyRepository>(TOKENS.IntegrationApiKeyRepository)
      ),
    true
  );

  container.register<ListIntegrationApiKeysQuery>(
    TOKENS.ListIntegrationApiKeysQuery,
    () =>
      new ListIntegrationApiKeysQuery(
        container.resolve<IntegrationApiKeyRepository>(TOKENS.IntegrationApiKeyRepository)
      ),
    true
  );

  container.register<SubscribeIntegrationTriggerUseCase>(
    TOKENS.SubscribeIntegrationTriggerUseCase,
    () =>
      new SubscribeIntegrationTriggerUseCase(
        container.resolve<IntegrationSubscriptionRepository>(
          TOKENS.IntegrationSubscriptionRepository
        )
      ),
    true
  );

  container.register<UnsubscribeIntegrationTriggerUseCase>(
    TOKENS.UnsubscribeIntegrationTriggerUseCase,
    () =>
      new UnsubscribeIntegrationTriggerUseCase(
        container.resolve<IntegrationSubscriptionRepository>(
          TOKENS.IntegrationSubscriptionRepository
        )
      ),
    true
  );

  // Services
  container.register<TriggerIntegrationEventService>(
    TOKENS.TriggerIntegrationEventService,
    () =>
      new TriggerIntegrationEventService(
        container.resolve<IntegrationSubscriptionRepository>(
          TOKENS.IntegrationSubscriptionRepository
        ),
        container.resolve<import("@core/domain/repositories/HttpClientPort.js").HttpClientPort>(
          TOKENS.HttpClientPort
        )
      ),
    true
  );

  // Bridges domain events from the outbox to integration delivery. The
  // dispatcher subscription itself is wired at boot in apps/api/src/index.ts
  // after the OutboxRelay starts.
  container.register<IntegrationEventDeliveryHandler>(
    TOKENS.IntegrationEventDeliveryHandler,
    () =>
      new IntegrationEventDeliveryHandler(
        container.resolve<TriggerIntegrationEventService>(TOKENS.TriggerIntegrationEventService)
      ),
    true
  );
}
