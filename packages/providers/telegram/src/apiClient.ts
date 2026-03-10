/**
 * @file apiClient.ts
 * @description Telegram Bot API client with circuit breaker protection.
 *              Uses native fetch to call the Telegram Bot API at
 *              https://api.telegram.org/bot{token}/{method}.
 * @layer infrastructure
 */

import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
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
      throw new Error(`Telegram API returned ok=false: ${json.description || "Unknown error"}`);
    }

    return json.result;
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
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
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
      cacheTtl: 300000,
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
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
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.SOCIAL_POST_FALLBACK,
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
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.SOCIAL_POST_FALLBACK,
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
