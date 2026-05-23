/**
 * @file threadsWebhookProcessor.ts
 * @description Threads (Meta) webhook processor handling reply, mention, and
 *              post publish/delete events. Inherits HMAC-SHA256 (hex) signature
 *              verification from AbstractWebhookProcessor. A mention is a
 *              notification only, so it is enqueued for the mention-ingest worker
 *              to fetch and persist; a publish confirmation reconciles the post's
 *              publish log and status.
 * @layer infrastructure
 */
import type { WebhookEventType, PrismaClient } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";
import type { RealtimeWebhookBroadcaster } from "../realtimeWebhookBroadcaster.js";
import type { MentionFetchEnqueue } from "../mentionFetchEnqueue.js";

/**
 * Threads Webhook Processor — Meta Graph API webhooks for the `threads` topic
 * (replies, mentions, posts publish/delete).
 */
export class ThreadsWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "THREADS";
  protected override signaturePrefix = "sha256=";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  private readonly mentionEnqueue?: MentionFetchEnqueue;

  constructor(
    prisma: PrismaClient,
    broadcaster?: RealtimeWebhookBroadcaster,
    mentionEnqueue?: MentionFetchEnqueue
  ) {
    super(prisma, broadcaster);
    if (mentionEnqueue) {
      this.mentionEnqueue = mentionEnqueue;
    }
  }

  /**
   * @method parse
   * @description Normalizes a Threads webhook payload into an event type, a flat
   *   data object, and the related account/project/channel.
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
    const entryArr = payload.entry as Record<string, unknown>[] | undefined;
    const entry = entryArr?.[0];
    if (!entry) {
      throw AppError.badRequest("Invalid Threads webhook payload: missing entry");
    }

    const changesArr = entry.changes as Record<string, unknown>[] | undefined;
    if (!changesArr || changesArr.length === 0) {
      throw AppError.badRequest(`Unsupported Threads webhook event: ${JSON.stringify(entry)}`);
    }

    const change = changesArr[0] as Record<string, unknown>;
    const field = change.field;
    const value = (change.value ?? {}) as Record<string, unknown>;

    let eventType: WebhookEventType;
    let normalizedData: Record<string, unknown>;

    switch (field) {
      case "replies":
        eventType = "COMMENT_RECEIVED";
        normalizedData = this.parseReplyEvent(value);
        break;
      case "mentions":
        eventType = "MENTION_RECEIVED";
        normalizedData = this.parseMentionEvent(value);
        break;
      case "posts":
        eventType = "POST_PUBLISHED";
        normalizedData = this.parsePostEvent(value);
        break;
      default:
        eventType = "POST_UPDATED";
        normalizedData = { eventType: "post_updated", field, value };
    }

    const relatedEntities = await this.findRelatedEntities(entry.id as string, normalizedData);
    return { eventType, normalizedData, relatedEntities };
  }

  /**
   * @method process
   * @description Acts on a normalized Threads event: enqueues mentions for the
   *   ingest worker and reconciles a post's publish log on publish confirmation.
   */
  override async process(
    normalizedData: Record<string, unknown>,
    relatedEntities: Record<string, unknown>
  ): Promise<void> {
    const { accountId, projectId } = relatedEntities;
    if (!accountId && !projectId) {
      webhookLogger.warn({ provider: "THREADS" }, "No related account/project for Threads webhook");
      return;
    }

    switch (normalizedData.eventType) {
      case "post_published":
        await this.handlePostPublished(normalizedData, relatedEntities);
        break;
      case "mention_received":
        await this.handleMentionReceived(normalizedData, relatedEntities);
        break;
      case "reply_received":
        webhookLogger.info(
          { provider: "THREADS", replyId: normalizedData.replyId },
          "Threads reply received"
        );
        break;
      default:
        webhookLogger.info(
          { provider: "THREADS", eventType: normalizedData.eventType },
          "Threads event received"
        );
    }
  }

  private parseReplyEvent(value: Record<string, unknown>): Record<string, unknown> {
    const from = value.from as Record<string, unknown> | undefined;
    return {
      eventType: "reply_received",
      replyId: value.id,
      rootPostId: value.root_post ?? value.replied_to,
      text: value.text,
      username: from?.username,
      userId: from?.id,
      timestamp: value.timestamp ?? value.created_time,
    };
  }

  private parseMentionEvent(value: Record<string, unknown>): Record<string, unknown> {
    const from = value.from as Record<string, unknown> | undefined;
    return {
      eventType: "mention_received",
      mentionId: value.id ?? value.post_id,
      text: value.text,
      username: from?.username,
      userId: from?.id,
      timestamp: value.timestamp ?? value.created_time,
    };
  }

  private parsePostEvent(value: Record<string, unknown>): Record<string, unknown> {
    return {
      eventType: "post_published",
      threadsPostId: value.id ?? value.post_id,
      permalink: value.permalink,
      timestamp: value.timestamp ?? value.created_time,
    };
  }

  /**
   * Resolve account/project/channel from the Threads account id on the entry.
   */
  private async findRelatedEntities(
    threadsAccountId: string,
    normalizedData: Record<string, unknown>
  ): Promise<{ accountId?: string; projectId?: string; postId?: string; channelId?: string }> {
    const channel = await this.prisma.channel.findFirst({
      where: { provider: "THREADS", providerAccountId: threadsAccountId },
      include: { project: { include: { account: true } } },
    });
    if (!channel) {
      return {};
    }

    let postId: string | undefined;
    if (normalizedData.threadsPostId) {
      const publishLog = await this.prisma.publishLog.findFirst({
        where: {
          channelId: channel.id,
          provider: "THREADS",
          payload: { path: ["threads_post_id"], equals: normalizedData.threadsPostId },
        },
      });
      postId = publishLog?.postId ?? undefined;
    }

    return {
      accountId: channel.project.accountId,
      projectId: channel.projectId,
      channelId: channel.id,
      ...(postId !== undefined && { postId }),
    };
  }

  private async handlePostPublished(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const postId = entities.postId as string | undefined;
    const channelId = entities.channelId as string | undefined;
    if (!postId || !channelId) {
      return;
    }
    await this.prisma.publishLog.updateMany({
      where: { postId, channelId, provider: "THREADS" },
      data: {
        status: "OK",
        payload: {
          threads_post_id: String(data.threadsPostId ?? ""),
          permalink: String(data.permalink ?? ""),
          webhook_received_at: new Date().toISOString(),
        },
      },
    });
    await this.prisma.post.update({ where: { id: postId }, data: { status: "PUBLISHED" } });
    if (this.broadcaster) {
      await this.broadcaster.broadcastPostStatusChange(postId, "PUBLISHED", "THREADS", {
        threads_post_id: data.threadsPostId,
        permalink: data.permalink,
      });
    }
  }

  /**
   * A mention is a notification only — enqueue a fetch-before-process job for the
   * mention-ingest worker to resolve credentials, fetch, and persist.
   */
  private async handleMentionReceived(
    data: Record<string, unknown>,
    entities: Record<string, unknown>
  ): Promise<void> {
    const channelId = entities.channelId as string | undefined;
    const accountId = entities.accountId as string | undefined;
    const projectId = entities.projectId as string | undefined;
    const providerMentionId = data.mentionId as string | undefined;

    if (this.mentionEnqueue && channelId && accountId && projectId && providerMentionId) {
      await this.mentionEnqueue({
        kind: "fetch",
        channelId,
        accountId,
        projectId,
        provider: "threads",
        providerMentionId,
      });
      return;
    }

    webhookLogger.info(
      { provider: "THREADS", mention: data },
      "Threads mention received but not enqueued (missing context or no queue)"
    );
  }
}
