/**
 * @file apiClient.ts
 * @description LinkedIn REST API client with circuit breaker protection.
 *              Wraps all LinkedIn API v2 (rest/) endpoints used by the adapter.
 * @layer infrastructure
 */

import {
  createExternalApiCircuitBreaker,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
} from "@adapters/external-apis";
import client from "prom-client";
import { createLogger } from "@observability/logger";
import type {
  LinkedInCredentials,
  LinkedInPostPayload,
  LinkedInPostResponse,
  LinkedInProfileResponse,
  LinkedInImageUploadResponse,
  LinkedInVideoUploadResponse,
  LinkedInDocumentUploadResponse,
  LinkedInCommentResponse,
  LinkedInCommentsPage,
  LinkedInAnalyticsResponse,
} from "./types.js";

// Re-export all types for consumers that import from apiClient
export type {
  LinkedInCredentials,
  LinkedInPostPayload,
  LinkedInPostResponse,
  LinkedInProfileResponse,
  LinkedInImageUploadResponse,
  LinkedInVideoUploadResponse,
  LinkedInDocumentUploadResponse,
  LinkedInCommentResponse,
  LinkedInCommentsPage,
  LinkedInAnalyticsResponse,
  LinkedInMediaContent,
  LinkedInPollContent,
  LinkedInPollDuration,
  LinkedInPollOption,
  LinkedInDocumentContent,
  LinkedInPollPostContent,
} from "./types.js";

const logger = createLogger("provider:linkedin:api-client");

const LINKEDIN_API_BASE = "https://api.linkedin.com";
const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "Linkedin-Version": "202401",
  "X-Restli-Protocol-Version": "2.0.0",
} as const;

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

/** Standard circuit breaker options for read-type API calls. */
const READ_CB_OPTIONS = {
  timeout: 15000,
  errorThresholdPercentage: 60,
  resetTimeout: 60000,
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 30000,
  jitterEnabled: true,
} as const;

/** Circuit breaker options for media upload calls (longer timeout, fewer retries). */
const UPLOAD_CB_OPTIONS = {
  timeout: 30000,
  errorThresholdPercentage: 70,
  resetTimeout: 90000,
  maxRetries: 2,
  baseDelay: 3000,
  maxDelay: 15000,
  jitterEnabled: true,
  cacheEnabled: false,
  fallbackEnabled: false,
} as const;

/**
 * LinkedIn REST API client.
 * All requests include Linkedin-Version and X-Restli-Protocol-Version headers.
 */
export class LinkedInApiClient {
  private readonly credentials: LinkedInCredentials;

  constructor(credentials: LinkedInCredentials) {
    this.credentials = credentials;
  }

  /**
   * @method getProfile
   * @description Validates credentials by fetching the authenticated user profile.
   */
  async getProfile(): Promise<LinkedInProfileResponse> {
    return circuitBreaker.call(
      "linkedin-api",
      "get-profile",
      async () => this.request<LinkedInProfileResponse>("GET", "/rest/userinfo"),
      [],
      {
        ...READ_CB_OPTIONS,
        cacheEnabled: true,
        ...METADATA_CB_OPTIONS,
      }
    );
  }

