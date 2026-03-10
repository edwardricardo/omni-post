/**
 * @file PinterestAdapter.ts
 * @description Pinterest provider adapter. Extends AbstractProviderAdapter to
 *              publish image/video pins, validate credentials, and fetch analytics
 *              via the Pinterest API v5. Threading is not supported.
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
import { PinterestApiClient, type PinterestCredentials } from "./apiClient.js";

// ============================================================
// Constants
// ============================================================

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

// ============================================================
// Pinterest Adapter
// ============================================================

/**
 * @class PinterestAdapter
 * @description Adapter for publishing content to Pinterest as image or video pins.
 *              Pinterest does not support threading; planThread and publishThread
 *              return errors.
 */
export class PinterestAdapter extends AbstractProviderAdapter<PinterestCredentials> {
  readonly id: ProviderId = "pinterest";

  readonly metadata: ProviderMetadata = {
    id: "pinterest",
    name: "pinterest",
    displayName: "Pinterest",
    description: "Create and share image and video pins on Pinterest boards",
    icon: "/providers/pinterest-icon.svg",
    color: "#E60023",
    website: "https://pinterest.com",
    authType: "oauth",
    requiredScopes: [
      "boards:read",
      "boards:write",
      "pins:read",
      "pins:write",
      "user_accounts:read",
    ],
    status: "active",
  };

  readonly constraints: ProviderConstraints = {
    businessAccountRequired: false,
  };

  readonly limits: ProviderLimits = {
    maxChars: MAX_DESCRIPTION_LENGTH,
    maxMediaPerPost: 1,
    allowedMedia: ["image", "video"],
    aspectRatios: ["1:1", "4:5", "3:2"],
    maxVideoDuration: 900, // 15 minutes
    threadingSupported: false,
    rateLimitHints: { burst: 100, perSeconds: 1 },
  };

  readonly capabilities = {
    publish: true,
    schedule: true,
    analytics: true,
    comments: false,
    replies: false,
    threading: false,
  };

  protected readonly requiredCredentialFields: (keyof PinterestCredentials)[] = [
    "accessToken",
    "refreshToken",
    "boardId",
  ];

  // ----------------------------------------------------------
  // Credential helpers
  // ----------------------------------------------------------

