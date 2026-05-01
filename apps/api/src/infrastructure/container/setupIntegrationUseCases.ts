/**
 * @file setupIntegrationUseCases.ts
 * @description Registers all integration-related repositories, use cases, and services
 *   in the DI container. Supports Zapier, Make, and future integration platforms.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { IntegrationApiKeyRepository } from "../../domain/repositories/IntegrationApiKeyRepository.js";
import type { IntegrationSubscriptionRepository } from "../../domain/repositories/IntegrationSubscriptionRepository.js";
import { PrismaIntegrationApiKeyRepository } from "../repositories/PrismaIntegrationApiKeyRepository.js";
import { PrismaIntegrationSubscriptionRepository } from "../repositories/PrismaIntegrationSubscriptionRepository.js";
import { GenerateIntegrationApiKeyUseCase } from "../../application/integrations/GenerateIntegrationApiKeyUseCase.js";
import { RevokeIntegrationApiKeyUseCase } from "../../application/integrations/RevokeIntegrationApiKeyUseCase.js";
import { ListIntegrationApiKeysQuery } from "../../application/integrations/ListIntegrationApiKeysQuery.js";
import { SubscribeIntegrationTriggerUseCase } from "../../application/integrations/SubscribeIntegrationTriggerUseCase.js";
import { UnsubscribeIntegrationTriggerUseCase } from "../../application/integrations/UnsubscribeIntegrationTriggerUseCase.js";
import { TriggerIntegrationEventService } from "../../application/integrations/TriggerIntegrationEventService.js";

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
        container.resolve<IntegrationApiKeyRepository>(TOKENS.IntegrationApiKeyRepository)
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
        container.resolve<import("../../domain/repositories/HttpClientPort.js").HttpClientPort>(
          TOKENS.HttpClientPort
        )
      ),
    true
  );
}
