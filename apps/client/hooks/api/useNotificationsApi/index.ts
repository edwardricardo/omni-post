/**
 * @file index.ts
 * @description Barrel for the notifications-domain TanStack hooks. Mirrors
 *              the `useInbox/` shape (queries + mutations split). Components
 *              and other hooks import from this barrel only.
 *
 *              Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch`.
 * @layer infrastructure
 */

export {
  useNotificationsList,
  useNotificationsUnreadCount,
  useNotificationPreferences,
} from "./queries.js";

export {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useSaveNotificationPreferences,
} from "./mutations.js";

export type {
  NotificationItemDto,
  NotificationPreferenceDto,
} from "../../../lib/api/clients/notificationsClient.js";
