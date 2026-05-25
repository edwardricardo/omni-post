/**
 * @file InboxEventHandlers.ts
 * @description Event handlers for Social Inbox domain events.
 *   Creates notifications and broadcasts real-time updates when
 *   inbox messages are received or replied to.
 * @layer application
 */

import { type CreateNotificationUseCase } from "../../notifications/CreateNotificationUseCase.js";

/**
 * Context for inbox event handlers — carries project/team info.
 */
export interface InboxEventContext {
  recipientId: string;
  actorId?: string;
  actorName?: string;
}

/**
 * @class InboxEventHandlers
 * @description Handles Social Inbox domain events by creating notifications
 *   for relevant team members. Registered as a singleton in DI.
 */
export class InboxEventHandlers {
  constructor(private readonly createNotification: CreateNotificationUseCase) {}

  /**
   * @method onSocialMessageReceived
   * @description Creates a notification when a new social message is received.
   * @param messageId - The social message ID
   * @param messageType - COMMENT, MENTION, REPLY, or DIRECT_MESSAGE
   * @param authorName - The external author's name
   * @param body - The message body (truncated for notification)
   * @param context - Notification routing context
   */
  async onSocialMessageReceived(
    messageId: string,
    messageType: string,
    authorName: string,
    body: string,
    context: InboxEventContext
  ): Promise<void> {
    const isMention = messageType === "MENTION";
    const type = isMention ? "INBOX_MENTION_RECEIVED" : "INBOX_MESSAGE_RECEIVED";
    const title = isMention ? `${authorName} te mencionó` : `Nuevo comentario de ${authorName}`;
    const truncatedBody = body.length > 200 ? `${body.slice(0, 197)}...` : body;

    await this.createNotification.execute({
      recipientId: context.recipientId,
      type,
      title,
      body: truncatedBody,
      resourceType: "SocialMessage",
      resourceId: messageId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
    });
  }

  /**
   * @method onSocialMessageReplied
   * @description Creates a notification when a team member replies to a social message.
   * @param messageId - The social message ID
   * @param replierName - The team member who replied
   * @param context - Notification routing context
   */
  async onSocialMessageReplied(
    messageId: string,
    replierName: string,
    context: InboxEventContext
  ): Promise<void> {
    await this.createNotification.execute({
      recipientId: context.recipientId,
      type: "INBOX_MESSAGE_RECEIVED",
      title: `${replierName} respondió a un mensaje`,
      body: "Se envió una respuesta desde el inbox.",
      resourceType: "SocialMessage",
      resourceId: messageId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
    });
  }
}
