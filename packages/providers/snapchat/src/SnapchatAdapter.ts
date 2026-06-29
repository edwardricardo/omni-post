/**
 * @file SnapchatAdapter.ts
 * @description Snapchat provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer.
 *   Supports publishing stories with media, credential validation, and analytics
 *   retrieval. Threading and scheduling are not supported.
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
import { SnapchatApiClient } from "./apiClient.js";
import type { SnapchatCredentials } from "./types.js";

const REQUIRED_FIELDS: (keyof SnapchatCredentials)[] = [
  "clientId",
  "clientSecret",
  "accessToken",
  "refreshToken",
  "organizationId",
];

const SNAPCHAT_LIMITS: ProviderLimits = {
  maxChars: 250,
  maxMediaPerPost: 1,
  allowedMedia: ["image", "video"],
  aspectRatios: ["9:16"],
  maxVideoDuration: 60,
  threadingSupported: false,
  rateLimitHints: { burst: 20, perSeconds: 1 },
};

const SNAPCHAT_METADATA: ProviderMetadata = {
  id: "snapchat",
  name: "snapchat",
  displayName: "Snapchat",
  description: "Publish stories and spotlight content to Snapchat",
  icon: "/providers/snapchat-icon.svg",
  color: "#FFFC00",
  website: "https://www.snapchat.com",
  authType: "oauth",
  requiredScopes: ["snapchat-marketing-api", "snapchat-profile-api"],
  status: "active",
};

const SNAPCHAT_CAPABILITIES = {
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
  stories: true,
};

/**
 * Factory for creating SnapchatApiClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `SnapchatApiClient`.
 */
export type SnapchatApiClientFactory = (credentials: SnapchatCredentials) => SnapchatApiClient;

const defaultApiClientFactory: SnapchatApiClientFactory = (credentials) =>
  new SnapchatApiClient(credentials);

/**
 * @function classifySnapchatError
 * @description Snapchat-specific publish classification. A 401 is ambiguous:
 *   per RFC 6750, `invalid_token` means the access token merely EXPIRED (a
 *   refresh would fix it) — a TRANSIENT failure that must NOT flag reauth, so it
 *   maps to NETWORK. Any other 401 (e.g. `invalid_grant` = refresh token
 *   revoked, or an unrecognised 401) is a DEFINITIVE credential failure → AUTH,
 *   so reauth fires. The OAuth error token is read from the error message body
 *   (the API client embeds the response body / WWW-Authenticate error there).
 *   Non-401 errors defer to the shared `mapErrorToPublishError`.
 * @param error - The thrown value from the Snapchat API client.
 * @returns The PublishError discriminant.
 */
function classifySnapchatError(error: unknown): PublishError {
  const status = readSnapchatHttpStatus(error);
  if (status === 401) {
    const body = error instanceof Error ? error.message.toLowerCase() : "";
    if (body.includes("invalid_token")) {
      return "NETWORK";
    }
    return "AUTH";
  }
  return mapErrorToPublishError(error);
}

/**
 * @function readSnapchatHttpStatus
 * @description Extracts the HTTP status from a thrown Snapchat error. Prefers a
 *   numeric `.status` (set by `apiClient` via `Object.assign`), and falls back to
 *   parsing the status embedded in the error message (the api client formats
 *   throws as `"... <status> - {body}"`). The fallback is defence-in-depth: it
 *   keeps the 401 OAuth branch reachable even if a throw site omits `.status`, so
 *   a revoked-token 401 during the upload step never silently degrades to NETWORK
 *   (which would suppress reauth).
 * @param error - The thrown value from the Snapchat API client.
 * @returns The numeric HTTP status, or `undefined` when none can be derived.
 */
function readSnapchatHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const attached = (error as Error & { status?: unknown }).status;
  if (typeof attached === "number") {
    return attached;
  }
  const match = /\b(\d{3})\b\s*-/.exec(error.message);
  if (match && match[1]) {
    return Number(match[1]);
  }
  return undefined;
}

export interface SnapchatAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a SnapchatApiClient given credentials. Default: real client. */
  apiClientFactory?: SnapchatApiClientFactory;
}

