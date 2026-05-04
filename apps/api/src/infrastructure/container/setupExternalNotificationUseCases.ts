/**
 * @file setupExternalNotificationUseCases.ts
 * @description Registers all external notification dependencies in the DI container:
 *   repository, adapter ports, dispatcher, and use cases.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { ExternalNotificationConfigRepository } from "../../domain/repositories/ExternalNotificationConfigRepository.js";
import type { ExternalNotifierPort } from "../../domain/repositories/ExternalNotifierPort.js";
import { PrismaExternalNotificationConfigRepository } from "../repositories/PrismaExternalNotificationConfigRepository.js";
import { SlackNotifierAdapter } from "../adapters/SlackNotifierAdapter.js";
import { TeamsNotifierAdapter } from "../adapters/TeamsNotifierAdapter.js";
import { ExternalNotificationDispatcher } from "../adapters/ExternalNotificationDispatcher.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  ConfigureExternalNotificationUseCase,
  ListExternalNotificationsQuery,
  DeleteExternalNotificationUseCase,
  TestExternalNotificationUseCase,
} from "../../application/external-notifications/index.js";

/**
 * @method setupExternalNotificationUseCases
 * @description Register all external notification dependencies in the container.
 */
export function setupExternalNotificationUseCases(container: Container): void {
  // Repository
  container.register<ExternalNotificationConfigRepository>(
    TOKENS.ExternalNotificationConfigRepository,
    () =>
      new PrismaExternalNotificationConfigRepository(
        container.resolve(TOKENS.PrismaClient),
        container.resolve(TOKENS.EncryptionService)
      ),
    true
  );

  // Dispatcher (implements ExternalNotifierPort)
  container.register<ExternalNotifierPort>(
    TOKENS.ExternalNotifierPort,
    () =>
      new ExternalNotificationDispatcher(
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        ),
        new SlackNotifierAdapter(),
        new TeamsNotifierAdapter()
      ),
    true
  );

  // Dispatcher convenience alias
  container.register<ExternalNotificationDispatcher>(
    TOKENS.ExternalNotificationDispatcher,
    () => container.resolve<ExternalNotificationDispatcher>(TOKENS.ExternalNotifierPort),
    true
  );

  // Use Cases
  container.register<ConfigureExternalNotificationUseCase>(
    TOKENS.ConfigureExternalNotificationUseCase,
    () =>
      new ConfigureExternalNotificationUseCase(
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        ),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<ListExternalNotificationsQuery>(
    TOKENS.ListExternalNotificationsQuery,
    () =>
      new ListExternalNotificationsQuery(
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        )
      ),
    true
  );

  container.register<DeleteExternalNotificationUseCase>(
    TOKENS.DeleteExternalNotificationUseCase,
    () =>
      new DeleteExternalNotificationUseCase(
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        ),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<TestExternalNotificationUseCase>(
    TOKENS.TestExternalNotificationUseCase,
    () =>
      new TestExternalNotificationUseCase(
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        ),
        container.resolve<ExternalNotifierPort>(TOKENS.ExternalNotifierPort)
      ),
    true
  );
}
