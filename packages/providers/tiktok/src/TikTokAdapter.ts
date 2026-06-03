/**
 * @file TikTokAdapter.ts
 * @description TikTok provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer. Supports video
 *   posts (with chunked init/upload/finalize handled inside the API client) and
 *   photo carousel posts via the Content Posting API. Optional research and
 *   marketing API clients are wired through dedicated factories so the
 *   composition root can enrich them with their additional secrets without
 *   leaking those secrets into adapter code.
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
  RenderedPost,
  Result,
  RenderError,
  PublishError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import {
  validateCredentialStructure,
  mapErrorToPublishError,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import pino, { type Logger } from "pino";
import { TikTokApiClient, type TikTokCredentials } from "./apiClient.js";
import { TikTokHashtagManager } from "./hashtagManager.js";
import { TikTokMarketingApiClient } from "./marketingApiClient.js";
import { TikTokResearchApiClient } from "./researchApiClient.js";

export interface TikTokProviderCredentials extends TikTokCredentials {
  [key: string]: string | undefined;
}

const REQUIRED_FIELDS: (keyof TikTokProviderCredentials)[] = [
  "clientKey",
  "clientSecret",
  "accessToken",
  "openId",
];

const TIKTOK_LIMITS: ProviderLimits = {
  maxChars: 2200,
  allowedMedia: ["video", "image"],
  aspectRatios: ["9:16", "1:1", "16:9"],
  maxMediaPerPost: 35,
  threadingSupported: false,
  rateLimitHints: { burst: 50, perSeconds: 3600 },
};

const TIKTOK_METADATA: ProviderMetadata = {
  id: "tiktok",
  name: "tiktok",
  displayName: "TikTok",
  description: "Share short-form videos on TikTok",
  icon: "/providers/tiktok-icon.svg",
  color: "#000000",
  website: "https://tiktok.com",
  authType: "oauth",
  requiredScopes: ["video.upload", "user.info.basic"],
  status: "active",
};

const TIKTOK_CAPABILITIES = {
  publish: true,
  mentions: false,
  schedule: false,
  analytics: true,
  comments: false,
  replies: false,
  threading: false,
};

/**
 * Factory for creating the main TikTok API client. Injected so tests can supply
 * a fake. Defaults to constructing a real `TikTokApiClient`.
 */
export type TikTokApiClientFactory = (credentials: TikTokCredentials) => TikTokApiClient;

/**
 * Factory for creating the optional Research API client. The research endpoint
 * needs an additional key on top of the channel credentials; the composition
 * root closes over that key when constructing the factory so the adapter never
 * sees the secret directly. Tests provide a stub.
 */
export type ResearchClientFactory = (credentials: TikTokCredentials) => TikTokResearchApiClient;

/**
 * Factory for creating the optional Marketing API client. Needs an advertiser
 * account id; same composition-root pattern as `ResearchClientFactory`.
 */
export type MarketingClientFactory = (credentials: TikTokCredentials) => TikTokMarketingApiClient;

const defaultApiClientFactory: TikTokApiClientFactory = (credentials) =>
  new TikTokApiClient(credentials);

export interface TikTokAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a TikTokApiClient given credentials. Default: real client. */
  apiClientFactory?: TikTokApiClientFactory;
  /** Factory that constructs a TikTokResearchApiClient. Default: undefined — hashtag strategy becomes a no-op. */
  researchClientFactory?: ResearchClientFactory;
  /** Factory that constructs a TikTokMarketingApiClient. Default: undefined — promoted content stays NOT_IMPLEMENTED. */
  marketingClientFactory?: MarketingClientFactory;
}

/**
 * @class TikTokAdapter
 * @description Publishes content to TikTok via the Content Posting API. Handles
 *   both video posts and photo carousels, optionally enriches the description
 *   with a hashtag strategy when a research client is wired.
 */
export class TikTokAdapter implements ProviderAdapter {
  readonly id: ProviderId = "tiktok";
  readonly limits: ProviderLimits = TIKTOK_LIMITS;
  readonly capabilities = TIKTOK_CAPABILITIES;
  readonly metadata: ProviderMetadata = TIKTOK_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: TikTokApiClientFactory;
  private readonly researchClientFactory?: ResearchClientFactory;
  private readonly marketingClientFactory?: MarketingClientFactory;

