/**
 * @file apiClient.ts
 * @description Telegram Bot API client with circuit breaker protection.
 *              Uses native fetch to call the Telegram Bot API at
 *              https://api.telegram.org/bot{token}/{method}.
 * @layer infrastructure
 */

import {
  createExternalApiCircuitBreaker,
  hashCallScope,
  METADATA_CB_OPTIONS,
} from "@adapters/external-apis";
import client from "prom-client";
// ============================================================
// Types
// ============================================================

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
  [key: string]: string | undefined;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

export interface TelegramChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TelegramUser;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; title?: string; type: string };
  date: number;
  text?: string;
  caption?: string;
}

export interface TelegramMessageResponse {
  ok: boolean;
  result: {
    message_id: number;
    chat: { id: number; type: string };
    date: number;
    text?: string;
    document?: { file_id: string; file_name?: string };
    audio?: { file_id: string; duration: number };
    poll?: { id: string; question: string; options: Array<{ text: string; voter_count: number }> };
  };
}

export interface TelegramInlineKeyboard {
  inline_keyboard: Array<
    Array<{
      text: string;
      callback_data?: string;
      url?: string;
    }>
  >;
}

export interface TelegramPollConfig {
  isAnonymous?: boolean;
  type?: "regular" | "quiz";
  allowsMultipleAnswers?: boolean;
  correctOptionId?: number;
  openPeriod?: number;
}

export interface TelegramAudioConfig {
  caption?: string;
  duration?: number;
  performer?: string;
  title?: string;
}

export interface TelegramMediaGroupMessage {
  message_id: number;
  chat: { id: number; title?: string; type: string };
  date: number;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
  error_code?: number;
}

interface InputMediaPhoto {
  type: "photo";
  media: string;
  caption?: string;
  parse_mode?: string;
}

interface InputMediaVideo {
  type: "video";
  media: string;
  caption?: string;
  parse_mode?: string;
}

type InputMedia = InputMediaPhoto | InputMediaVideo;

// ============================================================
// Circuit Breaker Setup
// ============================================================

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const BASE_URL = "https://api.telegram.org";

// ============================================================
// TelegramApiClient
// ============================================================

/**
 * @class TelegramApiClient
 * @description HTTP client for the Telegram Bot API with circuit breaker
 *              protection on every outbound call.
 */
export class TelegramApiClient {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(credentials: TelegramCredentials) {
    this.botToken = credentials.botToken;
    this.chatId = credentials.chatId;
  }

  // ----------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------

