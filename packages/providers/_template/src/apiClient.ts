import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import client from "prom-client";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:template:api-client");

// Define your provider's credential interface
export interface ProviderCredentials {
  apiKey: string;
  apiSecret?: string;
  accessToken?: string;
  // Add other required credentials
}

// Define your provider's response interfaces
export interface ProviderPostResponse {
  id: string;
  text: string;
  created_at?: string;
  // Add other response fields
}

export interface ProviderUploadResponse {
  media_id: string;
  url: string;
  // Add other upload response fields
}

export interface ProviderAnalyticsResponse {
  data: Array<{
    id: string;
    metrics: {
      views: number;
      likes: number;
      shares: number;
      comments: number;
      // Add other metrics
    };
  }>;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry);

export class ProviderApiClient {
  private credentials: ProviderCredentials;
  private baseUrl = "https://api.provider.com/v1"; // Replace with actual API URL

  constructor(credentials: ProviderCredentials) {
    this.credentials = credentials;
  }

  private getHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.credentials.apiKey}`, // Adjust auth method
    };

    if (includeContentType) {
      headers["Content-Type"] = "application/json";
    }

    return headers;
  }

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
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(
          `Provider API Error: ${response.status} ${response.statusText} - ${errorText}`
        );
        (error as any).status = response.status;
        (error as any).statusText = response.statusText;
        throw error;
      }

      return response.json() as Promise<T>;
    };

    const fallback = fallbackResponse
      ? async (): Promise<T> => {
          logger.warn({ operation }, "Using fallback response for Provider API");
          return fallbackResponse;
        }
      : undefined;

    return circuitBreaker.call(
      "provider-api", // Use your provider's name instead
      operation,
      apiCall,
      [],
      {
        timeout: 15000, // Adjust timeout for your provider
        errorThresholdPercentage: 60, // Adjust based on provider reliability
        resetTimeout: 60000, // 1 minute reset
        maxRetries: 3,
        baseDelay: 2000, // 2 seconds base delay
        maxDelay: 30000, // 30 seconds max delay
        jitterEnabled: true,
        cacheEnabled: operation === "validate-credentials", // Cache credential validation
        cacheTtl: 300000, // 5 minutes cache for credentials
        ...(fallback !== undefined && { fallback }),
      }
    );
  }

  /**
   * Validate credentials by calling the provider's auth endpoint
   */
  async validateCredentials(): Promise<{ valid: boolean; user?: any }> {
    return this.makeRequest<{ valid: boolean; user?: any }>(
      "validate-credentials",
      `${this.baseUrl}/auth/me`, // Adjust endpoint
      { method: "GET" }
    );
  }

  /**
   * Post content to the provider
   */
  async postContent(
    text: string,
    mediaIds: string[] = [],
    options?: any
  ): Promise<ProviderPostResponse> {
    const postData: any = { text };

    if (mediaIds.length > 0) {
      postData.media_ids = mediaIds; // Adjust field name
    }

    // Add any provider-specific options
    if (options) {
      Object.assign(postData, options);
    }

    return this.makeRequest<ProviderPostResponse>(
      "post-content",
      `${this.baseUrl}/posts`, // Adjust endpoint
      {
        method: "POST",
        body: JSON.stringify(postData),
      }
    );
  }

  /**
   * Upload media file
   */
  async uploadMedia(mediaUrl: string): Promise<ProviderUploadResponse> {
    // First, fetch the media from the URL
    const mediaResponse = await circuitBreaker.call(
      "media-fetch",
      "download",
      async () => {
        const response = await fetch(mediaUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch media: ${response.status} ${response.statusText}`);
        }
        return response;
      },
      [],
      {
        timeout: 30000, // 30 seconds for media download
        maxRetries: 2,
        baseDelay: 1000,
        jitterEnabled: true,
      }
    );

    const mediaBuffer = await mediaResponse.arrayBuffer();
    const mediaType = mediaResponse.headers.get("content-type") || "image/jpeg";

    // Upload to provider
    const formData = new FormData();
    formData.append("media", new Blob([mediaBuffer], { type: mediaType }));

    return this.makeRequest<ProviderUploadResponse>(
      "upload-media",
      `${this.baseUrl}/media/upload`, // Adjust endpoint
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.credentials.apiKey}`,
        },
        body: formData,
      }
    );
  }

  /**
   * Get analytics data
   */
  async getAnalytics(postIds: string[]): Promise<ProviderAnalyticsResponse> {
    const params = new URLSearchParams({
      ids: postIds.join(","),
    });

    const fallbackResponse: ProviderAnalyticsResponse = {
      data: postIds.map((id) => ({
        id,
        metrics: {
          views: 0,
          likes: 0,
          shares: 0,
          comments: 0,
        },
      })),
    };

    return this.makeRequest<ProviderAnalyticsResponse>(
      "get-analytics",
      `${this.baseUrl}/analytics?${params.toString()}`, // Adjust endpoint
      { method: "GET" },
      fallbackResponse
    );
  }

  /**
   * Delete content
   */
  async deleteContent(postId: string): Promise<{ deleted: boolean }> {
    return this.makeRequest<{ deleted: boolean }>(
      "delete-content",
      `${this.baseUrl}/posts/${postId}`, // Adjust endpoint
      { method: "DELETE" }
    );
  }

  /**
   * Get circuit breaker status for provider API operations
   */
  getCircuitBreakerStatus(): Record<string, any> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * Get API metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    circuitBreaker.clearCache("provider-api");
    circuitBreaker.clearCache("media-fetch");
  }

  /**
   * Force circuit breaker state (for testing/emergency)
   */
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("provider-api", operation);
  }

  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("provider-api", operation);
  }
}