  constructor(deps: TikTokAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "tiktok-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultApiClientFactory;
    if (deps.researchClientFactory) {
      this.researchClientFactory = deps.researchClientFactory;
    }
    if (deps.marketingClientFactory) {
      this.marketingClientFactory = deps.marketingClientFactory;
    }
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by TikTok. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<TikTokProviderCredentials>(
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
   * @description Validates that a canonical post fits TikTok's constraints
   *   (description length, allowed media types and counts, photo-vs-video rules)
   *   and produces the rendered content payload consumed by `publish`.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const description = canonical.body;

    if (this.limits.maxChars && description.length > this.limits.maxChars) {
      return err("CONTENT_TOO_LONG");
    }

    if (!canonical.media || canonical.media.length === 0) {
      return err("MEDIA_REQUIRED" as RenderError);
    }

    const firstMedia = canonical.media[0];
    if (!firstMedia) {
      return err("MEDIA_REQUIRED" as RenderError);
    }

    const isPhotoPost = canonical.media.every((m) => m.type === "image");
    const isVideoPost = firstMedia.type === "video";

    if (!isPhotoPost && !isVideoPost) {
      return err("INVALID_MEDIA_TYPE" as RenderError);
    }

    if (isVideoPost && canonical.media.length > 1) {
      return err("TOO_MANY_MEDIA" as RenderError);
    }

    if (isPhotoPost && canonical.media.length > 35) {
      return err("TOO_MANY_MEDIA" as RenderError);
    }

    const mappedMedia = canonical.media.map((media) => ({
      url: media.url,
      type:
        media.type === "video"
          ? ("video" as const)
          : media.type === "image"
            ? ("image" as const)
            : ("gif" as const),
      ...(media.alt && { alt: media.alt }),
    }));

    return ok({
      type: "single" as const,
      content: {
        body: description,
        text: description,
        ...(isPhotoPost ? { contentType: "photo" } : { videoUrl: firstMedia.url }),
        media: mappedMedia,
      },
      ...(isPhotoPost ? { meta: { contentType: "photo" } } : {}),
    });
  }

  /**
   * @method publish
   * @description Routes a rendered post to either the photo-carousel or the
   *   video-upload flow, optionally enriching the description with a hashtag
   *   strategy when a research client is wired.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<TikTokProviderCredentials>(
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

      const description = input.post.body || "";

      let enhancedDescription = description;
      if (input.post.meta) {
        enhancedDescription = await this.applyHashtagStrategy(
          validation.value,
          description,
          input.post.meta as Record<string, unknown>
        );
      }

      const isPhotoPost =
        input.post.meta?.contentType === "photo" ||
        input.post.media.every((m) => m.type === "image");

      if (isPhotoPost) {
        return await this.publishPhotoPost(
          apiClient,
          validation.value,
          input.post,
          enhancedDescription
        );
      }

      let privacy: "public" | "private" = "public";
      if (input.post.meta?.privacy === "private") {
        privacy = "private";
      }

      const result = await apiClient.uploadVideo({
        description: enhancedDescription,
        videoUrl: firstMedia.url,
        privacy,
        ...(typeof input.post.meta?.disableComment === "boolean" && {
          disableComment: input.post.meta.disableComment,
        }),
        ...(typeof input.post.meta?.disableDuet === "boolean" && {
          disableDuet: input.post.meta.disableDuet,
        }),
        ...(typeof input.post.meta?.disableStitch === "boolean" && {
          disableStitch: input.post.meta.disableStitch,
        }),
      });

      if (input.post.meta?.promotedContent) {
        this.createPromotedContent(
          validation.value,
          result.shareId,
          input.post.meta as Record<string, unknown>
        ).catch((promoteErr) =>
          this.logger.error({
            provider: this.id,
            operation: "createPromotedContent",
            error: promoteErr instanceof Error ? promoteErr.message : String(promoteErr),
          })
        );
      }

      return ok({
        providerPostId: result.shareId,
        url:
          result.shareUrl ||
          `https://www.tiktok.com/@${validation.value.openId}/video/${result.shareId}`,
        publishedAt: new Date(),
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
   * @description Retrieves user-level analytics from TikTok. The public API
   *   exposes follower / video counts and likes; share / comment metrics
   *   require additional approval and are reported as 0 here.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<TikTokProviderCredentials>(
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
      const analytics = await apiClient.getUserInfo();

      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions: analytics.followerCount || 0,
          engagements: analytics.likesCount + analytics.followingCount || 0,
          likes: analytics.likesCount || 0,
          shares: 0,
          comments: 0,
          clicks: analytics.videoCount || 0,
        },
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "fetchAnalytics",
        channelId: q.channelId,
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method publishPhotoPost
   * @description Publishes a photo carousel via the Content Posting API.
   */
  private async publishPhotoPost(
    apiClient: TikTokApiClient,
    credentials: TikTokCredentials,
    post: RenderedPost,
    description: string
  ): Promise<Result<PublishReceipt, PublishError>> {
    const imageUrls = (post.media || []).filter((m) => m.type === "image").map((m) => m.url);

    if (imageUrls.length === 0) {
      return err("VALIDATION");
    }

    const privacy =
      post.meta?.privacy === "private" ? ("SELF_ONLY" as const) : ("PUBLIC_TO_EVERYONE" as const);

    const result = await apiClient.publishPhotoPost({
      description,
      imageUrls,
      privacy,
      ...(typeof post.meta?.disableComment === "boolean" && {
        disableComment: post.meta.disableComment,
      }),
    });

    return ok({
      providerPostId: result.shareId,
      url:
        result.shareUrl || `https://www.tiktok.com/@${credentials.openId}/photo/${result.shareId}`,
      publishedAt: new Date(),
    });
  }

  /**
   * @method applyHashtagStrategy
   * @description Generates a hashtag strategy for the post description when
   *   `meta.useHashtagStrategy` is set and a research client factory is wired.
   *   On any failure the original description is returned unchanged so that
   *   hashtag enrichment never blocks publishing.
   */
  private async applyHashtagStrategy(
    credentials: TikTokCredentials,
    description: string,
    meta?: Record<string, unknown>
  ): Promise<string> {
    if (!meta?.useHashtagStrategy) {
      return description;
    }

    if (!this.researchClientFactory) {
      return description;
    }

    try {
      const researchClient = this.researchClientFactory(credentials);
      const hashtagManager = new TikTokHashtagManager(researchClient);

      const strategy = await hashtagManager.generateHashtagStrategy({
        contentCategory: (meta.contentCategory as string) || "general",
        ...(meta.targetAudience ? { targetAudience: meta.targetAudience as string } : {}),
        ...(meta.brandedHashtags ? { brandedHashtags: meta.brandedHashtags as string[] } : {}),
      });

      const allHashtags = [
        ...strategy.strategy.primary,
        ...strategy.strategy.trending.slice(0, 3),
        ...strategy.strategy.niche.slice(0, 5),
      ];

      const hashtagString = allHashtags.map((h) => `#${h}`).join(" ");
      return `${description}\n\n${hashtagString}`;
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "applyHashtagStrategy",
        error: error instanceof Error ? error.message : String(error),
      });
      return description;
    }
  }

  /**
   * @method createPromotedContent
   * @description NOT_IMPLEMENTED — TikTok Marketing API requires advertiser
   *   account approval, which omni-post does not currently hold.
   */
  private async createPromotedContent(
    _credentials: TikTokCredentials,
    _videoId: string,
    _meta?: Record<string, unknown>
  ): Promise<void> {
    throw new Error(
      "NOT_IMPLEMENTED: TikTok Marketing API — TikTok Ads API requires advertiser account approval. See docs/providers/tiktok.md"
    );
  }
}

/**
 * @function createTikTokAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional client factories for tests
 *   and for marketing/research enrichment).
 */
export function createTikTokAdapter(deps: TikTokAdapterDeps = {}): TikTokAdapter {
  return new TikTokAdapter(deps);
}
