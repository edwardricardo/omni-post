/**
 * @file MentionContext.ts
 * @description Value object enumerating the contexts in which an @mention can
 *   occur (conversation notes, tasks, post comments). Used by mention tracking
 *   + notification dispatch to route mention events to the right consumer.
 *
 *   Lives in `@core/domain/value-objects/` so that multiple bounded contexts
 *   (mentions, inbox, tasks) can reference the constant without taking a
 *   cross-bounded-context dependency on `@core/mentions`.
 * @layer domain
 */

export const MENTION_CONTEXT = {
  CONVERSATION_NOTE: "conversation_note",
  TASK: "task",
  POST_COMMENT: "post_comment",
} as const;

export type MentionContextType = (typeof MENTION_CONTEXT)[keyof typeof MENTION_CONTEXT];
