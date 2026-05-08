/**
 * @file LinkedInAdapter.ts
 * @description LinkedIn provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer.
 *   Supports text posts, image posts, video posts, document posts (PDF/PPTX/DOCX),
 *   poll posts, and carousel content via the LinkedIn Posts API (v2 REST) with
 *   OAuth 2.0 authentication.
 * @layer infrastructure
 */

import type {
  ProviderAdapter,
  ProviderId,
  ProviderLimits,
  PublishInput,
  PublishReceipt,
  ProviderComment,
  ProviderReplyResult,
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
import { LinkedInApiClient } from "./apiClient.js";
import type { LinkedInCredentials, LinkedInPostPayload, LinkedInPollDuration } from "./types.js";
import { uploadAndAttachMedia, uploadDocument } from "./mediaUpload.js";

const REQUIRED_FIELDS: (keyof LinkedInCredentials)[] = ["accessToken", "refreshToken", "personUrn"];

const LINKEDIN_LIMITS: ProviderLimits = {
  maxChars: 3000,
  allowedMedia: ["image", "video"],
  aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
  maxMediaPerPost: 9,
  threadingSupported: false,
  rateLimitHints: { burst: 100, perSeconds: 86400 },
};

const LINKEDIN_METADATA: ProviderMetadata = {
  id: "linkedin",
  name: "linkedin",
  displayName: "LinkedIn",
  description: "Publish posts and articles to LinkedIn profiles and company pages",
  icon: "/providers/linkedin-icon.svg",
  color: "#0A66C2",
  website: "https://linkedin.com",
  authType: "oauth",
  requiredScopes: ["w_member_social", "w_organization_social", "openid", "profile"],
  status: "active",
};

const LINKEDIN_CAPABILITIES = {
  publish: true,
  schedule: true,
  analytics: true,
  comments: true,
  replies: true,
  threading: false,
};

/**
 * Factory for creating LinkedInApiClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `LinkedInApiClient`.
 */
export type LinkedInApiClientFactory = (credentials: LinkedInCredentials) => LinkedInApiClient;

const defaultApiClientFactory: LinkedInApiClientFactory = (credentials) =>
  new LinkedInApiClient(credentials);

export interface LinkedInAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a LinkedInApiClient given credentials. Default: real client. */
  apiClientFactory?: LinkedInApiClientFactory;
}

/**
 * @class LinkedInAdapter
 * @description Publishes content to LinkedIn via the REST Posts API.
 *   Supports personal profiles and organization pages.
 */
export class LinkedInAdapter implements ProviderAdapter {
  readonly id: ProviderId = "linkedin";
  readonly limits: ProviderLimits = LINKEDIN_LIMITS;
  readonly capabilities = LINKEDIN_CAPABILITIES;
  readonly metadata: ProviderMetadata = LINKEDIN_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly apiClientFactory: LinkedInApiClientFactory;

