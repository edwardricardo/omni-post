/**
 * @file linkedinWebhookProcessor.ts
 * @description LinkedIn Webhook Processor.
 *              Handles Organization Social Action Notifications from LinkedIn.
 *              Verifies HMAC-SHA256 signatures via X-LI-Signature header.
 *
 * LinkedIn webhook events:
 * - LIKE: Someone liked a post
 * - COMMENT: Someone commented on a post
 * - SHARE: Someone shared a post
 * - SHARE_MENTION: Organization was mentioned in a share
 * - ADMIN_COMMENT: Admin commented on a post
 * - COMMENT_EDIT: A comment was edited
 * - COMMENT_DELETE: A comment was deleted
 * @layer infrastructure
 */

import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

/**
 * LinkedIn Organization Social Action Notification payload
 */
interface LinkedInNotification {
  notificationId: string;
  eventType:
    | "LIKE"
    | "COMMENT"
    | "SHARE"
    | "SHARE_MENTION"
    | "ADMIN_COMMENT"
    | "COMMENT_EDIT"
    | "COMMENT_DELETE";
  resourceUrn: string;
  actorUrn: string;
  organizationUrn: string;
  timestamp: number;
  details?: Record<string, unknown>;
}

interface LinkedInWebhookPayload {
  notifications?: LinkedInNotification[];
  eventType?: string;
  resourceUrn?: string;
  actorUrn?: string;
  organizationUrn?: string;
  notificationId?: string;
  timestamp?: number;
}

/**
 * LinkedIn Webhook Processor
 *
 * Processes Organization Social Action Notifications.
 * LinkedIn sends notifications in batches of up to 10.
 * Each notification carries a notificationId for deduplication.
 */
