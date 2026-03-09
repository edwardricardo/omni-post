/**
 * @file index.ts
 * @description Barrel export for all Social Inbox command and query use cases
 *   and their associated input/output DTOs.
 * @layer application
 */

// IngestSocialMessage
export {
  IngestSocialMessageUseCase,
  type IngestSocialMessageInput,
  type IngestSocialMessageOutput,
} from "./IngestSocialMessageUseCase.js";

// MarkMessageRead
export { MarkMessageReadUseCase, type MarkMessageReadInput } from "./MarkMessageReadUseCase.js";

// MarkMessageArchived
export {
  MarkMessageArchivedUseCase,
  type MarkMessageArchivedInput,
} from "./MarkMessageArchivedUseCase.js";

// AssignMessage
export { AssignMessageUseCase, type AssignMessageInput } from "./AssignMessageUseCase.js";

// SendReply
export { SendReplyUseCase, type SendReplyInput, type SendReplyOutput } from "./SendReplyUseCase.js";

// ResolveConversation
export {
  ResolveConversationUseCase,
  type ResolveConversationInput,
} from "./ResolveConversationUseCase.js";

// ReopenConversation
export {
  ReopenConversationUseCase,
  type ReopenConversationInput,
} from "./ReopenConversationUseCase.js";

// SyncProviderComments
export {
  SyncProviderCommentsUseCase,
  type SyncProviderCommentsInput,
  type SyncProviderCommentsOutput,
} from "./SyncProviderCommentsUseCase.js";

// ── Query Use Cases ───────────────────────────────────────────────────

// GetInbox
export { GetInboxQuery, type GetInboxInput } from "./GetInboxQuery.js";

// GetMentions
export { GetMentionsQuery, type GetMentionsInput } from "./GetMentionsQuery.js";

// GetConversation
export { GetConversationQuery, type GetConversationInput } from "./GetConversationQuery.js";

// GetConversationMessages
export {
  GetConversationMessagesQuery,
  type GetConversationMessagesInput,
} from "./GetConversationMessagesQuery.js";

// GetUnreadInboxCount
export {
  GetUnreadInboxCountQuery,
  type GetUnreadInboxCountInput,
} from "./GetUnreadInboxCountQuery.js";
