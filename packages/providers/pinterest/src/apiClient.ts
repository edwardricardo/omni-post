/**
 * @file apiClient.ts
 * @description Pinterest API v5 client with circuit breaker protection.
 *              Handles pin creation, retrieval, analytics, user account validation,
 *              and board listing via the Pinterest REST API.
 * @layer infrastructure
 */

import {
  createExternalApiCircuitBreaker,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
  type ExternalApiOptions,
} from "@adapters/external-apis";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:pinterest:api-client");

// ============================================================
// Credentials
// ============================================================

export interface PinterestCredentials {
  accessToken: string;
  refreshToken: string;
  boardId: string;
  [key: string]: string | undefined;
}

// ============================================================
// API Response Types
// ============================================================

export interface PinterestPinResponse {
  id: string;
  title: string;
  description: string;
  link: string;
  board_id: string;
  created_at: string;
  media: {
    media_type: "image" | "video";
    images?: Record<string, { url: string; width: number; height: number }>;
  };
  alt_text?: string;
}

export interface PinterestUserResponse {
  username: string;
  account_type: "BUSINESS" | "PINNER";
  profile_image: string;
  website_url?: string;
  board_count?: number;
  pin_count?: number;
}

export interface PinterestBoardResponse {
  id: string;
  name: string;
  description: string;
  privacy: "PUBLIC" | "PROTECTED" | "SECRET";
  owner: { username: string };
  pin_count?: number;
  created_at?: string;
}

export interface PinterestBoardsListResponse {
  items: PinterestBoardResponse[];
  bookmark?: string;
}

export interface PinterestPinAnalyticsResponse {
  all: {
    lifetime_metrics: {
      IMPRESSION: number;
      SAVE: number;
      PIN_CLICK: number;
      OUTBOUND_CLICK: number;
    };
  };
}

export interface PinterestBoardSectionResponse {
  id: string;
  name: string;
}

export interface PinterestApiError {
  code: number;
  message: string;
}

// ============================================================
// Circuit Breaker Setup
// ============================================================

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

// ============================================================
// API Client
// ============================================================

/**
 * @class PinterestApiClient
 * @description Handles all HTTP communication with the Pinterest API v5.
 *              Every public method is protected by a circuit breaker.
 */
export class PinterestApiClient {
  private readonly baseUrl = "https://api.pinterest.com/v5";
  private readonly credentials: PinterestCredentials;

