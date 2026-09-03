/**
 * @file telegramWebhookProcessor.ts
 * @description Telegram Webhook Processor.
 *              Handles Telegram Bot API Update objects.
 *              Verifies the secret token via X-Telegram-Bot-Api-Secret-Token header
 *              using constant-time string comparison (no HMAC — Telegram sends the
 *              token directly).
 *
 * Telegram Update types handled:
 * - message: A new message was received (maps to POST_PUBLISHED)
 * - edited_message: A message was edited (maps to POST_UPDATED)
 * - channel_post: A new post in a channel (maps to POST_PUBLISHED)
 * - callback_query: A callback button was pressed (maps to POST_ENGAGEMENT_UPDATE)
 * @layer infrastructure
 */

import type { WebhookEventType } from "@infra/prisma";
import type { ProviderName } from "@shared/types";
import { webhookLogger } from "../../lib/logger.js";
import { AppError } from "../../lib/errors/AppError.js";
import { AbstractWebhookProcessor } from "./AbstractWebhookProcessor.js";

// ============================================================
// Telegram Update payload types
// ============================================================

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface TelegramFrom {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramUpdateMessage {
  message_id: number;
  from?: TelegramFrom;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramFrom;
  message?: TelegramUpdateMessage;
  data?: string;
}

interface TelegramUpdatePayload {
  update_id: number;
  message?: TelegramUpdateMessage;
  edited_message?: TelegramUpdateMessage;
  channel_post?: TelegramUpdateMessage;
  edited_channel_post?: TelegramUpdateMessage;
  callback_query?: TelegramCallbackQuery;
}

// ============================================================
// Processor
// ============================================================

/**
 * Telegram Webhook Processor
 *
 * Processes Telegram Bot API Update objects.
 * Verification uses constant-time comparison of the secret token
 * sent in the X-Telegram-Bot-Api-Secret-Token header.
 */
export class TelegramWebhookProcessor extends AbstractWebhookProcessor {
  protected override providerId: ProviderName = "TELEGRAM";
  protected override signaturePrefix = "";
  protected override signatureEncoding: "hex" | "base64" = "hex";

  /**
   * @method verify
   * @description Verifies the Telegram webhook secret token.
   *              Telegram does not use HMAC — it sends the configured secret
   *              token directly in the X-Telegram-Bot-Api-Secret-Token header.
   *              We perform a constant-time comparison against the stored secret.
   */
  override verify(
    _payload: string,
    signature: string,
    secret: string,
    headers?: Record<string, string>
  ): boolean {
    try {
      // Telegram sends the secret token in X-Telegram-Bot-Api-Secret-Token header
      const tokenFromHeader =
        headers?.["x-telegram-bot-api-secret-token"] ||
        headers?.["X-Telegram-Bot-Api-Secret-Token"] ||
        signature;

      if (!tokenFromHeader || !secret) {
        return false;
      }

      return this.constantTimeCompare(tokenFromHeader, secret);
    } catch (error) {
      webhookLogger.error(
        { err: error, providerId: this.providerId },
        "Telegram webhook verification failed"
      );
      return false;
    }
  }

  /**
   * @method parse
   * @description Parses a Telegram Update object into normalized webhook data.
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
    const update = payload as unknown as TelegramUpdatePayload;

    if (!update.update_id) {
      throw AppError.badRequest("Invalid Telegram webhook: missing update_id");
    }

    const { eventType, normalizedData } = this.parseUpdate(update);
    const relatedEntities = await this.findRelatedEntities(update);

    return { eventType, normalizedData, relatedEntities };
  }

  /**
   * @method process
   * @description Processes a normalized Telegram webhook event.
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
    const eventType = normalizedData.telegramEventType as string;

    switch (eventType) {
      case "message":
      case "channel_post":
        webhookLogger.info(
          {
            messageId: normalizedData.messageId,
            chatId: normalizedData.chatId,
            postId: relatedEntities.postId,
          },
          "Telegram message received"
        );
        if (relatedEntities.postId) {
          await this.broadcastPostStatusChange(relatedEntities.postId, "published");
        }
        break;

      case "edited_message":
      case "edited_channel_post":
        webhookLogger.info(
          {
            messageId: normalizedData.messageId,
            chatId: normalizedData.chatId,
            postId: relatedEntities.postId,
          },
          "Telegram message edited"
        );
        if (relatedEntities.postId) {
          await this.broadcastPostStatusChange(relatedEntities.postId, "updated");
        }
        break;

      case "callback_query":
        webhookLogger.info(
          {
            callbackId: normalizedData.callbackId,
            data: normalizedData.callbackData,
            postId: relatedEntities.postId,
          },
          "Telegram callback query received"
        );
        if (relatedEntities.postId) {
          await this.broadcastEngagementUpdate(
            relatedEntities.postId,
            { interactions: 1 },
            { interactions: 1 }
          );
        }
        break;

      default:
        webhookLogger.warn({ event: eventType }, "Unknown Telegram webhook event type");
    }
  }

  // ============================================================
  // Private helpers
  // ============================================================

  /**
   * Parses a Telegram Update into event type and normalized data.
   */
  private parseUpdate(update: TelegramUpdatePayload): {
    eventType: WebhookEventType;
    normalizedData: Record<string, unknown>;
  } {
    if (update.message) {
      return {
        eventType: "POST_PUBLISHED",
        normalizedData: this.normalizeMessage(update.message, "message"),
      };
    }

    if (update.edited_message) {
      return {
        eventType: "POST_UPDATED",
        normalizedData: this.normalizeMessage(update.edited_message, "edited_message"),
      };
    }

    if (update.channel_post) {
      return {
        eventType: "POST_PUBLISHED",
        normalizedData: this.normalizeMessage(update.channel_post, "channel_post"),
      };
    }

    if (update.edited_channel_post) {
      return {
        eventType: "POST_UPDATED",
        normalizedData: this.normalizeMessage(update.edited_channel_post, "edited_channel_post"),
      };
    }

    if (update.callback_query) {
      return {
        eventType: "POST_ENGAGEMENT_UPDATE",
        normalizedData: this.normalizeCallbackQuery(update.callback_query),
      };
    }

    // Unknown update type — treat as engagement update
    return {
      eventType: "POST_ENGAGEMENT_UPDATE",
      normalizedData: {
        telegramEventType: "unknown",
        updateId: update.update_id,
      },
    };
  }

  /**
   * Normalizes a Telegram message into a standard structure.
   */
  private normalizeMessage(
    message: TelegramUpdateMessage,
    eventType: string
  ): Record<string, unknown> {
    return {
      telegramEventType: eventType,
      messageId: message.message_id,
      chatId: message.chat.id,
      chatType: message.chat.type,
      date: message.date,
      text: message.text || message.caption || "",
      ...(message.from ? { fromId: message.from.id, fromUsername: message.from.username } : {}),
      ...(message.chat.title ? { chatTitle: message.chat.title } : {}),
      ...(message.chat.username ? { chatUsername: message.chat.username } : {}),
    };
  }

  /**
   * Normalizes a Telegram callback query into a standard structure.
   */
  private normalizeCallbackQuery(query: TelegramCallbackQuery): Record<string, unknown> {
    return {
      telegramEventType: "callback_query",
      callbackId: query.id,
      fromId: query.from.id,
      fromUsername: query.from.username,
      ...(query.data ? { callbackData: query.data } : {}),
      ...(query.message
        ? {
            messageId: query.message.message_id,
            chatId: query.message.chat.id,
          }
        : {}),
    };
  }

  /**
   * Finds related OmniPost entities from Telegram update data.
   */
  private async findRelatedEntities(update: TelegramUpdatePayload): Promise<{
    accountId?: string;
    projectId?: string;
    postId?: string;
    channelId?: string;
  }> {
    // Extract chat ID from the update
    const chatId = this.extractChatId(update);
    if (!chatId) return {};

    try {
      // Find active channel (not soft-deleted) for Telegram
      const channel = await this.prisma.channel.findFirst({
        where: {
          provider: "TELEGRAM",
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

      // Try to find the post by looking at recent publish logs
      const messageId = this.extractMessageId(update);
      if (messageId) {
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
      webhookLogger.error({ error }, "Failed to find related entities for Telegram webhook");
      return {};
    }
  }

  /**
   * Extracts the chat ID from a Telegram update.
   */
  private extractChatId(update: TelegramUpdatePayload): number | null {
    if (update.message) return update.message.chat.id;
    if (update.edited_message) return update.edited_message.chat.id;
    if (update.channel_post) return update.channel_post.chat.id;
    if (update.edited_channel_post) return update.edited_channel_post.chat.id;
    if (update.callback_query?.message) return update.callback_query.message.chat.id;
    return null;
  }

  /**
   * Extracts the message ID from a Telegram update.
   */
  private extractMessageId(update: TelegramUpdatePayload): number | null {
    if (update.message) return update.message.message_id;
    if (update.edited_message) return update.edited_message.message_id;
    if (update.channel_post) return update.channel_post.message_id;
    if (update.edited_channel_post) return update.edited_channel_post.message_id;
    if (update.callback_query?.message) return update.callback_query.message.message_id;
    return null;
  }
}