  /**
   * @method callApi
   * @description Execute a Telegram Bot API method via POST with JSON body.
   */
  private async callApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const url = `${BASE_URL}/bot${this.botToken}/${method}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorObj = new Error(`Telegram API error ${response.status}: ${errorText}`) as Error & {
        status: number;
      };
      errorObj.status = response.status;
      throw errorObj;
    }

    const json = (await response.json()) as TelegramApiResponse<T>;

    if (!json.ok) {
      throw this.buildOkFalseError(json);
    }

    return json.result;
  }

  /**
   * @method buildOkFalseError
   * @description Builds a structured error from a 200-wrapped Telegram failure
   *   body `{ok:false, error_code, description}`, surfacing `error_code` (mirrored
   *   onto `status`) so the adapter can classify 401→AUTH / 403→VALIDATION /
   *   429→RATE_LIMIT / 5xx→NETWORK instead of mis-handling it as NETWORK.
   * @param json - The parsed `{ok:false}` Telegram API response.
   * @returns The structured error to throw.
   */
  private buildOkFalseError<T>(
    json: TelegramApiResponse<T>
  ): Error & { error_code?: number; status?: number } {
    const code = typeof json.error_code === "number" ? json.error_code : undefined;
    const message = `Telegram API returned ok=false (${code ?? "no code"}): ${
      json.description || "Unknown error"
    }`;
    const error = new Error(message) as Error & { error_code?: number; status?: number };
    if (code !== undefined) {
      error.error_code = code;
      error.status = code;
    }
    return error;
  }

  // ----------------------------------------------------------
  // Public API methods
  // ----------------------------------------------------------

  /**
   * @method validateCredentials
   * @description Validate bot token via getMe endpoint.
   * @returns Bot user information on success.
   */
  async validateCredentials(): Promise<TelegramUser> {
    const apiCall = async (): Promise<TelegramUser> => {
      return this.callApi<TelegramUser>("getMe", {});
    };

    return circuitBreaker.call("telegram-api", "validate-credentials", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000,
      // PII (bot identity): scope by the bot token so bot B never receives
      // bot A's cached getMe payload or shares A's breaker instance.
      cacheKeyDiscriminant: hashCallScope(this.botToken),
    });
  }

  /**
   * @method getChatMember
   * @description Verify that the bot is an administrator of the target chat.
   * @param botUserId - The bot's own user ID (from getMe).
   * @returns Chat member information including status.
   */
  async getChatMember(botUserId: number): Promise<TelegramChatMember> {
    const apiCall = async (): Promise<TelegramChatMember> => {
      return this.callApi<TelegramChatMember>("getChatMember", {
        chat_id: this.chatId,
        user_id: botUserId,
      });
    };

    return circuitBreaker.call("telegram-api", "get-chat-member", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // PII (chat membership): scope by bot token + chat + the queried bot user
      // id so distinct chats/users never collide and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId, botUserId),
    });
  }

  /**
   * @method sendMessage
   * @description Send a text message to the configured chat.
   * @param text - Message text (up to 4096 characters).
   * @param parseMode - Parse mode for formatting (default: "HTML").
   * @returns The sent message object.
   */
  async sendMessage(text: string, parseMode: string = "HTML"): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      return this.callApi<TelegramMessage>("sendMessage", {
        chat_id: this.chatId,
        text,
        parse_mode: parseMode,
      });
    };

    return circuitBreaker.call("telegram-api", "send-message", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op (stays uncached): STATE-only partition so bot A's failures
      // never open bot B's circuit for this operation (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method sendPhoto
   * @description Send a photo with an optional caption.
   * @param photoUrl - URL of the photo to send.
   * @param caption - Optional caption (up to 1024 characters).
   * @returns The sent message object.
   */
  async sendPhoto(photoUrl: string, caption?: string): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        photo: photoUrl,
        parse_mode: "HTML",
      };
      if (caption) {
        body.caption = caption;
      }
      return this.callApi<TelegramMessage>("sendPhoto", body);
    };

    return circuitBreaker.call("telegram-api", "send-photo", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method sendVideo
   * @description Send a video with an optional caption.
   * @param videoUrl - URL of the video to send.
   * @param caption - Optional caption (up to 1024 characters).
   * @returns The sent message object.
   */
  async sendVideo(videoUrl: string, caption?: string): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        video: videoUrl,
        parse_mode: "HTML",
      };
      if (caption) {
        body.caption = caption;
      }
      return this.callApi<TelegramMessage>("sendVideo", body);
    };

    return circuitBreaker.call("telegram-api", "send-video", apiCall, [], {
      timeout: 60000,
      errorThresholdPercentage: 70,
      resetTimeout: 90000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method sendMediaGroup
   * @description Send a group of photos and/or videos (2-10 items).
   * @param mediaItems - Array of media items with type and URL.
   * @param caption - Optional caption for the first item (up to 1024 characters).
   * @returns Array of sent message objects.
   */
  async sendMediaGroup(
    mediaItems: Array<{ type: "image" | "video"; url: string }>,
    caption?: string
  ): Promise<TelegramMediaGroupMessage[]> {
    const apiCall = async (): Promise<TelegramMediaGroupMessage[]> => {
      const media: InputMedia[] = mediaItems.map((item, index) => {
        const base: InputMedia =
          item.type === "video"
            ? { type: "video", media: item.url }
            : { type: "photo", media: item.url };

        // Caption only on the first item
        if (index === 0 && caption) {
          base.caption = caption;
          base.parse_mode = "HTML";
        }

        return base;
      });

      return this.callApi<TelegramMediaGroupMessage[]>("sendMediaGroup", {
        chat_id: this.chatId,
        media,
      });
    };

    return circuitBreaker.call("telegram-api", "send-media-group", apiCall, [], {
      timeout: 60000,
      errorThresholdPercentage: 70,
      resetTimeout: 90000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  // ----------------------------------------------------------
  // Poll, Document, Audio
  // ----------------------------------------------------------

  /**
   * @method sendPoll
   * @description Send a poll to the configured chat.
   * @param question - Poll question (1-300 characters).
   * @param options - Poll options (2-10 items, each 1-100 characters).
   * @param config - Optional poll configuration.
   * @returns The sent message with poll data.
   */
  async sendPoll(
    question: string,
    options: string[],
    config?: TelegramPollConfig
  ): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        question,
        options: JSON.stringify(options),
      };
      if (config) {
        if (config.isAnonymous !== undefined) body.is_anonymous = config.isAnonymous;
        if (config.type) body.type = config.type;
        if (config.allowsMultipleAnswers !== undefined)
          body.allows_multiple_answers = config.allowsMultipleAnswers;
        if (config.correctOptionId !== undefined) body.correct_option_id = config.correctOptionId;
        if (config.openPeriod !== undefined) body.open_period = config.openPeriod;
      }
      return this.callApi<TelegramMessage>("sendPoll", body);
    };

    return circuitBreaker.call("telegram-api", "send-poll", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method sendDocument
   * @description Send a document (PDF, ZIP, etc.) to the configured chat.
   * @param documentUrl - URL of the document to send.
   * @param caption - Optional caption (up to 1024 characters).
   * @returns The sent message object.
   */
  async sendDocument(documentUrl: string, caption?: string): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        document: documentUrl,
        parse_mode: "HTML",
      };
      if (caption) {
        body.caption = caption;
      }
      return this.callApi<TelegramMessage>("sendDocument", body);
    };

    return circuitBreaker.call("telegram-api", "send-document", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method sendAudio
   * @description Send an audio file to the configured chat.
   * @param audioUrl - URL of the audio file to send.
   * @param config - Optional audio configuration (caption, duration, performer, title).
   * @returns The sent message object.
   */
  async sendAudio(audioUrl: string, config?: TelegramAudioConfig): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        audio: audioUrl,
        parse_mode: "HTML",
      };
      if (config) {
        if (config.caption) body.caption = config.caption;
        if (config.duration !== undefined) body.duration = config.duration;
        if (config.performer) body.performer = config.performer;
        if (config.title) body.title = config.title;
      }
      return this.callApi<TelegramMessage>("sendAudio", body);
    };

    return circuitBreaker.call("telegram-api", "send-audio", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 15000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  // ----------------------------------------------------------
  // Edit, Delete, Pin
  // ----------------------------------------------------------

  /**
   * @method editMessageText
   * @description Edit the text of an existing message.
   * @param messageId - ID of the message to edit.
   * @param text - New text content.
   * @param replyMarkup - Optional inline keyboard markup.
   * @returns The edited message object.
   */
  async editMessageText(
    messageId: number,
    text: string,
    replyMarkup?: TelegramInlineKeyboard
  ): Promise<TelegramMessage> {
    const apiCall = async (): Promise<TelegramMessage> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
      };
      if (replyMarkup) {
        body.reply_markup = replyMarkup;
      }
      return this.callApi<TelegramMessage>("editMessageText", body);
    };

    return circuitBreaker.call("telegram-api", "edit-message-text", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method deleteMessage
   * @description Delete a message from the chat.
   * @param messageId - ID of the message to delete.
   * @returns Boolean indicating success.
   */
  async deleteMessage(messageId: number): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      return this.callApi<boolean>("deleteMessage", {
        chat_id: this.chatId,
        message_id: messageId,
      });
    };

    return circuitBreaker.call("telegram-api", "delete-message", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  /**
   * @method pinChatMessage
   * @description Pin a message in the chat.
   * @param messageId - ID of the message to pin.
   * @param disableNotification - Whether to disable the pin notification.
   * @returns Boolean indicating success.
   */
  async pinChatMessage(messageId: number, disableNotification?: boolean): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      const body: Record<string, unknown> = {
        chat_id: this.chatId,
        message_id: messageId,
      };
      if (disableNotification !== undefined) {
        body.disable_notification = disableNotification;
      }
      return this.callApi<boolean>("pinChatMessage", body);
    };

    return circuitBreaker.call("telegram-api", "pin-chat-message", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  // ----------------------------------------------------------
  // Analytics proxy
  // ----------------------------------------------------------

  /**
   * @method getChatMemberCount
   * @description Get the number of members in the configured chat.
   * @returns The member count.
   */
  async getChatMemberCount(): Promise<number> {
    const apiCall = async (): Promise<number> => {
      return this.callApi<number>("getChatMemberCount", {
        chat_id: this.chatId,
      });
    };

    return circuitBreaker.call("telegram-api", "get-chat-member-count", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // PII (member count): scope by bot token + chat so bot B never receives
      // bot A's cached count or shares A's breaker instance.
      cacheKeyDiscriminant: hashCallScope(this.botToken, this.chatId),
    });
  }

  // ----------------------------------------------------------
  // Monitoring helpers
  // ----------------------------------------------------------

  /**
   * @method getCircuitBreakerStatus
   * @description Get current circuit breaker status for all Telegram API operations.
   */
  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * @method getMetricsRegistry
   * @description Get Prometheus metrics registry for monitoring.
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * @method clearCache
   * @description Clear cached API responses.
   */
  clearCache(): void {
    circuitBreaker.clearCache("telegram-api");
  }

  /**
   * @method forceCircuitBreakerOpen
   * @description Force circuit breaker to OPEN state (for testing/emergency).
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("telegram-api", operation);
  }

  /**
   * @method forceCircuitBreakerClose
   * @description Force circuit breaker to CLOSED state (for testing/emergency).
   */
  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("telegram-api", operation);
  }
}