  /**
   * @method getCredentialsFromEnvironment
   * @description Reads Pinterest credentials from environment variables.
   * @returns Result with credentials or AUTH error
   */
  protected getCredentialsFromEnvironment(): Result<PinterestCredentials, "AUTH"> {
    const credentials: PinterestCredentials = {
      accessToken: process.env.PINTEREST_ACCESS_TOKEN || "placeholder",
      refreshToken: process.env.PINTEREST_REFRESH_TOKEN || "placeholder",
      boardId: process.env.PINTEREST_BOARD_ID || "placeholder",
    };

    if (
      credentials.accessToken === "placeholder" ||
      credentials.refreshToken === "placeholder" ||
      credentials.boardId === "placeholder"
    ) {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * @method createApiClient
   * @description Instantiates a PinterestApiClient with the given credentials.
   * @param credentials - Validated Pinterest credentials
   * @returns A configured PinterestApiClient
   */
  protected createApiClient(credentials: PinterestCredentials): PinterestApiClient {
    return new PinterestApiClient(credentials);
  }

  /**
   * @method testCredentials
   * @description Validates credentials by calling GET /v5/user_account.
   * @param apiClient - PinterestApiClient instance
   */
  protected override async testCredentials(apiClient: PinterestApiClient): Promise<void> {
    await apiClient.getUserAccount();
  }

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  /**
   * @method render
   * @description Renders a canonical post into a Pinterest pin payload.
   *              Extracts title from the first line or truncates the body.
   *              Only single-pin rendering is supported.
   * @param canonical - The platform-agnostic post to render
   * @returns Result with rendered content or a render error
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Pinterest requires at least one media item
    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR");
    }

    const media = canonical.media[0];
    if (!media) {
      return err("VALIDATION_ERROR");
    }

    // Validate media type
    if (!this.limits.allowedMedia.includes(media.type)) {
      return err("UNSUPPORTED_MEDIA");
    }

    // Extract title: use first line or first sentence, capped at MAX_TITLE_LENGTH
    const { title, description } = this.extractTitleAndDescription(canonical.body);

    return ok({
      type: "single",
      content: {
        body: description,
        text: description,
        media: [
          {
            url: media.url,
            type: media.type,
            ...(media.alt ? { alt: media.alt } : {}),
          },
        ],
        meta: {
          title,
          boardId: undefined, // Resolved at publish time from credentials
          ...(canonical.media[0]?.alt ? { altText: canonical.media[0].alt } : {}),
        },
      },
      meta: {
        pinType: media.type === "video" ? "video" : "image",
      },
    });
  }

  // ----------------------------------------------------------
  // Threading (not supported)
  // ----------------------------------------------------------

  /**
   * @method planThread
   * @description Returns an error because Pinterest does not support threading.
   * @param _canonical - Ignored
   * @returns ThreadError indicating threading is not supported
   */
  override planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Returns an error because Pinterest does not support threading.
   * @param _input - Ignored
   * @returns PublishError indicating threading is not supported
   */
  override async publishThread(
    _input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  // ----------------------------------------------------------
  // Publish
  // ----------------------------------------------------------

  /**
   * @method publish
   * @description Creates a pin on the board specified in the channel credentials.
   *              Supports image pins (via image_url) and video pins (via media_source).
   * @param input - The publish input containing channelId, rendered post, and dedupeKey
   * @returns Result with a publish receipt or a publish error
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const post = input.post;

      // Extract metadata set during render
      const meta = (post.meta || {}) as Record<string, unknown>;
      const title = typeof meta.title === "string" ? meta.title : undefined;
      const altText = typeof meta.altText === "string" ? meta.altText : undefined;
      const description = post.text || post.body;
      const mediaUrl = post.media?.[0]?.url;
      const mediaType = post.media?.[0]?.type;

      if (!mediaUrl) {
        return err("VALIDATION");
      }

      // Build the pin creation payload
      const isVideo = mediaType === "video";
      const mediaSource = isVideo
        ? { source_type: "video_id" as const, media_id: mediaUrl }
        : { source_type: "image_url" as const, url: mediaUrl };

      const result = await apiClient.createPin({
        board_id: credentials.value.boardId,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        media_source: mediaSource,
        ...(altText ? { alt_text: altText } : {}),
      });

      return ok({
        providerPostId: result.id,
        url: `https://www.pinterest.com/pin/${result.id}/`,
        publishedAt: new Date(result.created_at),
      });
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  // ----------------------------------------------------------
  // Analytics
  // ----------------------------------------------------------

  /**
   * @method fetchAnalytics
   * @description Fetches pin analytics for a given channel. Uses the past 30 days
   *              if no date range is provided.
   * @param q - Query parameters with channelId and optional date range
   * @returns Result with analytics data or an error
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

      // Determine date range (default: last 30 days)
      const endDate = q.until || new Date();
      const startDate = q.since || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const formatDate = (d: Date): string => d.toISOString().split("T")[0] || "";

      // Fetch user account for summary info
      const userAccount = await apiClient.getUserAccount();

      return ok({
        channelId: q.channelId,
        period: {
          since: startDate,
          until: endDate,
        },
        metrics: {
          pinCount: userAccount.pin_count || 0,
          boardCount: userAccount.board_count || 0,
          accountType: userAccount.account_type,
        },
        dateRange: {
          startDate: formatDate(startDate),
          endDate: formatDate(endDate),
        },
      });
    } catch (error: unknown) {
      this.logError("fetchAnalytics", error, { channelId: q.channelId });
      return err("NETWORK");
    }
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * @method extractTitleAndDescription
   * @description Splits post body into a title (first line / sentence) and description.
   * @param body - Full post body text
   * @returns Object with title and description strings
   */
  private extractTitleAndDescription(body: string): {
    title: string;
    description: string;
  } {
    // Try to use first line as title
    const lines = body.split("\n").filter((line) => line.trim().length > 0);
    const firstLine = lines[0] || body;

    let title: string;
    let description: string;

    if (firstLine.length <= MAX_TITLE_LENGTH) {
      title = firstLine;
      description = lines.slice(1).join("\n").trim() || firstLine;
    } else {
      // Truncate to nearest word boundary
      const truncated = firstLine.slice(0, MAX_TITLE_LENGTH);
      const lastSpace = truncated.lastIndexOf(" ");
      title = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
      description = body;
    }

    // Ensure description respects max length
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH);
      const lastSpace = truncated.lastIndexOf(" ");
      description = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
    }

    return { title, description };
  }
}

// Export singleton instance for backward compatibility
export const pinterestAdapter = new PinterestAdapter();
