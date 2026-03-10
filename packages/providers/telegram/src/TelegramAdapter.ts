/**
 * @file TelegramAdapter.ts
 * @description Telegram provider adapter. Publishes to channels/groups via Bot API.
 * @layer infrastructure
 */

import {
  AbstractProviderAdapter,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import type { ProviderId, ProviderLimits, PublishInput, PublishReceipt } from "@ports/core";
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
  TelegramApiClient,
  type TelegramCredentials,
  type TelegramPollConfig,
} from "./apiClient.js";

/** Maximum caption length for media messages in Telegram */
const MAX_CAPTION_LENGTH = 1024;

/** Prefix used to detect poll content in canonical post body */
const POLL_TAG_PREFIX = "poll:";

/**
 * @class TelegramAdapter
 * @description Provider adapter for publishing content to Telegram channels
 *              and groups using the Bot API.
 */
export class TelegramAdapter extends AbstractProviderAdapter<TelegramCredentials> {
  readonly id: ProviderId = "telegram";

  readonly metadata: ProviderMetadata = {
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

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 4096,
    allowedMedia: ["image", "video"],
    aspectRatios: [],
    maxMediaPerPost: 10,
    threadingSupported: false,
    rateLimitHints: { burst: 30, perSeconds: 1 },
  };

  readonly capabilities = {
    publish: true,
    schedule: false,
    analytics: true,
    comments: false,
    replies: false,
    threading: false,
    media: true,
    images: true,
    videos: true,
  };

  protected readonly requiredCredentialFields: (keyof TelegramCredentials)[] = [
    "botToken",
    "chatId",
  ];

  // ============================================================
  // Abstract method implementations
  // ============================================================

  /**
   * @method getCredentialsFromEnvironment
   * @description Retrieve Telegram credentials from environment variables.
   * @returns Result with credentials or AUTH error.
   */
  protected getCredentialsFromEnvironment(): Result<TelegramCredentials, "AUTH"> {
    const credentials: TelegramCredentials = {
      botToken: process.env.TELEGRAM_BOT_TOKEN || "placeholder",
      chatId: process.env.TELEGRAM_CHAT_ID || "placeholder",
    };

    if (credentials.botToken === "placeholder" || credentials.chatId === "placeholder") {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * @method createApiClient
   * @description Instantiate a TelegramApiClient with the given credentials.
   */
  protected createApiClient(credentials: TelegramCredentials): TelegramApiClient {
    return new TelegramApiClient(credentials);
  }

  // ============================================================
  // Rendering
  // ============================================================

  /**
   * @method render
   * @description Render a canonical post into Telegram message format.
   *              Always returns a single-type rendered content since Telegram
   *              does not support threading.
   * @param canonical - The platform-agnostic post to render.
   * @returns Rendered content ready for publishing.
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const body = canonical.body || "";

    // Detect poll content: tags starting with "poll:" indicate a poll
    const pollTag = canonical.tags?.find((t) => t.startsWith(POLL_TAG_PREFIX));
    if (pollTag) {
      return this.renderPoll(body, pollTag);
    }

    if (body.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    const hasMedia = canonical.media && canonical.media.length > 0;

    // For media messages, caption is limited to 1024 chars
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
   *              Poll tag format: "poll:option1|option2|option3"
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
  override planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Telegram does not support threading. Always returns an error.
   */
  override async publishThread(
    _input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("THREAD_INTERRUPTED");
  }

  // ============================================================
  // Publishing
  // ============================================================

  /**
   * @method publish
   * @description Publish a rendered post to Telegram.
   *              Routes to sendMessage, sendPhoto, sendVideo, or sendMediaGroup
   *              depending on the media attachments.
   * @param input - The publish input containing channel ID, rendered post, and dedupe key.
   * @returns Receipt with the Telegram message ID on success.
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const { post } = input;
      const text = post.body || "";
      const media = post.media;
      const hasMedia = media && media.length > 0;

      // Check for poll content
      const meta = post.meta as Record<string, unknown> | undefined;
      if (meta && meta.isPoll === true && Array.isArray(meta.pollOptions)) {
        return await this.publishPoll(
          apiClient,
          text,
          meta.pollOptions as string[],
          credentials.value.chatId
        );
      }

      // Route to the appropriate Telegram API method
      if (!hasMedia) {
        return await this.publishTextMessage(apiClient, text, credentials.value.chatId);
      }

      if (media && media.length === 1) {
        const singleMedia = media[0];
        if (!singleMedia) {
          return await this.publishTextMessage(apiClient, text, credentials.value.chatId);
        }
        return await this.publishSingleMedia(
          apiClient,
          singleMedia,
          text,
          credentials.value.chatId
        );
      }

      if (media && media.length >= 2) {
        return await this.publishMediaGroup(apiClient, media, text, credentials.value.chatId);
      }

      // Fallback to text message
      return await this.publishTextMessage(apiClient, text, credentials.value.chatId);
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  // ============================================================
  // Credential Validation
  // ============================================================

  /**
   * @method validateCredentials
   * @description Validate bot token via getMe and verify the bot is an admin
   *              of the target chat via getChatMember.
   * @param creds - Credentials object to validate.
   * @returns Result indicating whether the credentials are valid.
   */
  override async validateCredentials(
    creds: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const structureResult = this.validateCredentialStructure(creds);
    if (!structureResult.ok) {
      return err("AUTH_INVALID");
    }

    const credentials = structureResult.value;

    try {
      const apiClient = this.createApiClient(credentials);

      // Step 1: Validate bot token
      const botUser = await apiClient.validateCredentials();

      // Step 2: Verify bot is admin of the chat
      const memberInfo = await apiClient.getChatMember(botUser.id);
      const adminStatuses = new Set(["creator", "administrator"]);

      if (!adminStatuses.has(memberInfo.status)) {
        this.logError("validateCredentials", new Error("Bot is not an administrator"), {
          chatId: credentials.chatId,
          botStatus: memberInfo.status,
        });
        return err("AUTH_INVALID");
      }

      return ok(undefined);
    } catch (error: unknown) {
      this.logError("validateCredentials", error);

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
   * @description Fetches basic analytics for a Telegram channel.
   *              Uses getChatMemberCount as a member count proxy since
   *              Telegram Bot API does not expose detailed analytics.
   * @param q - Query containing channelId, since, and until
   * @returns Analytics data with member count or error
   */
  override async fetchAnalytics(q: {
    channelId: string;
    since?: Date;
    until?: Date;
  }): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const credentials = await this.getCredentials(q.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const memberCount = await apiClient.getChatMemberCount();

      return ok({
        provider: "telegram",
        channelId: q.channelId,
        memberCount,
        ...(q.since && { since: q.since.toISOString() }),
        ...(q.until && { until: q.until.toISOString() }),
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: q.channelId });
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
    // Public channels have chatId like "@channelname"
    if (chatId.startsWith("@")) {
      const channelName = chatId.substring(1);
      return `https://t.me/${channelName}/${messageId}`;
    }

    // For numeric chat IDs (private channels/groups), use the c/ format
    // Strip leading -100 prefix used by Telegram for supergroups
    const numericId = chatId.replace(/^-100/, "");
    return `https://t.me/c/${numericId}/${messageId}`;
  }
}

// Export singleton instance for backward compatibility
export const telegramAdapter = new TelegramAdapter();
