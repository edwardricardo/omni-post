/**
 * @file TelegramAdapter.ts
 * @description Telegram provider adapter. Implements the ProviderAdapter port
 *   from @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Publishes text,
 *   single media, media groups, and polls to channels/groups via the Bot API.
 * @layer infrastructure
 */

import type {
  ProviderAdapter,
  ProviderId,
  ProviderLimits,
  PublishInput,
  PublishReceipt,
} from "@ports/core";
import type {
  CanonicalPost,
  RenderedContent,
  ThreadPlan,
  ThreadPublishInput,
  ThreadReceipt,
  Result,
  RenderError,
  PublishError,
  ThreadError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import {
  TelegramApiClient,
  type TelegramCredentials,
  type TelegramPollConfig,
} from "./apiClient.js";

/** Maximum caption length for media messages in Telegram */
const MAX_CAPTION_LENGTH = 1024;

/** Prefix used to detect poll content in canonical post body */
const POLL_TAG_PREFIX = "poll:";

const REQUIRED_FIELDS: (keyof TelegramCredentials)[] = ["botToken", "chatId"];

const TELEGRAM_LIMITS: ProviderLimits = {
  maxChars: 4096,
  allowedMedia: ["image", "video"],
  aspectRatios: [],
  maxMediaPerPost: 10,
  threadingSupported: false,
  rateLimitHints: { burst: 30, perSeconds: 1 },
};

const TELEGRAM_METADATA: ProviderMetadata = {
  id: "telegram",
  name: "telegram",
  displayName: "Telegram",
  description: "Send messages to Telegram channels and groups via bot",
  icon: "/providers/telegram-icon.svg",
  color: "#26A5E4",
  website: "https://telegram.org",
  authType: "api_key",
  status: "active",
};

const TELEGRAM_CAPABILITIES = {
  publish: true,
  mentions: false,
  schedule: false,
  analytics: true,
  comments: false,
  replies: false,
  threading: false,
  media: true,
  images: true,
  videos: true,
};

/**
 * Factory for creating TelegramApiClient instances. Injected so tests can
 * supply a fake. Defaults to constructing a real `TelegramApiClient`.
 */
export type TelegramApiClientFactory = (credentials: TelegramCredentials) => TelegramApiClient;

const defaultClientFactory: TelegramApiClientFactory = (credentials) =>
  new TelegramApiClient(credentials);

export interface TelegramAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a TelegramApiClient given credentials. Default: real client. */
  apiClientFactory?: TelegramApiClientFactory;
}

/**
 * @class TelegramAdapter
 * @description Provider adapter for publishing content to Telegram channels
 *              and groups using the Bot API.
 */
export class TelegramAdapter implements ProviderAdapter {
  readonly id: ProviderId = "telegram";
  readonly limits: ProviderLimits = TELEGRAM_LIMITS;
  readonly capabilities = TELEGRAM_CAPABILITIES;
  readonly metadata: ProviderMetadata = TELEGRAM_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: TelegramApiClientFactory;

  constructor(deps: TelegramAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "telegram-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultClientFactory;
  }

  // ============================================================
  // Rendering
  // ============================================================

