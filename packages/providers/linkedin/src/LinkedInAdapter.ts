/**
 * @file LinkedInAdapter.ts
 * @description LinkedIn provider adapter extending AbstractProviderAdapter.
 *              Supports text posts, image posts, video posts, and carousel content.
 *              Uses LinkedIn Posts API (v2 REST) with OAuth 2.0 authentication.
 * @layer infrastructure
 */

import {
  AbstractProviderAdapter,
  type ProviderMetadata,
  type ProviderConstraints,
} from "@providers/shared";
import type {
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
import { LinkedInApiClient } from "./apiClient.js";
import type { LinkedInCredentials, LinkedInPostPayload, LinkedInPollDuration } from "./types.js";
import { uploadAndAttachMedia, uploadDocument } from "./mediaUpload.js";

/**
 * LinkedIn Provider Adapter
 *
 * Publishes content to LinkedIn via the REST Posts API.
 * Supports personal profiles and organization pages.
 */
export class LinkedInAdapter extends AbstractProviderAdapter<LinkedInCredentials> {
  readonly id: ProviderId = "linkedin";

  readonly metadata: ProviderMetadata = {
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

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 3000,
    allowedMedia: ["image", "video"],
    aspectRatios: ["1:1", "4:5", "16:9", "9:16"],
    maxMediaPerPost: 9,
    threadingSupported: false,
    rateLimitHints: { burst: 100, perSeconds: 86400 },
  };

  readonly capabilities = {
    publish: true,
    schedule: true,
    analytics: true,
    comments: true,
    replies: true,
    threading: false,
  };

  protected readonly requiredCredentialFields: (keyof LinkedInCredentials)[] = [
    "accessToken",
    "refreshToken",
    "personUrn",
  ];

  /**
   * @method getCredentialsFromEnvironment
   * @description Reads LinkedIn credentials from environment variables.
   * @returns Result with credentials or AUTH error
   */
  protected getCredentialsFromEnvironment(): Result<LinkedInCredentials, "AUTH"> {
    const orgUrn = process.env.LINKEDIN_ORGANIZATION_URN;
    const credentials: LinkedInCredentials = {
      accessToken: process.env.LINKEDIN_ACCESS_TOKEN || "placeholder",
      refreshToken: process.env.LINKEDIN_REFRESH_TOKEN || "placeholder",
      personUrn: process.env.LINKEDIN_PERSON_URN || "placeholder",
      ...(orgUrn ? { organizationUrn: orgUrn } : {}),
    };

    if (credentials.accessToken === "placeholder" || credentials.personUrn === "placeholder") {
      return err("AUTH");
    }

    return ok(credentials);
  }

  /**
   * @method createApiClient
   * @description Creates a new LinkedInApiClient with the given credentials.
   */
  protected createApiClient(credentials: LinkedInCredentials): LinkedInApiClient {
    return new LinkedInApiClient(credentials);
  }

  /**
   * @method render
   * @description Renders a canonical post into LinkedIn-specific format.
   *              Supports text, media, polls, and document posts.
   * @param canonical - The platform-agnostic post content
   * @returns Rendered content ready for publishing
   */
  override render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
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
  override planThread(_canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    return err("THREAD_PLANNING_FAILED");
  }

  /**
   * @method publishThread
   * @description LinkedIn does not support threading. Always returns an error.
   */
  override async publishThread(
    _input: ThreadPublishInput
  ): Promise<Result<ThreadReceipt, PublishError>> {
    return err("VALIDATION");
  }

  /**
   * @method publish
   * @description Publishes a single post to LinkedIn. Handles media upload
   *              (images/videos) via the 2-step upload flow before creating the post.
   * @param input - The publish input containing channel, content, and dedupe key
   * @returns Receipt with the LinkedIn post URN and URL
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credentials = await this.getCredentials(input.channelId);
    if (!credentials.ok) {
      return err("AUTH");
    }

    try {
      const apiClient = this.createApiClient(credentials.value);
      const authorUrn = credentials.value.organizationUrn || credentials.value.personUrn;

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
      this.logError("publish", error, { channelId: input.channelId });

      if (error instanceof Error && error.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err(this.mapErrorToPublishError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Fetches engagement analytics for a LinkedIn channel.
   * @param q - Query containing channelId, since, and until
   * @returns Analytics data or error
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
      const authorUrn = credentials.value.organizationUrn || credentials.value.personUrn;
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
      this.logError("fetchAnalytics", error, { channelId: q.channelId });
      return err("NETWORK");
    }
  }

  /**
   * @method getComments
   * @description Fetches comments on a LinkedIn post.
   * @param params - Query parameters including credentials, post ID, cursor, limit
   * @returns Paginated list of normalized comments
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    const creds = params.channelCredentials as LinkedInCredentials;
    if (!creds.accessToken || !creds.personUrn) {
      return err("AUTH");
    }

    try {
      const apiClient = new LinkedInApiClient(creds);
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
      this.logError("getComments", error);
      return err("NETWORK");
    }
  }

  /**
   * @method postReply
   * @description Posts a reply comment on a LinkedIn post.
   * @param params - The reply parameters including credentials, parent message ID, body
   * @returns The created reply result
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    const creds = params.channelCredentials as LinkedInCredentials;
    if (!creds.accessToken || !creds.personUrn) {
      return err("AUTH");
    }

    try {
      const apiClient = new LinkedInApiClient(creds);
      const postUrn = params.inReplyToProviderMessageId;
      const result = await apiClient.postComment(postUrn, params.body);

      return ok({
        providerReplyId: result.id,
        createdAt: new Date(result.created.time),
      });
    } catch (error: unknown) {
      this.logError("postReply", error);

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
   *              Format: "poll:DURATION:question|option1|option2|..."
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

// Export singleton instance for backward compatibility
export const linkedInAdapter = new LinkedInAdapter();
