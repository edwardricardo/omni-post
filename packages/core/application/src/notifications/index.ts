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

export {
  NotificationEventHandlers,
  type NotificationEventContext,
} from "./handlers/NotificationEventHandlers.js";