export class LinkedInWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "LINKEDIN";
  protected override signaturePrefix = "hmacsha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * @method verify
   * @description Verifies LinkedIn webhook signature.
   *              LinkedIn sends X-LI-Signature header with hmacsha256={hash}.
   *              The hash is computed with HMAC-SHA256(request_body, clientSecret).
   */
  override verify(
    payload: string,
    signature: string,
    secret: string,
    _headers?: Record<string, string>
  ): boolean {
    return super.verify(payload, signature, secret);
  }

  /**
   * @method parse
   * @description Parses LinkedIn webhook payload.
   *              LinkedIn may send a single notification or a batch.
   */
  override async parse(payload: Record<string, unknown>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, unknown>;
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    };
  }> {
    const typedPayload = payload as unknown as LinkedInWebhookPayload;

    // LinkedIn may send batch or single notification
    const notification = typedPayload.notifications?.[0] || {
      eventType: typedPayload.eventType,
      resourceUrn: typedPayload.resourceUrn,
      actorUrn: typedPayload.actorUrn,
      organizationUrn: typedPayload.organizationUrn,
      notificationId: typedPayload.notificationId,
      timestamp: typedPayload.timestamp,
    };

    if (!notification.eventType) {
      throw AppError.badRequest("Invalid LinkedIn webhook: missing eventType");
    }

    const eventType = this.mapLinkedInEvent(notification.eventType as string);
    const normalizedData = this.normalizeNotification(notification as LinkedInNotification);
    const relatedEntities = await this.findRelatedEntities(notification as LinkedInNotification);

    return { eventType, normalizedData, relatedEntities };
  }

  /**
   * @method process
   * @description Processes a normalized LinkedIn webhook event.
   */
  override async process(
    normalizedData: Record<string, unknown>,
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    }
  ): Promise<void> {
    const eventType = normalizedData.eventType as string;

    switch (eventType) {
      case "LIKE":
        await this.handleEngagementUpdate(normalizedData, relatedEntities, "like");
        break;
      case "COMMENT":
      case "ADMIN_COMMENT":
        await this.handleCommentReceived(normalizedData, relatedEntities);
        break;
      case "SHARE":
        await this.handleEngagementUpdate(normalizedData, relatedEntities, "share");
        break;
      case "SHARE_MENTION":
        await this.handleMention(normalizedData, relatedEntities);
        break;
      case "COMMENT_EDIT":
      case "COMMENT_DELETE":
        webhookLogger.info(
          { event: eventType, postId: relatedEntities.postId },
          "LinkedIn comment modification event"
        );
        break;
      default:
        webhookLogger.warn({ event: eventType }, "Unknown LinkedIn webhook event");
    }
  }

  /**
   * Maps LinkedIn event types to OmniPost WebhookEventType
   */
  private mapLinkedInEvent(linkedInEvent: string): WebhookEventType {
    switch (linkedInEvent) {
      case "LIKE":
        return "LIKE_RECEIVED";
      case "COMMENT":
      case "ADMIN_COMMENT":
        return "COMMENT_RECEIVED";
      case "SHARE":
        return "SHARE_RECEIVED";
      case "SHARE_MENTION":
        return "MENTION_RECEIVED";
      case "COMMENT_EDIT":
      case "COMMENT_DELETE":
        return "POST_UPDATED";
      default:
        return "POST_ENGAGEMENT_UPDATE";
    }
  }

  /**
   * Normalizes a LinkedIn notification into a standard structure
   */
  private normalizeNotification(notification: LinkedInNotification): Record<string, unknown> {
    return {
      eventType: notification.eventType,
      notificationId: notification.notificationId,
      resourceUrn: notification.resourceUrn,
      actorUrn: notification.actorUrn,
      organizationUrn: notification.organizationUrn,
      timestamp: notification.timestamp,
      ...(notification.details ? { details: notification.details } : {}),
    };
  }

  /**
   * Finds related OmniPost entities from LinkedIn URNs
   */
  private async findRelatedEntities(notification: LinkedInNotification): Promise<{
    accountId?: string;
    projectId?: string;
    postId?: string;
    channelId?: string;
  }> {
    const orgUrn = notification.organizationUrn;
    if (!orgUrn) return {};

    try {
      // Find active channel (not soft-deleted) for LinkedIn
      const channel = await this.prisma.channel.findFirst({
        where: {
          provider: "LINKEDIN",
          deletedAt: null,
        },
      });

      if (!channel) return {};

      // Fetch the project separately to get accountId
      const project = await this.prisma.project.findUnique({
        where: { id: channel.projectId },
      });

      const result: {
        accountId?: string;
        projectId?: string;
        postId?: string;
        channelId?: string;
      } = {
        channelId: channel.id,
        projectId: channel.projectId,
        ...(project ? { accountId: project.accountId } : {}),
      };

      // Try to find the post by provider post ID
      if (notification.resourceUrn) {
        const publishLog = await this.prisma.publishLog.findFirst({
          where: {
            channelId: channel.id,
            status: "OK",
          },
          orderBy: { createdAt: "desc" },
        });

        if (publishLog?.postId) {
          result.postId = publishLog.postId;
        }
      }

      return result;
    } catch (error: unknown) {
      webhookLogger.error({ error }, "Failed to find related entities for LinkedIn webhook");
      return {};
    }
  }

  /**
   * Handles engagement updates (likes, shares)
   */
  private async handleEngagementUpdate(
    normalizedData: Record<string, unknown>,
    relatedEntities: { postId?: string; channelId?: string },
    engagementType: "like" | "share"
  ): Promise<void> {
    if (!relatedEntities.postId) return;

    webhookLogger.info(
      {
        engagementType,
        postId: relatedEntities.postId,
        actorUrn: normalizedData.actorUrn,
      },
      `LinkedIn ${engagementType} received`
    );

    this.broadcastEngagementUpdate(
      relatedEntities.postId,
      {
        likes: engagementType === "like" ? 1 : 0,
        shares: engagementType === "share" ? 1 : 0,
        comments: 0,
      },
      {
        likes: engagementType === "like" ? 1 : 0,
        shares: engagementType === "share" ? 1 : 0,
        comments: 0,
      }
    );
  }

  /**
   * Handles comment received events
   */
  private async handleCommentReceived(
    normalizedData: Record<string, unknown>,
    relatedEntities: { postId?: string; channelId?: string }
  ): Promise<void> {
    if (!relatedEntities.postId) return;

    webhookLogger.info(
      {
        postId: relatedEntities.postId,
        actorUrn: normalizedData.actorUrn,
      },
      "LinkedIn comment received"
    );

    this.broadcastEngagementUpdate(
      relatedEntities.postId,
      { likes: 0, shares: 0, comments: 1 },
      { likes: 0, shares: 0, comments: 1 }
    );
  }

  /**
   * Handles mention events
   */
  private async handleMention(
    normalizedData: Record<string, unknown>,
    relatedEntities: { postId?: string; channelId?: string }
  ): Promise<void> {
    webhookLogger.info(
      {
        channelId: relatedEntities.channelId,
        actorUrn: normalizedData.actorUrn,
        resourceUrn: normalizedData.resourceUrn,
      },
      "LinkedIn mention received"
    );
  }
}
