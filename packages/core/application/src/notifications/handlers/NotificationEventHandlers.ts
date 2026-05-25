/**
 * @file NotificationEventHandlers.ts
 * @description Application-layer event handlers that wire domain events from
 *   approval workflows and comment lifecycle to the notification system.
 *   Each method maps a specific domain event to a CreateNotificationUseCase call.
 * @layer application
 */

import type { CreateNotificationUseCase } from "../CreateNotificationUseCase.js";

// ---------------------------------------------------------------------------
// Context DTO
// ---------------------------------------------------------------------------

/**
 * Contextual information supplied by the caller (route handler or event bus)
 * so the notification handler knows who should receive the notification and
 * who triggered the action.
 */
export interface NotificationEventContext {
  /** The team member ID that should receive this notification */
  recipientId: string;
  /** The team member ID that performed the action (optional) */
  actorId?: string;
  /** Human-readable name of the actor (optional) */
  actorName?: string;
}

// ---------------------------------------------------------------------------
// Handler class
// ---------------------------------------------------------------------------

/**
 * @class NotificationEventHandlers
 * @description Translates domain events into notification creation calls.
 *   The caller is responsible for resolving who should be notified (recipientId)
 *   and passing it via NotificationEventContext.
 */
export class NotificationEventHandlers {
  constructor(private readonly createNotification: CreateNotificationUseCase) {}

  // -- Approval workflow events ---------------------------------------------

  /**
   * @method onPostSubmittedForReview
   * @description Creates an APPROVAL_REQUESTED notification when a post is
   *   submitted for review. The recipientId should be a project reviewer.
   * @param postId - The ID of the submitted post
   * @param _projectId - The project the post belongs to (reserved for future use)
   * @param context - Recipient and actor information
   */
  async onPostSubmittedForReview(
    postId: string,
    _projectId: string,
    context: NotificationEventContext
  ): Promise<void> {
    await this.createNotification.execute({
      recipientId: context.recipientId,
      type: "APPROVAL_REQUESTED",
      title: "Post submitted for review",
      body: "A post has been submitted for your review",
      resourceType: "post",
      resourceId: postId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
    });
  }

  /**
   * @method onPostApproved
   * @description Creates a POST_APPROVED notification when a post is approved.
   *   The recipientId should be the post author.
   * @param postId - The ID of the approved post
   * @param scheduledAt - When the post is scheduled for publishing
   * @param context - Recipient and actor information
   */
  async onPostApproved(
    postId: string,
    scheduledAt: Date,
    context: NotificationEventContext
  ): Promise<void> {
    await this.createNotification.execute({
      recipientId: context.recipientId,
      type: "POST_APPROVED",
      title: "Post approved",
      body: `Your post has been approved and scheduled for ${scheduledAt.toISOString()}`,
      resourceType: "post",
      resourceId: postId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
    });
  }

  /**
   * @method onPostRejected
   * @description Creates a POST_REJECTED notification when a post is rejected.
   *   The recipientId should be the post author.
   * @param postId - The ID of the rejected post
   * @param reason - Optional rejection reason
   * @param context - Recipient and actor information
   */
  async onPostRejected(
    postId: string,
    reason: string | undefined,
    context: NotificationEventContext
  ): Promise<void> {
    const bodyText = reason ? `Your post was rejected: ${reason}` : "Your post was rejected";

    await this.createNotification.execute({
      recipientId: context.recipientId,
      type: "POST_REJECTED",
      title: "Post rejected",
      body: bodyText,
      resourceType: "post",
      resourceId: postId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
    });
  }

  // -- Comment lifecycle events ---------------------------------------------

  /**
   * @method onCommentAdded
   * @description Creates notifications when a comment is added to a post:
   *   - COMMENT_ADDED (or COMMENT_REPLY if it is a reply) for the post owner
   *   - MENTION for each mentioned user (skipping self-mentions)
   * @param postId - The post the comment belongs to
   * @param commentId - The ID of the new comment
   * @param _authorId - The comment author (reserved for filtering logic)
   * @param parentId - The parent comment ID if this is a reply
   * @param mentions - Array of mentioned user IDs
   * @param context - Recipient (post owner) and actor information
   */
  async onCommentAdded(
    postId: string,
    commentId: string,
    _authorId: string,
    parentId: string | undefined,
    mentions: readonly string[],
    context: NotificationEventContext
  ): Promise<void> {
    // Notify post owner about new comment
    await this.createNotification.execute({
      recipientId: context.recipientId,
      type: parentId !== undefined ? "COMMENT_REPLY" : "COMMENT_ADDED",
      title: parentId !== undefined ? "New reply to your comment" : "New comment on your post",
      body:
        parentId !== undefined
          ? "Someone replied to your comment"
          : "A new comment was added to your post",
      resourceType: "comment",
      resourceId: commentId,
      ...(context.actorId !== undefined && { actorId: context.actorId }),
      ...(context.actorName !== undefined && { actorName: context.actorName }),
      metadata: { postId },
    });

    // Notify mentioned users
    for (const mentionedId of mentions) {
      // Skip if the mentioned user is the same as the post owner (already notified)
      if (mentionedId === context.recipientId) continue;
      await this.createNotification.execute({
        recipientId: mentionedId,
        type: "MENTION",
        title: "You were mentioned",
        body: "You were mentioned in a comment",
        resourceType: "comment",
        resourceId: commentId,
        ...(context.actorId !== undefined && { actorId: context.actorId }),
        ...(context.actorName !== undefined && { actorName: context.actorName }),
        metadata: { postId },
      });
    }
  }
}