  /**
   * @method render
   * @description Render a canonical post into Telegram message format.
   *              Always returns a single-type rendered content since Telegram
   *              does not support threading.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const body = canonical.body || "";

    const pollTag = canonical.tags?.find((t) => t.startsWith(POLL_TAG_PREFIX));
    if (pollTag) {
      return this.renderPoll(body, pollTag);
    }

    if (body.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    const hasMedia = canonical.media && canonical.media.length > 0;

    if (hasMedia && body.length > MAX_CAPTION_LENGTH) {
      return err("CONTENT_TOO_LONG");
    }

    if (hasMedia && canonical.media && canonical.media.length > this.limits.maxMediaPerPost) {
      return err("VALIDATION_ERROR");
    }

    return ok({
      type: "single",
      content: {
        body,
        ...(hasMedia && canonical.media
          ? {
              media: canonical.media.map((m) => ({
                url: m.url,
                type: m.type,
                ...(m.alt && { alt: m.alt }),
              })),
            }
          : {}),
        meta: {
          parseMode: "HTML",
          ...(hasMedia && { captionLength: Math.min(body.length, MAX_CAPTION_LENGTH) }),
        },
      },
      meta: {},
    });
  }

  /**
   * @method renderPoll
   * @description Render a poll from canonical post data.
   *              Poll tag format: "poll:option1|option2|option3".
   *              The body becomes the poll question.
   */
  private renderPoll(question: string, pollTag: string): Result<RenderedContent, RenderError> {
    const optionsPart = pollTag.substring(POLL_TAG_PREFIX.length);
    const options = optionsPart.split("|").filter((o) => o.trim().length > 0);

    if (options.length < 2 || options.length > 10) {
      return err("VALIDATION_ERROR");
    }

    if (!question || question.length === 0) {
      return err("VALIDATION_ERROR");
    }

    if (question.length > 300) {
      return err("CONTENT_TOO_LONG");
    }

    return ok({
      type: "single",
      content: {
        body: question,
        meta: {
          isPoll: true,
          pollOptions: options,
        },
      },
      meta: {},
    });
  }

  // ============================================================
  // Threading (not supported)
  // ============================================================

  /**
   * @method planThread
   * @description Telegram does not support threading. Always returns an error.
   */
  planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Telegram does not support threading. Always returns an error.
   */
  async publishThread(
    _input: ThreadPublishInput,
    _credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("THREAD_INTERRUPTED");
  }

  // ============================================================
  // Credential Validation
  // ============================================================

  /**
   * @method validateCredentials
   * @description Validate bot token via getMe and verify the bot is an admin
   *              of the target chat via getChatMember.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<TelegramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH_INVALID");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);

      const botUser = await apiClient.validateCredentials();
      const memberInfo = await apiClient.getChatMember(botUser.id);
      const adminStatuses = new Set(["creator", "administrator"]);

      if (!adminStatuses.has(memberInfo.status)) {
        this.logger.error({
          provider: this.id,
          operation: "validateCredentials",
          chatId: validation.value.chatId,
          botStatus: memberInfo.status,
          error: "Bot is not an administrator",
        });
        return err("AUTH_INVALID");
      }

      return ok(undefined);
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "validateCredentials",
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof Error &&
        "status" in error &&
        (error as Record<string, unknown>).status === 401
      ) {
        return err("AUTH_EXPIRED");
      }

      return err("AUTH_INVALID");
    }
  }

  // ============================================================
  // Publishing
  // ============================================================

  /**
   * @method publish
   * @description Publish a rendered post to Telegram. Routes to sendMessage,
   *              sendPhoto, sendVideo, sendMediaGroup, or sendPoll depending
   *              on the meta + media attachments.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<TelegramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const { post } = input;
      const text = post.body || "";
      const media = post.media;
      const hasMedia = media && media.length > 0;

      const meta = post.meta as Record<string, unknown> | undefined;
      if (meta && meta.isPoll === true && Array.isArray(meta.pollOptions)) {
        return await this.publishPoll(
          apiClient,
          text,
          meta.pollOptions as string[],
          validation.value.chatId
        );
      }

      if (!hasMedia) {
        return await this.publishTextMessage(apiClient, text, validation.value.chatId);
      }

      if (media && media.length === 1) {
        const singleMedia = media[0];
        if (!singleMedia) {
          return await this.publishTextMessage(apiClient, text, validation.value.chatId);
        }
        return await this.publishSingleMedia(apiClient, singleMedia, text, validation.value.chatId);
      }

      if (media && media.length >= 2) {
        return await this.publishMediaGroup(apiClient, media, text, validation.value.chatId);
      }

      return await this.publishTextMessage(apiClient, text, validation.value.chatId);
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publish",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(mapErrorToPublishError(error));
    }
  }

  // ============================================================
  // Private publishing helpers
  // ============================================================

  /**
   * @method publishTextMessage
   * @description Send a plain text message.
   */
  private async publishTextMessage(
    apiClient: TelegramApiClient,
    text: string,
    chatId: string
  ): Promise<Result<PublishReceipt, PublishError>> {
    const result = await apiClient.sendMessage(text);

    return ok({
      providerPostId: String(result.message_id),
      url: this.buildMessageUrl(chatId, result.message_id),
      publishedAt: new Date(result.date * 1000),
    });
  }