  /**
   * @method createPost
   * @description Creates a new post via POST /rest/posts.
   * @param payload - The full LinkedIn post payload
   * @returns Created post ID and activity URN
   */
  async createPost(payload: LinkedInPostPayload): Promise<LinkedInPostResponse> {
    const apiCall = async (): Promise<LinkedInPostResponse> => {
      const response = await fetch(`${LINKEDIN_API_BASE}/rest/posts`, {
        method: "POST",
        headers: { ...COMMON_HEADERS, Authorization: `Bearer ${this.credentials.accessToken}` },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw await this.buildHttpError(response, "LinkedIn createPost failed");
      }

      const postUrn = response.headers.get("x-restli-id") || "";
      const activityHeader = response.headers.get("x-linkedin-id");

      return {
        id: postUrn,
        ...(activityHeader ? { activity: activityHeader } : {}),
      };
    };

    return circuitBreaker.call("linkedin-api", "create-post", apiCall, [], {
      ...READ_CB_OPTIONS,
      cacheEnabled: false,
    });
  }

  /**
   * @method initializeImageUpload
   * @description Initializes a LinkedIn image upload via POST /rest/images?action=initializeUpload.
   * @param ownerUrn - The author URN (person or organization)
   */
  async initializeImageUpload(ownerUrn: string): Promise<LinkedInImageUploadResponse> {
    return circuitBreaker.call(
      "linkedin-api",
      "init-image-upload",
      async () =>
        this.request<LinkedInImageUploadResponse>("POST", "/rest/images?action=initializeUpload", {
          initializeUploadRequest: { owner: ownerUrn },
        }),
      [],
      UPLOAD_CB_OPTIONS
    );
  }

  /**
   * @method initializeVideoUpload
   * @description Initializes a LinkedIn video upload via POST /rest/videos?action=initializeUpload.
   * @param ownerUrn - The author URN (person or organization)
   * @param fileSizeBytes - Size of the video file in bytes
   */
  async initializeVideoUpload(
    ownerUrn: string,
    fileSizeBytes: number
  ): Promise<LinkedInVideoUploadResponse> {
    return circuitBreaker.call(
      "linkedin-api",
      "init-video-upload",
      async () =>
        this.request<LinkedInVideoUploadResponse>("POST", "/rest/videos?action=initializeUpload", {
          initializeUploadRequest: {
            owner: ownerUrn,
            fileSizeBytes,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      [],
      UPLOAD_CB_OPTIONS
    );
  }

  /**
   * @method uploadMediaBinary
   * @description Uploads raw binary data to the LinkedIn upload URL from initializeUpload.
   * @param uploadUrl - The pre-signed upload URL from LinkedIn
   * @param data - The binary data as ArrayBuffer to upload
   * @param contentType - MIME type of the media (e.g. "image/jpeg")
   */
  async uploadMediaBinary(
    uploadUrl: string,
    data: ArrayBuffer,
    contentType: string
  ): Promise<void> {
    const apiCall = async (): Promise<void> => {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          Authorization: `Bearer ${this.credentials.accessToken}`,
        },
        body: data,
      });

      if (!response.ok) {
        throw await this.buildHttpError(response, "LinkedIn media binary upload failed");
      }
    };

    return circuitBreaker.call("linkedin-api", "upload-media-binary", apiCall, [], {
      ...UPLOAD_CB_OPTIONS,
      timeout: 120000,
    });
  }

  /**
   * @method getComments
   * @description Fetches comments on a post via GET /rest/socialActions/{postUrn}/comments.
   */
  async getComments(
    postUrn: string,
    start: number = 0,
    count: number = 20
  ): Promise<LinkedInCommentsPage> {
    const encodedUrn = encodeURIComponent(postUrn);
    return circuitBreaker.call(
      "linkedin-api",
      "get-comments",
      async () =>
        this.request<LinkedInCommentsPage>(
          "GET",
          `/rest/socialActions/${encodedUrn}/comments?start=${start}&count=${count}`
        ),
      [],
      {
        ...READ_CB_OPTIONS,
        cacheEnabled: true,
        ...METADATA_CB_OPTIONS,
      }
    );
  }

  /**
   * @method postComment
   * @description Posts a comment on a post via POST /rest/socialActions/{postUrn}/comments.
   * @param postUrn - The post identifier URN
   * @param text - The comment body text
   * @param parentCommentUrn - Optional parent comment URN for threaded replies
   */
  async postComment(
    postUrn: string,
    text: string,
    parentCommentUrn?: string
  ): Promise<LinkedInCommentResponse> {
    const encodedUrn = encodeURIComponent(postUrn);
    const apiCall = async (): Promise<LinkedInCommentResponse> => {
      const body: Record<string, unknown> = {
        actor: this.credentials.organizationUrn || this.credentials.personUrn,
        message: { text },
        object: postUrn,
      };
      if (parentCommentUrn) {
        body.parentComment = parentCommentUrn;
      }
      return this.request<LinkedInCommentResponse>(
        "POST",
        `/rest/socialActions/${encodedUrn}/comments`,
        body
      );
    };

    return circuitBreaker.call("linkedin-api", "post-comment", apiCall, [], {
      ...READ_CB_OPTIONS,
      cacheEnabled: false,
      fallbackEnabled: false,
    });
  }

  /**
   * @method getPostAnalytics
   * @description Fetches social metadata / engagement stats for a post.
   * @param postUrn - The post URN to fetch analytics for
   */
  async getPostAnalytics(postUrn: string): Promise<LinkedInAnalyticsResponse> {
    const encodedUrn = encodeURIComponent(postUrn);

    const fallback = async (): Promise<LinkedInAnalyticsResponse> => {
      logger.warn("Using fallback response for LinkedIn Analytics");
      return {
        totalShareStatistics: {
          shareCount: 0,
          likeCount: 0,
          commentCount: 0,
          impressionCount: 0,
          uniqueImpressionsCount: 0,
          clickCount: 0,
          engagement: 0,
        },
      };
    };

    return circuitBreaker.call(
      "linkedin-api",
      "get-analytics",
      async () =>
        this.request<LinkedInAnalyticsResponse>(
          "GET",
          `/rest/organizationalEntityShareStatistics?q=organizationalEntity&shares=List(${encodedUrn})`
        ),
      [],
      {
        ...READ_CB_OPTIONS,
        cacheEnabled: true,
        ...ANALYTICS_CB_OPTIONS,
        fallback,
      }
    );
  }

  /**
   * @method initializeDocumentUpload
   * @description Initializes a LinkedIn document upload (PDF/PPT/DOC) via POST /rest/documents.
   * @param ownerUrn - The author URN (person or organization)
   */
  async initializeDocumentUpload(ownerUrn: string): Promise<LinkedInDocumentUploadResponse> {
    return circuitBreaker.call(
      "linkedin-api",
      "init-document-upload",
      async () =>
        this.request<LinkedInDocumentUploadResponse>(
          "POST",
          "/rest/documents?action=initializeUpload",
          { initializeUploadRequest: { owner: ownerUrn } }
        ),
      [],
      UPLOAD_CB_OPTIONS
    );
  }

  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }
  static getMetricsRegistry(): client.Registry {
    return registry;
  }
  clearCache(): void {
    circuitBreaker.clearCache("linkedin-api");
  }
  forceCircuitBreakerOpen(operation: string): boolean {
    return circuitBreaker.forceOpen("linkedin-api", operation);
  }
  forceCircuitBreakerClose(operation: string): boolean {
    return circuitBreaker.forceClose("linkedin-api", operation);
  }

  /**
   * @method request
   * @description Generic HTTP request helper with standard LinkedIn headers.
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${LINKEDIN_API_BASE}${path}`;
    const headers: Record<string, string> = {
      ...COMMON_HEADERS,
      Authorization: `Bearer ${this.credentials.accessToken}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw await this.buildHttpError(response, "LinkedIn API request failed");
    }

    const contentLength = response.headers.get("content-length");
    if (response.status === 204 || contentLength === "0") {
      return {} as T;
    }

    const text = await response.text();
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  /**
   * @method buildHttpError
   * @description Creates an Error with an attached status code from a failed HTTP response.
   */
  private async buildHttpError(response: Response, context: string): Promise<Error> {
    const errorBody = await response.text();
    logger.error({ status: response.status, body: errorBody }, context);
    return Object.assign(new Error(`LinkedIn API error: ${response.status} - ${errorBody}`), {
      status: response.status,
    });
  }
}
