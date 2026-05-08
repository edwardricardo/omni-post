/**
 * @file PinterestAdapter.ts
 * @description Pinterest provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer.
 *   Publishes image/video pins, validates credentials, and fetches analytics
 *   via the Pinterest API v5. Threading is not supported.
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
import { PinterestApiClient, type PinterestCredentials } from "./apiClient.js";

// ============================================================
// Constants
// ============================================================

const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const REQUIRED_FIELDS: (keyof PinterestCredentials)[] = ["accessToken", "refreshToken", "boardId"];

const PINTEREST_LIMITS: ProviderLimits = {
  maxChars: MAX_DESCRIPTION_LENGTH,
  maxMediaPerPost: 1,
  allowedMedia: ["image", "video"],
  aspectRatios: ["1:1", "4:5", "3:2"],
  maxVideoDuration: 900, // 15 minutes
  threadingSupported: false,
  rateLimitHints: { burst: 100, perSeconds: 1 },
};

const PINTEREST_METADATA: ProviderMetadata = {
  id: "pinterest",
  name: "pinterest",
  displayName: "Pinterest",
  description: "Create and share image and video pins on Pinterest boards",
  icon: "/providers/pinterest-icon.svg",
  color: "#BD081C",
  website: "https://pinterest.com",
  authType: "oauth",
  requiredScopes: ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"],
  status: "active",
};

const PINTEREST_CAPABILITIES = {
  publish: true,
  schedule: true,
  analytics: true,
  comments: false,
  replies: false,
  threading: false,
};

/**
 * Factory for creating PinterestApiClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `PinterestApiClient`.
 */
export type PinterestApiClientFactory = (credentials: PinterestCredentials) => PinterestApiClient;

const defaultApiClientFactory: PinterestApiClientFactory = (credentials) =>
  new PinterestApiClient(credentials);

export interface PinterestAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a PinterestApiClient given credentials. Default: real client. */
  apiClientFactory?: PinterestApiClientFactory;
}

/**
 * @class PinterestAdapter
 * @description Adapter for publishing content to Pinterest as image or video pins.
 *   Pinterest does not support threading; planThread and publishThread return errors.
 */
export class PinterestAdapter implements ProviderAdapter {
  readonly id: ProviderId = "pinterest";
  readonly limits: ProviderLimits = PINTEREST_LIMITS;
  readonly capabilities = PINTEREST_CAPABILITIES;
  readonly metadata: ProviderMetadata = PINTEREST_METADATA;
  readonly constraints: ProviderConstraints = {
    businessAccountRequired: false,
  };

  private readonly logger: Logger;
  private readonly apiClientFactory: PinterestApiClientFactory;

  constructor(deps: PinterestAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "pinterest-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultApiClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by Pinterest. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<PinterestCredentials>(
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
      await apiClient.getUserAccount();
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

  /**
   * @method render
   * @description Renders a canonical post into a Pinterest pin payload.
   *   Extracts title from the first line or truncates the body.
   *   Only single-pin rendering is supported.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Pinterest requires at least one media item
    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR");
    }

    const media = canonical.media[0];
    if (!media) {
      return err("VALIDATION_ERROR");
    }

    if (!this.limits.allowedMedia.includes(media.type)) {
      return err("UNSUPPORTED_MEDIA");
    }

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

  /**
   * @method planThread
   * @description Returns an error because Pinterest does not support threading.
   */
  planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Returns an error because Pinterest does not support threading.
   */
  async publishThread(
    _input: ThreadPublishInput,
    _credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  /**
   * @method publish
   * @description Creates a pin on the board specified in the credentials.
   *   Supports image pins (via image_url) and video pins (via media_source).
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<PinterestCredentials>(
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
      const post = input.post;

      const meta = (post.meta || {}) as Record<string, unknown>;
      const title = typeof meta.title === "string" ? meta.title : undefined;
      const altText = typeof meta.altText === "string" ? meta.altText : undefined;
      const description = post.text || post.body;
      const mediaUrl = post.media?.[0]?.url;
      const mediaType = post.media?.[0]?.type;

      if (!mediaUrl) {
        return err("VALIDATION");
      }

      const isVideo = mediaType === "video";
      const mediaSource = isVideo
        ? { source_type: "video_id" as const, media_id: mediaUrl }
        : { source_type: "image_url" as const, url: mediaUrl };

      const result = await apiClient.createPin({
        board_id: validation.value.boardId,
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

  /**
   * @method fetchAnalytics
   * @description Fetches pin analytics for a given channel. Uses the past 30 days
   *   if no date range is provided.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date; providerPostId?: string },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<PinterestCredentials>(
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

      const endDate = q.until || new Date();
      const startDate = q.since || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

      const formatDate = (d: Date): string => d.toISOString().split("T")[0] || "";
      const startStr = formatDate(startDate);
      const endStr = formatDate(endDate);

      const userAccount = await apiClient.getUserAccount();

      const pinMetrics = q.providerPostId
        ? await this.fetchPinMetrics(apiClient, q.providerPostId, startStr, endStr)
        : undefined;

      return ok({
        channelId: q.channelId,
        period: { since: startDate, until: endDate },
        metrics: {
          pinCount: userAccount.pin_count || 0,
          boardCount: userAccount.board_count || 0,
          accountType: userAccount.account_type,
          ...(pinMetrics ? { pin: pinMetrics } : {}),
        },
        dateRange: { startDate: startStr, endDate: endStr },
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

  /**
   * @method fetchPinMetrics
   * @description Fetches lifetime analytics for a specific pin via getPinAnalytics().
   */
  private async fetchPinMetrics(
    apiClient: PinterestApiClient,
    pinId: string,
    startDate: string,
    endDate: string
  ): Promise<Record<string, number> | undefined> {
    try {
      const analytics = await apiClient.getPinAnalytics(pinId, startDate, endDate);
      const m = analytics.all.lifetime_metrics;
      return {
        impressions: m.IMPRESSION,
        saves: m.SAVE,
        pinClicks: m.PIN_CLICK,
        outboundClicks: m.OUTBOUND_CLICK,
      };
    } catch {
      // Pin analytics may fail for pins older than 90 days or non-business accounts
      return undefined;
    }
  }

  /**
   * @method extractTitleAndDescription
   * @description Splits post body into a title (first line / sentence) and description.
   */
  private extractTitleAndDescription(body: string): {
    title: string;
    description: string;
  } {
    const lines = body.split("\n").filter((line) => line.trim().length > 0);
    const firstLine = lines[0] || body;

    let title: string;
    let description: string;

    if (firstLine.length <= MAX_TITLE_LENGTH) {
      title = firstLine;
      description = lines.slice(1).join("\n").trim() || firstLine;
    } else {
      const truncated = firstLine.slice(0, MAX_TITLE_LENGTH);
      const lastSpace = truncated.lastIndexOf(" ");
      title = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
      description = body;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      const truncated = description.slice(0, MAX_DESCRIPTION_LENGTH);
      const lastSpace = truncated.lastIndexOf(" ");
      description = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
    }

    return { title, description };
  }
}

/**
 * @function createPinterestAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional apiClient factory for tests).
 */
export function createPinterestAdapter(deps: PinterestAdapterDeps = {}): PinterestAdapter {
  return new PinterestAdapter(deps);
}
