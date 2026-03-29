/**
 * @file setupNotificationUseCases.ts
 * @description Registers notification use cases and event handlers
 *              in the DI container. Extracted from setupUseCases.ts.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type {
  NotificationRepository,
  NotificationPreferenceRepository,
} from "../../domain/repositories/NotificationRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import {
  CreateNotificationUseCase,
  GetNotificationsQuery,
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  GetUnreadCountQuery,
  NotificationEventHandlers,
} from "../../application/notifications/index.js";

/**
 * Register notification use cases and event handlers
 */
export function setupNotificationUseCases(container: Container): void {
  // Register Notification Use Cases (Phase 1.2)
  container.register<CreateNotificationUseCase>(
    TOKENS.CreateNotificationUseCase,
    () =>
      new CreateNotificationUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository),
        container.resolve<NotificationPreferenceRepository>(
          TOKENS.NotificationPreferenceRepository
        ),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetNotificationsQuery>(
    TOKENS.GetNotificationsQuery,
    () =>
      new GetNotificationsQuery(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );
  container.register<MarkNotificationReadUseCase>(
    TOKENS.MarkNotificationReadUseCase,
    () =>
      new MarkNotificationReadUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<MarkAllNotificationsReadUseCase>(
    TOKENS.MarkAllNotificationsReadUseCase,
    () =>
      new MarkAllNotificationsReadUseCase(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );
  container.register<GetUnreadCountQuery>(
    TOKENS.GetUnreadCountQuery,
    () =>
      new GetUnreadCountQuery(
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );

  // Register Notification Event Handlers (Phase 1.5)
  container.register<NotificationEventHandlers>(
    TOKENS.NotificationEventHandlers,
    () =>
      new NotificationEventHandlers(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );
}
