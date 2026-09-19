/**
 * @file index.ts
 * @description Barrel export for all notification-related use cases and queries.
 * @layer application
 */

export {
  CreateNotificationUseCase,
  type CreateNotificationInput,
  type CreateNotificationOutput,
} from "./CreateNotificationUseCase.js";

export {
  GetNotificationsQuery,
  type GetNotificationsInput,
  type NotificationDTO,
  type NotificationListDTO,
} from "./GetNotificationsQuery.js";

export {
  MarkNotificationReadUseCase,
  MarkAllNotificationsReadUseCase,
  type MarkNotificationReadInput,
  type MarkAllNotificationsReadInput,
} from "./MarkNotificationReadUseCase.js";

export { GetUnreadCountQuery, type GetUnreadCountInput } from "./GetUnreadCountQuery.js";

export { isTypeEnabled } from "./isTypeEnabled.js";

export { SendEmailNotificationService } from "./SendEmailNotificationService.js";

export {
  buildRetractionAlertMessage,
  type RetractionAlertMessage,
  type RetractionAlertMessageInput,
} from "./retractionAlertMessage.js";

export {
  RaiseRetractionAlertUseCase,
  type RaiseRetractionAlertInput,
  type RaiseRetractionAlertOutput,
} from "./RaiseRetractionAlertUseCase.js";

export {
  ResolveRetractionAlertUseCase,
  type ResolveRetractionAlertInput,
  type ResolveRetractionAlertOutput,
} from "./ResolveRetractionAlertUseCase.js";

export {
  NotificationEventHandlers,
  type NotificationEventContext,
} from "./handlers/NotificationEventHandlers.js";
