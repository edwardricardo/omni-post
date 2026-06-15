/**
 * @file index.ts
 * @description Barrel export for the Social Inbox hook module. Preserves the
 *              public import path `@/hooks/api/useInbox` after the file was
 *              split into types/api/queries/mutations.
 * @layer infrastructure
 */

export type {
  InboxConversation,
  InboxFilters,
  InboxMessage,
  InboxMessagesPage,
  InboxMessageStatus,
  InboxMessageWireType,
  InboxPriority,
} from "./types";

export { useConversation, useConversationMessages, useInboxMessages, useMentions } from "./queries";

export {
  useAssignMessage,
  useMarkMessageRead,
  useReopenConversation,
  useResolveConversation,
  useSendReply,
} from "./mutations";