  constructor(deps: LinkedInAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "linkedin-adapter", level: "info" });
    this.apiClientFactory = deps.apiClientFactory ?? defaultApiClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by LinkedIn. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<LinkedInCredentials>(
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
      const apiClientLike = apiClient as unknown as Record<string, unknown>;
      if (typeof apiClientLike.validateCredentials === "function") {
        await (apiClientLike.validateCredentials as () => Promise<void>)();
      } else {
        await apiClient.getProfile();
      }
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
   * @description Renders a canonical post into LinkedIn-specific format.
   *   Supports text, media, polls, and document posts.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const text = canonical.body || "";

    if (text.length > this.limits.maxChars) {
      return err("TEXT_TOO_LONG");
    }

    if (canonical.media && canonical.media.length > this.limits.maxMediaPerPost) {
      return err("VALIDATION_ERROR");
    }

    // Detect poll from canonical post tags (convention: tag starting with "poll:")
    const pollTag = canonical.tags?.find((t) => t.startsWith("poll:"));
    const meta: Record<string, unknown> = { platform: "linkedin" };

    if (pollTag) {
      // Parse poll: "poll:duration:question|option1|option2|..."
      const pollData = this.parsePollTag(pollTag);
      if (pollData) {
        meta.poll = pollData;
      }
    }

    return ok({
      type: "single",
      content: {
        body: text,
        ...(canonical.media &&
          canonical.media.length > 0 && {
            media: canonical.media.map((m) => ({
              url: m.url,
              type: m.type,
              ...(m.alt ? { alt: m.alt } : {}),
            })),
          }),
        meta,
      },
      meta: {},
    });
  }

  /**
   * @method planThread
   * @description LinkedIn does not support threading. Always returns an error.
   */
  planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description LinkedIn does not support threading. Always returns an error.
   */
  async publishThread(
    _input: ThreadPublishInput,
    _credentials: unknown
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  /**
   * @method publish
   * @description Publishes a single post to LinkedIn. Handles media upload
   *   (images/videos/documents) before creating the post.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<LinkedInCredentials>(
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
      const authorUrn = validation.value.organizationUrn || validation.value.personUrn;

      const payload: LinkedInPostPayload = {
        author: authorUrn,
        commentary: input.post.body,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      // Check for poll in rendered meta
      const pollData = input.post.meta?.poll as
        | { question: string; options: string[]; duration: LinkedInPollDuration }
        | undefined;

      if (pollData) {
        payload.content = {
          poll: {
            question: pollData.question,
            options: pollData.options.map((text) => ({ text })),
            settings: { duration: pollData.duration },
          },
        };
      } else if (input.post.media && input.post.media.length > 0) {
        // Check for document media (detect by URL extension)
        const documentMedia = input.post.media.find((m) => /\.(pdf|pptx?|docx?)$/i.test(m.url));

        if (documentMedia) {
          const docUrn = await uploadDocument(apiClient, authorUrn, documentMedia.url);
          if (docUrn) {
            payload.content = { media: { id: docUrn, title: documentMedia.alt || "Document" } };
          }
        } else {
          const mediaContent = await uploadAndAttachMedia(apiClient, authorUrn, input.post.media);
          if (mediaContent) {
            payload.content = mediaContent;
          }
        }
      }

      const result = await apiClient.createPost(payload);
      const postId = result.id;
      const activityId = this.extractActivityId(postId);

      return ok({
        providerPostId: postId,
        url: activityId
          ? `https://www.linkedin.com/feed/update/${activityId}`
          : `https://www.linkedin.com/feed/update/${postId}`,
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
   * @description Fetches engagement analytics for a LinkedIn channel.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<LinkedInCredentials>(
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
      const authorUrn = validation.value.organizationUrn || validation.value.personUrn;
      const analytics = await apiClient.getPostAnalytics(authorUrn);

      return ok({
        channelId: q.channelId,
        ...(q.since ? { since: q.since } : {}),
        ...(q.until ? { until: q.until } : {}),
        metrics: {
          views: analytics.totalShareStatistics.impressionCount,
          likes: analytics.totalShareStatistics.likeCount,
          shares: analytics.totalShareStatistics.shareCount,
          comments: analytics.totalShareStatistics.commentCount,
          clicks: analytics.totalShareStatistics.clickCount,
          engagement: analytics.totalShareStatistics.engagement,
        },
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
   * @method getComments
   * @description Fetches comments on a LinkedIn post.
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<LinkedInCredentials>(
      params.channelCredentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const postUrn = params.postExternalId || "";
      const start = params.cursor ? parseInt(params.cursor, 10) : 0;
      const count = params.limit || 20;

      const response = await apiClient.getComments(postUrn, start, count);

      const comments: ProviderComment[] = response.elements.map((c) => ({
        providerMessageId: c.id,
        ...(c.parentComment ? { providerParentId: c.parentComment } : {}),
        authorName: c.actor,
        authorProviderId: c.actor,
        body: c.message.text,
        createdAt: new Date(c.created.time),
      }));

      const nextStart = start + count;
      const hasMore = nextStart < response.paging.total;

      return ok({
        comments,
        ...(hasMore ? { nextCursor: String(nextStart) } : {}),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "getComments",
        error: error instanceof Error ? error.message : String(error),
      });
      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply comment on a LinkedIn post.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    const validation = validateCredentialStructure<LinkedInCredentials>(
      params.channelCredentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.apiClientFactory(validation.value);
      const postUrn = params.inReplyToProviderMessageId;
      const result = await apiClient.postComment(postUrn, params.body);

      return ok({
        providerReplyId: result.id,
        createdAt: new Date(result.created.time),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "postReply",
        error: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof Error &&
        "status" in error &&
        (error as Record<string, unknown>).status === 429
      ) {
        return err("RATE_LIMIT");
      }

      return err("NETWORK");
    }
  }

  /**
   * @method parsePollTag
   * @description Parses a poll tag into structured poll data.
   *   Format: "poll:DURATION:question|option1|option2|..."
   */
  private parsePollTag(
    tag: string
  ): { question: string; options: string[]; duration: LinkedInPollDuration } | null {
    const validDurations: LinkedInPollDuration[] = [
      "ONE_DAY",
      "THREE_DAYS",
      "SEVEN_DAYS",
      "FOURTEEN_DAYS",
    ];

    // Strip "poll:" prefix
    const remainder = tag.slice(5);
    const colonIndex = remainder.indexOf(":");
    if (colonIndex === -1) return null;

    const duration = remainder.slice(0, colonIndex) as LinkedInPollDuration;
    if (!validDurations.includes(duration)) return null;

    const parts = remainder.slice(colonIndex + 1).split("|");
    const question = parts[0];
    const options = parts.slice(1);

    if (!question || options.length < 2 || options.length > 4) return null;
    if (question.length > 140) return null;
    if (options.some((o) => o.length > 30)) return null;

    return { question, options, duration };
  }

  /**
   * @method extractActivityId
   * @description Extracts the activity ID from a LinkedIn post URN for URL construction.
   */
  private extractActivityId(postUrn: string): string | null {
    const match = postUrn.match(/urn:li:(?:share|activity|ugcPost):(\d+)/);
    if (match?.[1]) {
      return `urn:li:activity:${match[1]}`;
    }
    return null;
  }
}

/**
 * @function createLinkedInAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional apiClient factory for tests).
 */
export function createLinkedInAdapter(deps: LinkedInAdapterDeps = {}): LinkedInAdapter {
  return new LinkedInAdapter(deps);
}
