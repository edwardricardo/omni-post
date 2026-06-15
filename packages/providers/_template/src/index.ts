/**
 * @file index.ts
 * @description Template provider adapter scaffold — a reference for implementing new provider
 *              adapters. Copy this package, rename to `@providers/<name>`, then replace every
 *              `// TEMPLATE:` placeholder with real provider-specific logic.
 *
 *              Structure mirrors the canonical adapters (`@providers/x`, `@providers/facebook`,
 *              etc.): pure `ProviderAdapter` port implementation with render/publish/thread/
 *              fetchAnalytics, all fallible operations return `Result<T, E>` from `@shared/types`.
 *
 *              IMPORTANT: this file intentionally reads credentials from `process.env` as a
 *              scaffold-only pattern. Production providers receive credentials via the
 *              credential injection mechanism (via DI / `input.channelId` lookup) — replace
 *              before wiring a real adapter.
 * @layer infrastructure
 */
import {
  ok,
  err,
  type Result,
  type CanonicalPost,
  type RenderedContent,
  type ThreadPlan,
  type ThreadPublishInput,
  type ThreadReceipt,
  type RenderError,
  type PublishError,
  type ThreadError,
} from "@shared/types";
import type {
  ProviderAdapter,
  RenderedPost as _RenderedPost,
  PublishInput,
  PublishReceipt,
} from "@ports/core";
import { planThread } from "@core/threading";
import { ProviderApiClient, type ProviderCredentials } from "./apiClient.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:template");

