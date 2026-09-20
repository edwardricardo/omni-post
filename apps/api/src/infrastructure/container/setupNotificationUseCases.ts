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
} from "@core/domain/repositories/NotificationRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  CreateNotificationUseCase,
  GetNotificationsQuery,
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  GetUnreadCountQuery,
  NotificationEventHandlers,
  SendEmailNotificationService,
  RaiseRetractionAlertUseCase,
  ResolveRetractionAlertUseCase,
} from "@core/notifications/index.js";
import type { NotificationMailer } from "@core/domain/repositories/NotificationMailer.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { ExternalNotificationConfigRepository } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import type { ExternalNotifierPort } from "@core/domain/repositories/ExternalNotifierPort.js";
import type { RetractionAlertDeliveryLedger } from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import type { PostQueryRepository } from "@core/domain/repositories/PostRepository.js";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { AccountRepository } from "@core/domain/repositories/AccountRepository.js";
import type { RetractionAlertDelivery } from "@ports/core";
import { PrismaRetractionAlertDeliveryLedger } from "../repositories/PrismaRetractionAlertDeliveryLedger.js";
import { RetractionAlertContextAdapter } from "../adapters/RetractionAlertContextAdapter.js";
import {
  InAppRetractionAlertDelivery,
  type RealtimeNotificationPublisher,
} from "../adapters/InAppRetractionAlertDelivery.js";
import { EmailRetractionAlertDelivery } from "../adapters/EmailRetractionAlertDelivery.js";
import { SlackTeamsRetractionAlertDelivery } from "../adapters/SlackTeamsRetractionAlertDelivery.js";
import { RetractionAlertEventHandler } from "../../notifications/RetractionAlertEventHandler.js";

/**
 * Register notification use cases and event handlers
 */
export function setupNotificationUseCases(container: Container): void {
  // Register Notification Use Cases
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

  // Register Notification Event Handlers
  container.register<NotificationEventHandlers>(
    TOKENS.NotificationEventHandlers,
    () =>
      new NotificationEventHandlers(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase)
      ),
    true
  );

  setupRetractionAlert(container);
}

/**
 * @method setupRetractionAlert
 * @description Wires the urgent retraction alert: its delivery ledger, the three media
 *   it can travel on, the two use cases and the event handler that bridges the outbox
 *   to them.
 *
 *   This is also where `SendEmailNotificationService` gains its FIRST registration. It
 *   has existed unwired: the email medium of this alert is its first production caller,
 *   because the customer is being asked to remove content from a platform this
 *   application cannot reach, and a dashboard they may not open that day is not a
 *   reliable way to ask.
 *
 *   `sms` and `push` get NO adapter, deliberately. The use case reports a medium with
 *   no adapter as `unavailable` rather than silently dropping it, which is what keeps
 *   the two gaps visible in the alert's own telemetry instead of nowhere.
 */
function setupRetractionAlert(container: Container): void {
  container.register<SendEmailNotificationService>(
    TOKENS.SendEmailNotificationService,
    () =>
      new SendEmailNotificationService(
        container.resolve<NotificationMailer>(TOKENS.NotificationMailer),
        container.resolve<NotificationPreferenceRepository>(TOKENS.NotificationPreferenceRepository)
      ),
    true
  );

  container.register<RetractionAlertDeliveryLedger>(
    TOKENS.RetractionAlertDeliveryLedger,
    () => new PrismaRetractionAlertDeliveryLedger(container.resolve(TOKENS.PrismaClient)),
    true
  );

  container.register<RetractionAlertContextAdapter>(
    TOKENS.RetractionAlertContextAdapter,
    () =>
      new RetractionAlertContextAdapter(
        container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<AccountRepository>(TOKENS.AccountRepository)
      ),
    true
  );

  container.register<readonly RetractionAlertDelivery[]>(
    TOKENS.RetractionAlertMedia,
    () => [
      new InAppRetractionAlertDelivery(
        container.resolve<CreateNotificationUseCase>(TOKENS.CreateNotificationUseCase),
        container.resolve<RealtimeNotificationPublisher>(TOKENS.NotificationBroadcaster)
      ),
      new EmailRetractionAlertDelivery(
        container.resolve<SendEmailNotificationService>(TOKENS.SendEmailNotificationService)
      ),
      new SlackTeamsRetractionAlertDelivery(
        container.resolve<ExternalNotifierPort>(TOKENS.ExternalNotifierPort)
      ),
    ],
    true
  );

  container.register<ResolveRetractionAlertUseCase>(
    TOKENS.ResolveRetractionAlertUseCase,
    () =>
      new ResolveRetractionAlertUseCase(
        container.resolve<RetractionAlertDeliveryLedger>(TOKENS.RetractionAlertDeliveryLedger),
        container.resolve<NotificationRepository>(TOKENS.NotificationRepository)
      ),
    true
  );

  container.register<RaiseRetractionAlertUseCase>(
    TOKENS.RaiseRetractionAlertUseCase,
    () =>
      new RaiseRetractionAlertUseCase(
        container.resolve<CustomerUserRepository>(TOKENS.CustomerUserRepository),
        container.resolve<NotificationPreferenceRepository>(
          TOKENS.NotificationPreferenceRepository
        ),
        container.resolve<ExternalNotificationConfigRepository>(
          TOKENS.ExternalNotificationConfigRepository
        ),
        container.resolve<RetractionAlertDeliveryLedger>(TOKENS.RetractionAlertDeliveryLedger),
        container.resolve<readonly RetractionAlertDelivery[]>(TOKENS.RetractionAlertMedia),
        container.resolve<ResolveRetractionAlertUseCase>(TOKENS.ResolveRetractionAlertUseCase)
      ),
    true
  );

  container.register<RetractionAlertEventHandler>(
    TOKENS.RetractionAlertEventHandler,
    () =>
      new RetractionAlertEventHandler(
        container.resolve<RaiseRetractionAlertUseCase>(TOKENS.RaiseRetractionAlertUseCase),
        container.resolve<ResolveRetractionAlertUseCase>(TOKENS.ResolveRetractionAlertUseCase),
        container.resolve<RetractionAlertContextAdapter>(TOKENS.RetractionAlertContextAdapter)
      ),
    true
  );
}