/**
 * @class SnapchatAdapter
 * @description Provider adapter for the Snapchat platform.
 *   Supports publishing stories with media, credential validation,
 *   and analytics retrieval. Threading and scheduling are not supported.
 */
export class SnapchatAdapter implements ProviderAdapter {
  readonly id: ProviderId = "snapchat";
  readonly limits: ProviderLimits = SNAPCHAT_LIMITS;
  readonly capabilities = SNAPCHAT_CAPABILITIES;
  readonly metadata: ProviderMetadata = SNAPCHAT_METADATA;
  readonly constraints: ProviderConstraints = {
    businessAccountRequired: true,
  };

  private readonly logger: Logger;
  private readonly apiClientFactory: SnapchatApiClientFactory;

  constructor(deps: SnapchatAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "snapchat-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultApiClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by Snapchat. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<SnapchatCredentials>(
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
      await apiClient.validateCredentials();
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
   * @description Renders a canonical post into Snapchat story format.
   *   Snapchat stories require media; text-only posts are not supported.
   *   Content is truncated to 250 characters if needed.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    if (!canonical.media || canonical.media.length === 0) {
      return err("VALIDATION_ERROR");
    }

    const firstMedia = canonical.media[0];
    if (!firstMedia) {
      return err("VALIDATION_ERROR");
    }

    if (!this.limits.allowedMedia.includes(firstMedia.type)) {
      return err("UNSUPPORTED_MEDIA");
    }

    const caption = canonical.body ? canonical.body.substring(0, this.limits.maxChars) : "";

    return ok({
      type: "single",
      content: {
        body: caption,
        text: caption,
        media: [
          {
            url: firstMedia.url,
            type: firstMedia.type,
            ...(firstMedia.alt && { alt: firstMedia.alt }),
          },
        ],
        meta: {
          contentType: "story",
          aspectRatio: "9:16",
          maxDuration: this.limits.maxVideoDuration,
        },
      },
      meta: {
        platform: "snapchat",
        storyFormat: true,
      },
    });
  }

  /**
   * @method planThread
   * @description Snapchat does not support threading. Always returns an error.
   */
  planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description Snapchat does not support threading. Always returns an error.
   */
  async publishThread(
    _input: ThreadPublishInput,
    _credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  /**
   * @method publish
   * @description Publishes a story to Snapchat. Uploads media first, then creates
   *   a creative/story referencing the uploaded media.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<SnapchatCredentials>(
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

      if (!input.post.media || input.post.media.length === 0) {
        return err("VALIDATION");
      }

      const firstMedia = input.post.media[0];
      if (!firstMedia) {
        return err("VALIDATION");
      }

      // Step 1: Upload media
      const mediaResult = await apiClient.uploadMedia(
        firstMedia.url,
        firstMedia.type === "video" ? "video/mp4" : "image/jpeg"
      );

      // Step 2: Create story referencing the uploaded media
      const caption = input.post.body || input.post.text || "";
      const storyResult = await apiClient.createStory(mediaResult.media.id, caption || undefined);

      return ok({
        providerPostId: storyResult.creative.id,
        url: `https://www.snapchat.com/stories/${storyResult.creative.id}`,
        publishedAt: new Date(storyResult.creative.created_at),
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

      return err(classifySnapchatError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Fetches analytics for a Snapchat story/creative.
   *   Uses the channelId as the creative ID for analytics lookup.
   */
  async fetchAnalytics(
    query: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<SnapchatCredentials>(
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
      const analytics = await apiClient.getStoryAnalytics(query.channelId);

      return ok({
        channelId: query.channelId,
        ...(query.since && { since: query.since }),
        ...(query.until && { until: query.until }),
        metrics: {
          views: analytics.total_views,
          uniqueViews: analytics.unique_views,
          likes: 0,
          shares: analytics.shares,
          comments: 0,
          screenshots: analytics.screenshots,
          swipeUps: analytics.swipe_ups,
          avgViewTime: analytics.avg_view_time_seconds,
        },
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "fetchAnalytics",
        channelId: query.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }
}

/**
 * @function createSnapchatAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional apiClient factory for tests).
 */
export function createSnapchatAdapter(deps: SnapchatAdapterDeps = {}): SnapchatAdapter {
  return new SnapchatAdapter(deps);
}