// Adjust these limits based on your provider's specifications
export const templateProviderAdapter: ProviderAdapter = {
  id: "x", // Replace with your provider's ID: "x" | "instagram" | "facebook" | "youtube" | "tiktok"
  limits: {
    maxChars: 280, // Adjust character limit
    allowedMedia: ["image", "video", "gif"], // Adjust allowed media types
    aspectRatios: ["16:9", "1:1", "4:5", "9:16"], // Adjust allowed aspect ratios
    maxPostsPerThread: 25, // Adjust thread limits (was maxTweetsPerThread)
    maxMediaPerPost: 4, // Adjust media limits (was maxMediaPerTweet)
    threadingSupported: true, // Set to false if threading not supported
    rateLimitHints: { burst: 300, perSeconds: 10800 }, // Adjust rate limits
  },
  capabilities: {
    publish: true,
    schedule: true, // Set based on provider capabilities
    analytics: true, // Set based on provider capabilities
    comments: true, // Set based on provider capabilities
    replies: true, // Set based on provider capabilities
    threading: true, // Set based on provider capabilities
    mentions: false, // Set true only with a brand-mention search/webhook impl
  },

  async validateCredentials(
    creds: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    // Validate provider credentials structure
    const credentials = creds as ProviderCredentials;

    if (!credentials?.apiKey) {
      return err("AUTH_INVALID");
    }

    try {
      const apiClient = new ProviderApiClient(credentials);
      const result = await apiClient.validateCredentials();

      if (!result.valid) {
        return err("AUTH_INVALID");
      }

      return ok(undefined);
    } catch (error: unknown) {
      const e = error as { message?: string; status?: number };
      logger.warn({ err: e }, "Provider API credential validation failed");

      // Handle specific error types
      if (e.status === 401) {
        return err("AUTH_EXPIRED");
      }

      return err("AUTH_INVALID");
    }
  },

  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    // Map canonical media to the RenderedPost media format
    const renderedMedia = canonical.media?.map((m) => ({
      url: m.url,
      type: m.type,
      ...(m.alt !== undefined && { alt: m.alt }),
    }));

    // Check if content needs threading (if supported)
    if (this.limits.threadingSupported) {
      const threadPlan = planThread(canonical, "AUTO", {
        maxCharsPerTweet: this.limits.maxChars,
        ...(this.limits.maxPostsPerThread !== undefined && {
          maxTweetsPerThread: this.limits.maxPostsPerThread,
        }),
        ...(this.limits.maxMediaPerPost !== undefined && {
          maxMediaPerTweet: this.limits.maxMediaPerPost,
        }),
      });

      if (!threadPlan.ok) {
        return err(threadPlan.error);
      }

      // Return appropriate rendered content
      if (threadPlan.value.needsThreading) {
        return ok({
          type: "thread",
          content: threadPlan.value,
          meta: { estimatedReach: threadPlan.value.estimatedReach },
        });
      } else {
        // Single post
        const singlePost = threadPlan.value.tweets[0];
        if (!singlePost) {
          return err("VALIDATION_ERROR");
        }
        return ok({
          type: "single",
          content: {
            body: singlePost.text,
            ...(renderedMedia !== undefined && { media: renderedMedia }),
            meta: { sequence: 1, totalTweets: 1 },
          },
          meta: {},
        });
      }
    } else {
      // Provider doesn't support threading - render as single post
      return ok({
        type: "single",
        content: {
          body: canonical.body.slice(0, this.limits.maxChars),
          ...(renderedMedia !== undefined && { media: renderedMedia }),
          meta: { sequence: 1, totalTweets: 1 },
        },
        meta: {},
      });
    }
  },

  planThread(canonical: CanonicalPost): Result<ThreadPlan, ThreadError> {
    if (!this.limits.threadingSupported) {
      return err("THREAD_PLANNING_FAILED");
    }

    return planThread(canonical, "AUTO", {
      maxCharsPerTweet: this.limits.maxChars,
      ...(this.limits.maxPostsPerThread !== undefined && {
        maxTweetsPerThread: this.limits.maxPostsPerThread,
      }),
      ...(this.limits.maxMediaPerPost !== undefined && {
        maxMediaPerTweet: this.limits.maxMediaPerPost,
      }),
    });
  },

  async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    // For single post publishing — credentials must be injected via a separate mechanism
    // in a real implementation (e.g., fetched from DB using input.channelId).
    // This template uses a placeholder pattern; replace with real credential lookup.
    const apiKey = process.env.PROVIDER_API_KEY;
    if (!apiKey) {
      return err("AUTH");
    }

    const credentials: ProviderCredentials = { apiKey };

    try {
      const apiClient = new ProviderApiClient(credentials);

      // Upload media first if present
      const mediaIds: string[] = [];
      const postText = input.post.text ?? input.post.body;
      if (input.post.media && input.post.media.length > 0) {
        for (const media of input.post.media) {
          const uploadResult = await apiClient.uploadMedia(media.url);
          mediaIds.push(uploadResult.media_id);
        }
      }

      // Post content with circuit breaker protection
      const result = await apiClient.postContent(postText, mediaIds);

      return ok({
        providerPostId: result.id,
        url: `https://provider.com/post/${result.id}`, // Adjust URL format
        publishedAt: new Date(result.created_at || new Date().toISOString()),
      });
    } catch (error: unknown) {
      const e = error as { message?: string; status?: number };
      logger.error({ err: error }, "Provider publish error");

      // Handle specific error types from circuit breaker
      if (e.status === 429) {
        return err("RATE_LIMIT");
      }

      if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
        return err("VALIDATION");
      }

      if (e.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  },

  async publishThread(input: ThreadPublishInput): Promise<Result<ThreadReceipt, PublishError>> {
    if (!this.limits.threadingSupported) {
      return err("VALIDATION");
    }

    const apiKey = process.env.PROVIDER_API_KEY;
    if (!apiKey) {
      return err("AUTH");
    }

    const credentials: ProviderCredentials = { apiKey };
    const publishedPosts: ThreadReceipt["tweets"] = [];
    let parentPostId: string | null = null;

    try {
      const apiClient = new ProviderApiClient(credentials);

      // Publish each post in sequence
      for (const postFragment of input.threadPlan.tweets) {
        // Upload media for this post
        const mediaIds: string[] = [];
        if (postFragment.media && postFragment.media.length > 0) {
          for (const media of postFragment.media) {
            const uploadResult = await apiClient.uploadMedia(media.url);
            mediaIds.push(uploadResult.media_id);
          }
        }

        // Post the content with circuit breaker protection
        const result = await apiClient.postContent(
          postFragment.text,
          mediaIds,
          parentPostId ? { reply_to: parentPostId } : undefined // Adjust based on provider's reply format
        );

        publishedPosts.push({
          sequence: postFragment.sequence,
          providerTweetId: result.id,
          url: `https://provider.com/post/${result.id}`, // Adjust URL format
          publishedAt: new Date(result.created_at || new Date().toISOString()),
        });

        // Set this post as parent for the next one
        parentPostId = result.id;

        // Small delay between posts to respect rate limits
        if (postFragment.sequence < input.threadPlan.tweets.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      return ok({
        threadId: input.dedupeKey,
        tweets: publishedPosts,
        totalTweets: publishedPosts.length,
      });
    } catch (error: unknown) {
      const e = error as { message?: string; status?: number };
      logger.error({ err: error }, "Provider thread publish error");

      // Handle specific error types from circuit breaker
      if (e.status === 429) {
        return err("RATE_LIMIT");
      }

      if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
        // If we fail mid-thread, this could be partially published
        if (publishedPosts.length > 0) {
          return err("THREAD_INTERRUPTED");
        }
        return err("VALIDATION");
      }

      if (e.message?.includes("Circuit breaker is OPEN")) {
        return err("NETWORK");
      }

      return err("NETWORK");
    }
  },

  async fetchAnalytics(q: { channelId: string; since?: Date; until?: Date }) {
    // Implement real provider analytics fetching
    const apiKey = process.env.PROVIDER_API_KEY;
    if (!apiKey) {
      return err("AUTH" as const);
    }

    try {
      // This would call provider's analytics endpoints
      // For now, return structured placeholder data
      return ok({
        channelId: q.channelId,
        period: { since: q.since, until: q.until },
        metrics: {
          impressions: 0,
          engagements: 0,
          likes: 0,
          shares: 0,
          comments: 0,
          profileClicks: 0,
        },
      });
    } catch (error: unknown) {
      logger.error({ err: error }, "Provider analytics error");
      return err("NETWORK" as const);
    }
  },
};

export async function fetchProviderAnalytics(channelId: string, since?: Date, until?: Date) {
  return (
    templateProviderAdapter.fetchAnalytics?.({
      channelId,
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
    }) ??
    ok({
      channelId,
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
      metrics: { views: 0, likes: 0, shares: 0, comments: 0 },
    })
  );
}