  /**
   * @method publishSingleMedia
   * @description Send a single photo or video with optional caption.
   */
  private async publishSingleMedia(
    apiClient: TelegramApiClient,
    mediaItem: { url: string; type: "image" | "video" | "gif" },
    caption: string,
    chatId: string
  ): Promise<Result<PublishReceipt, PublishError>> {
    const truncatedCaption =
      caption.length > MAX_CAPTION_LENGTH ? caption.substring(0, MAX_CAPTION_LENGTH) : caption;

    const captionArg = truncatedCaption || undefined;

    const result =
      mediaItem.type === "video"
        ? await apiClient.sendVideo(mediaItem.url, captionArg)
        : await apiClient.sendPhoto(mediaItem.url, captionArg);

    return ok({
      providerPostId: String(result.message_id),
      url: this.buildMessageUrl(chatId, result.message_id),
      publishedAt: new Date(result.date * 1000),
    });
  }

  /**
   * @method publishMediaGroup
   * @description Send a media group (2-10 photos/videos) with optional caption.
   */
  private async publishMediaGroup(
    apiClient: TelegramApiClient,
    media: Array<{ url: string; type: "image" | "video" | "gif" }>,
    caption: string,
    chatId: string
  ): Promise<Result<PublishReceipt, PublishError>> {
    const truncatedCaption =
      caption.length > MAX_CAPTION_LENGTH ? caption.substring(0, MAX_CAPTION_LENGTH) : caption;

    const mediaItems = media.map((m) => ({
      type: m.type === "gif" ? ("image" as const) : m.type,
      url: m.url,
    }));

    const captionArg = truncatedCaption || undefined;
    const results = await apiClient.sendMediaGroup(mediaItems, captionArg);

    const firstMessage = results[0];
    if (!firstMessage) {
      return err("NETWORK");
    }

    return ok({
      providerPostId: String(firstMessage.message_id),
      url: this.buildMessageUrl(chatId, firstMessage.message_id),
      publishedAt: new Date(firstMessage.date * 1000),
    });
  }

  /**
   * @method publishPoll
   * @description Send a poll to the Telegram chat.
   */
  private async publishPoll(
    apiClient: TelegramApiClient,
    question: string,
    options: string[],
    chatId: string,
    config?: TelegramPollConfig
  ): Promise<Result<PublishReceipt, PublishError>> {
    const result = await apiClient.sendPoll(question, options, config);

    return ok({
      providerPostId: String(result.message_id),
      url: this.buildMessageUrl(chatId, result.message_id),
      publishedAt: new Date(result.date * 1000),
    });
  }

  // ============================================================
  // Analytics
  // ============================================================

  /**
   * @method fetchAnalytics
   * @description Fetches basic analytics for a Telegram channel. Uses
   *              getChatMemberCount as a member count proxy since Telegram
   *              Bot API does not expose detailed analytics.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<TelegramCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const memberCount = await apiClient.getChatMemberCount();

      return ok({
        provider: "telegram",
        channelId: q.channelId,
        memberCount,
        ...(q.since && { since: q.since.toISOString() }),
        ...(q.until && { until: q.until.toISOString() }),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "fetchAnalytics",
        channelId: q.channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return err("NETWORK");
    }
  }

  // ============================================================
  // URL Builder
  // ============================================================

  /**
   * @method buildMessageUrl
   * @description Build a deep link URL to the message in the channel.
   *              Works for public channels with @username format chatIds.
   */
  private buildMessageUrl(chatId: string, messageId: number): string {
    if (chatId.startsWith("@")) {
      const channelName = chatId.substring(1);
      return `https://t.me/${channelName}/${messageId}`;
    }

    const numericId = chatId.replace(/^-100/, "");
    return `https://t.me/c/${numericId}/${messageId}`;
  }
}

/**
 * @function createTelegramAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional apiClient factory for tests).
 */
export function createTelegramAdapter(deps: TelegramAdapterDeps = {}): TelegramAdapter {
  return new TelegramAdapter(deps);
}
