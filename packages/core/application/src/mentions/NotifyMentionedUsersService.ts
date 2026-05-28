/**
 * @file NotifyMentionedUsersService.ts
 * @description Application service that parses @mentions from text content
 *   and creates notifications for each uniquely mentioned team member.
 *   Skips self-mentions (when the mentioner mentions themselves).
 * @layer application
 */

import { MentionParser } from "@core/domain/services/MentionParser.js";
import type { NotificationDispatchPort } from "@ports/core";
import { NOTIFICATION_TYPES } from "@core/domain/value-objects/NotificationType.js";
import {
  MENTION_CONTEXT,
  type MentionContextType,
} from "@core/domain/value-objects/MentionContext.js";

export { MENTION_CONTEXT, type MentionContextType };

/**
 * Input for the notification service.
 */
export interface NotifyMentionedUsersInput {
  /** The text containing @mention markup */
  readonly text: string;
  /** The account ID for scoping */
  readonly accountId: string;
  /** Team member ID of the user who wrote the text */
  readonly mentionedById: string;
  /** Display name of the user who wrote the text (for notification body) */
  readonly mentionedByName: string;
  /** The context type where the mention occurred */
  readonly context: MentionContextType;
  /** The resource ID associated with the context (e.g. conversationId, taskId) */
  readonly contextId: string;
}

/**
 * @class NotifyMentionedUsersService
 * @description Parses mentions from text and creates in-app notifications
 *   for each uniquely mentioned team member. Self-mentions are ignored.
 */
export class NotifyMentionedUsersService {
  constructor(private readonly notifications: NotificationDispatchPort) {}

  /**
   * @method notify
   * @description Parses the text for @mentions, deduplicates them, filters
   *   out self-mentions, and creates a MENTION notification for each recipient.
   * @param input - Text, author info, and context details
   * @returns Array of notification IDs that were successfully created
   */
  async notify(input: NotifyMentionedUsersInput): Promise<string[]> {
    const uniqueIds = MentionParser.extractUniqueIds(input.text);

    // Filter out self-mentions
    const recipientIds = uniqueIds.filter((id) => id !== input.mentionedById);

    if (recipientIds.length === 0) {
      return [];
    }

    const contextLabel = this.formatContextLabel(input.context);
    const notificationIds: string[] = [];

    for (const recipientId of recipientIds) {
      const result = await this.notifications.dispatch({
        recipientId,
        type: NOTIFICATION_TYPES.MENTION,
        title: `${input.mentionedByName} mentioned you`,
        body: `You were mentioned in a ${contextLabel}`,
        resourceType: input.context,
        resourceId: input.contextId,
        actorId: input.mentionedById,
        actorName: input.mentionedByName,
        metadata: {
          accountId: input.accountId,
          context: input.context,
          contextId: input.contextId,
        },
      });

      if (result.ok && result.value.id) {
        notificationIds.push(result.value.id);
      }
    }

    return notificationIds;
  }

  /**
   * @method formatContextLabel
   * @description Returns a human-readable label for the mention context type.
   * @param context - The context type
   * @returns Formatted string for display in notification body
   */
  private formatContextLabel(context: MentionContextType): string {
    switch (context) {
      case MENTION_CONTEXT.CONVERSATION_NOTE:
        return "conversation note";
      case MENTION_CONTEXT.TASK:
        return "task";
      case MENTION_CONTEXT.POST_COMMENT:
        return "post comment";
    }
  }
}