  constructor(credentials: PinterestCredentials) {
    this.credentials = credentials;
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * @method makeRequest
   * @description Executes an HTTP request through the circuit breaker.
   * @param operation - Logical name for circuit breaker tracking
   * @param url - Full URL to call
   * @param options - fetch() options
   * @param fallbackResponse - Optional static fallback when circuit is open
   */
  private async makeRequest<T>(
    operation: string,
    url: string,
    options: RequestInit = {},
    fallbackResponse?: T
  ): Promise<T> {
    const apiCall = async (): Promise<T> => {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.getHeaders(),
          ...(options.headers as Record<string, string> | undefined),
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: { message?: string };
        try {
          errorData = JSON.parse(errorText) as { message?: string };
        } catch {
          errorData = { message: errorText };
        }

        const error = new Error(
          `Pinterest API Error: ${response.status} ${response.statusText} - ${
            errorData.message || errorText
          }`
        );
        (error as Error & { status: number }).status = response.status;
        throw error;
      }

      return response.json() as Promise<T>;
    };

    const fallbackOpts = this.selectFallbackOpts(operation);

    const fallback = fallbackResponse
      ? async (): Promise<T> => {
          logger.warn({ operation }, "Using fallback response for Pinterest API");
          return fallbackResponse;
        }
      : undefined;

    return circuitBreaker.call("pinterest-api", operation, apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: operation === "get-user-account",
      cacheTtl: 300000,
      ...fallbackOpts,
      ...(fallback ? { fallback } : {}),
    });
  }

  /**
   * Returns the opt-in fallback preset for read operations, or an empty object
   * for writes and fail-fast ops so the default (fallbackEnabled:false) applies.
   * create-pin: write — fail-fast.
   * get-user-account: action-gating — fail-fast (Decision b/a).
   * get-pin-analytics: analytics read — ANALYTICS_CB_OPTIONS.
   * get-pin and other reads: metadata — METADATA_CB_OPTIONS.
   */
  private selectFallbackOpts(operation: string): Partial<ExternalApiOptions> {
    switch (operation) {
      case "create-pin":
      case "get-user-account":
        // Fail-fast: write ops and auth-gating reads inherit default (fallbackEnabled:false)
        return {};
      case "get-pin-analytics":
        return ANALYTICS_CB_OPTIONS;
      default:
        return METADATA_CB_OPTIONS;
    }
  }

  // ----------------------------------------------------------
  // Public API methods
  // ----------------------------------------------------------

  /**
   * @method createPin
   * @description Creates a new pin on the specified board.
   * @param params - Pin creation payload
   * @returns The created pin response
   */
  async createPin(params: {
    board_id: string;
    title?: string;
    description?: string;
    link?: string;
    media_source: {
      source_type: "image_url" | "video_id";
      url?: string;
      media_id?: string;
    };
    alt_text?: string;
  }): Promise<PinterestPinResponse> {
    return this.makeRequest<PinterestPinResponse>("create-pin", `${this.baseUrl}/pins`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * @method getPin
   * @description Retrieves a single pin by its ID.
   * @param pinId - The Pinterest pin ID
   * @returns Pin data
   */
  async getPin(pinId: string): Promise<PinterestPinResponse> {
    return this.makeRequest<PinterestPinResponse>("get-pin", `${this.baseUrl}/pins/${pinId}`, {
      method: "GET",
    });
  }

  /**
   * @method getPinAnalytics
   * @description Fetches lifetime analytics for a pin.
   * @param pinId - The Pinterest pin ID
   * @param startDate - Start date in YYYY-MM-DD format
   * @param endDate - End date in YYYY-MM-DD format
   * @returns Pin analytics with impression, save, and click metrics
   */
  async getPinAnalytics(
    pinId: string,
    startDate: string,
    endDate: string
  ): Promise<PinterestPinAnalyticsResponse> {
    const url =
      `${this.baseUrl}/pins/${pinId}/analytics` +
      `?start_date=${startDate}&end_date=${endDate}` +
      `&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK` +
      `&app_types=all`;

    const fallbackResponse: PinterestPinAnalyticsResponse = {
      all: {
        lifetime_metrics: {
          IMPRESSION: 0,
          SAVE: 0,
          PIN_CLICK: 0,
          OUTBOUND_CLICK: 0,
        },
      },
    };

    return this.makeRequest<PinterestPinAnalyticsResponse>(
      "get-pin-analytics",
      url,
      { method: "GET" },
      fallbackResponse
    );
  }

  /**
   * @method getUserAccount
   * @description Validates credentials by fetching the authenticated user's account.
   * @returns User account data
   */
  async getUserAccount(): Promise<PinterestUserResponse> {
    return this.makeRequest<PinterestUserResponse>(
      "get-user-account",
      `${this.baseUrl}/user_account`,
      { method: "GET" }
    );
  }

  /**
   * @method getBoards
   * @description Lists boards owned by the authenticated user.
   * @param pageSize - Number of boards per page (default 25, max 250)
   * @param bookmark - Pagination cursor from a previous response
   * @returns Paginated list of boards
   */
  async getBoards(pageSize = 25, bookmark?: string): Promise<PinterestBoardsListResponse> {
    let url = `${this.baseUrl}/boards?page_size=${pageSize}`;
    if (bookmark) {
      url += `&bookmark=${encodeURIComponent(bookmark)}`;
    }

    return this.makeRequest<PinterestBoardsListResponse>("get-boards", url, { method: "GET" });
  }

  /**
   * @method createBoard
   * @description Creates a new board for the authenticated user.
   * @param params - Board creation payload (name, description, privacy)
   * @returns The created board response
   */
  async createBoard(params: {
    name: string;
    description?: string;
    privacy?: "PUBLIC" | "PROTECTED" | "SECRET";
  }): Promise<PinterestBoardResponse> {
    return this.makeRequest<PinterestBoardResponse>("create-board", `${this.baseUrl}/boards`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * @method createBoardSection
   * @description Creates a new section within an existing board.
   * @param boardId - The board to add the section to
   * @param name - Section name
   * @returns The created board section response
   */
  async createBoardSection(boardId: string, name: string): Promise<PinterestBoardSectionResponse> {
    return this.makeRequest<PinterestBoardSectionResponse>(
      "create-board-section",
      `${this.baseUrl}/boards/${boardId}/sections`,
      {
        method: "POST",
        body: JSON.stringify({ name }),
      }
    );
  }

  // ----------------------------------------------------------
  // Circuit breaker utilities
  // ----------------------------------------------------------

  /**
   * @method getCircuitBreakerStatus
   * @description Returns the current state of all Pinterest circuit breakers.
   */
  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * @method getMetricsRegistry
   * @description Returns the Prometheus metrics registry for monitoring.
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * @method clearCache
   * @description Clears all cached Pinterest API responses.
   */
  clearCache(): void {
    circuitBreaker.clearCache("pinterest-api");
  }

  /**
   * @method forceCircuitBreakerOpen
   * @description Forces the circuit breaker open for a specific operation.
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("pinterest-api", operation);
  }

  /**
   * @method forceCircuitBreakerClose
   * @description Forces the circuit breaker closed for a specific operation.
   */
  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("pinterest-api", operation);
  }
}
