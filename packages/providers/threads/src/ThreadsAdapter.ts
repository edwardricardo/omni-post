/**
 * @file ThreadsAdapter.ts
 * @description Threads (Meta) provider adapter. Implements the ProviderAdapter
 *   port from @ports/core directly (no inheritance). Stateless w.r.t.
 *   credentials — credentials are passed per-call by the application layer.
 *   Publishes text, images, videos, and carousels via the Threads API
 *   (graph.threads.net) using the two-step container publishing flow.
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

const API_BASE = "https://graph.threads.net/v1.0";

export interface ThreadsCredentials {
  accessToken: string;
  userId: string;
  appId?: string;
  appSecret?: string;
  [key: string]: string | undefined;
}

const REQUIRED_FIELDS: (keyof ThreadsCredentials)[] = ["accessToken", "userId"];

const THREADS_LIMITS: ProviderLimits = {
  maxChars: 500,
  maxHashtags: 30,
  allowedMedia: ["image", "video"],
  aspectRatios: ["1:1", "4:5", "9:16", "16:9"],
  maxPostsPerThread: 1,
  maxMediaPerPost: 10,
  threadingSupported: false,
  rateLimitHints: { burst: 60, perSeconds: 86400 },
};

const THREADS_METADATA: ProviderMetadata = {
  id: "threads",
  name: "threads",
  displayName: "Threads",
  description: "Meta's text-based social platform for sharing ideas and joining conversations",
  icon: "/providers/threads-icon.svg",
  color: "#000000",
  website: "https://threads.net",
  authType: "oauth",
  requiredScopes: [
    "threads_basic",
    "threads_content_publish",
    "threads_read_replies",
    "threads_manage_replies",
  ],
  status: "active",
};

const THREADS_CAPABILITIES = {
  publish: true,
  mentions: false,
  schedule: false,
  analytics: true,
  comments: true,
  replies: true,
  threading: false,
};

export interface ThreadsAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
}

/**
 * @class ThreadsAdapter
 * @description Provider adapter for publishing to Meta Threads via the Graph
 *   API. Uses native fetch for all HTTP calls (no separate concrete client).
 */
export class ThreadsAdapter implements ProviderAdapter {
  readonly id: ProviderId = "threads";
  readonly limits: ProviderLimits = THREADS_LIMITS;
  readonly capabilities = THREADS_CAPABILITIES;
  readonly metadata: ProviderMetadata = THREADS_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;

  constructor(deps: ThreadsAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "threads-adapter", level: "info" });
  }

  /**
   * @method validateCredentials
   * @description Verifies that the supplied credentials carry the required
   *   fields. The Threads Graph API does not expose a lightweight ping, so
   *   only the structural shape is checked here.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<ThreadsCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH_INVALID");
    }
    return ok(undefined);
  }

  /**
   * @method render
   * @description Renders a canonical post into Threads single-content form,
   *   truncating the body to the 500-char limit.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const body = canonical.body.slice(0, 500);
    const mediaUrls = (canonical.media ?? []).map((m) => m.url);
    return ok({
      type: "single" as const,
      content: {
        body,
        media: (canonical.media ?? []).map((m) => ({
          url: m.url,
          type: m.type as "image" | "video" | "gif",
        })),
      },
      meta: { provider: "threads", mediaUrls },
    });
  }

  /**
   * @method publish
   * @description Publishes a post to Threads using the two-step container flow:
   *   create container → wait for media (if any) → publish. Carousel posts
   *   create child item containers first.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<ThreadsCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const creds = validation.value;
      const post = input.post as { body?: string; text?: string; media?: Array<{ url: string }> };
      const text = (post.body ?? post.text ?? "").slice(0, 500);
      const mediaUrls = (post.media ?? []).map((m) => m.url);

      const containerId = await this.createContainer(creds, text, mediaUrls);

      if (mediaUrls.length > 0) {
        await this.waitForContainer(creds.accessToken, containerId);
      }

      const result = await this.publishContainer(creds, containerId);

      return ok({
        providerPostId: result.id,
        url: `https://www.threads.net/post/${result.id}`,
        publishedAt: new Date(),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publish",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      // Route the HTTP status carried by the container helpers through the shared
      // classifier: 401/403 → AUTH, 429 → RATE_LIMIT, other 4xx → VALIDATION,
      // 5xx → NETWORK. A blanket NETWORK would hide a revoked token from reauth.
      return err(mapErrorToPublishError(error));
    }
  }

  /**
   * @method fetchAnalytics
   * @description Aggregates per-post insights (views, likes, replies, reposts,
   *   quotes) for the channel since the supplied date.
   */
  async fetchAnalytics(
    q: { channelId: string; since?: Date; until?: Date },
    credentials: unknown
  ): Promise<Result<unknown, "AUTH" | "NETWORK">> {
    const validation = validateCredentialStructure<ThreadsCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    try {
      const creds = validation.value;

      const since = q.since ?? new Date(Date.now() - 30 * 86400000);
      const sinceTs = Math.floor(since.getTime() / 1000);

      const postsRes = await fetch(
        `${API_BASE}/${creds.userId}/threads?fields=id,timestamp&since=${sinceTs}&limit=50&access_token=${creds.accessToken}`
      );
      if (!postsRes.ok) return err("NETWORK");
      const postsData = (await postsRes.json()) as { data?: Array<{ id: string }> };

      const metrics: Array<{
        date: string;
        postId: string;
        views: number;
        likes: number;
        comments: number;
        shares: number;
      }> = [];

      for (const post of postsData.data ?? []) {
        const insightsRes = await fetch(
          `${API_BASE}/${post.id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${creds.accessToken}`
        );
        if (!insightsRes.ok) continue;
        const insightsData = (await insightsRes.json()) as {
          data?: Array<{ name: string; values?: Array<{ value: number }> }>;
        };

        const m = Object.fromEntries(
          (insightsData.data ?? []).map((d) => [d.name, d.values?.[0]?.value ?? 0])
        );

        metrics.push({
          date: new Date().toISOString().slice(0, 10),
          postId: post.id,
          views: (m.views as number) ?? 0,
          likes: (m.likes as number) ?? 0,
          comments: (m.replies as number) ?? 0,
          shares: ((m.reposts as number) ?? 0) + ((m.quotes as number) ?? 0),
        });
      }

      return ok({ metrics });
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
   * @description Lists replies to the channel since the supplied date.
   */
  async getComments(params: {
    channelCredentials: unknown;
    postExternalId?: string;
    since?: Date;
    cursor?: string;
    limit?: number;
  }): Promise<Result<{ comments: ProviderComment[]; nextCursor?: string }, "AUTH" | "NETWORK">> {
    try {
      const creds = params.channelCredentials as ThreadsCredentials;
      if (!creds.accessToken) return err("AUTH");

      const since = params.since ?? new Date(Date.now() - 7 * 86400000);
      const sinceTs = Math.floor(since.getTime() / 1000);

      const res = await fetch(
        `${API_BASE}/${creds.userId}/replies?fields=id,text,username,timestamp&since=${sinceTs}&limit=${params.limit ?? 50}&access_token=${creds.accessToken}`
      );
      if (!res.ok) return err("NETWORK");

      const data = (await res.json()) as {
        data?: Array<{ id: string; text: string; username: string; timestamp: string }>;
        paging?: { cursors?: { after?: string } };
      };

      const comments: ProviderComment[] = (data.data ?? []).map((r) => ({
        providerMessageId: r.id,
        authorName: r.username,
        authorProviderId: r.username,
        body: r.text,
        createdAt: new Date(r.timestamp),
      }));

      const nextCursor = data.paging?.cursors?.after;
      return ok({ comments, ...(nextCursor !== undefined && { nextCursor }) });
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
   * @description Posts a reply to a specific provider message via the two-step
   *   container flow.
   */
  async postReply(params: {
    channelCredentials: unknown;
    inReplyToProviderMessageId: string;
    body: string;
  }): Promise<Result<ProviderReplyResult, "AUTH" | "NETWORK" | "RATE_LIMIT">> {
    try {
      const creds = params.channelCredentials as ThreadsCredentials;
      if (!creds.accessToken) return err("AUTH");

      const containerRes = await fetch(`${API_BASE}/${creds.userId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "TEXT",
          text: params.body,
          reply_to_id: params.inReplyToProviderMessageId,
          access_token: creds.accessToken,
        }),
      });
      if (!containerRes.ok) return err("NETWORK");
      const container = (await containerRes.json()) as { id: string };

      const publishRes = await fetch(`${API_BASE}/${creds.userId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: container.id,
          access_token: creds.accessToken,
        }),
      });
      if (!publishRes.ok) return err("NETWORK");
      const result = (await publishRes.json()) as { id: string };

      return ok({ providerReplyId: result.id, createdAt: new Date() });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "postReply",
        error: error instanceof Error ? error.message : String(error),
      });
      return err("NETWORK");
    }
  }

  // ----------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------

  /**
   * @method httpError
   * @description Builds an Error that carries the HTTP `status` so the publish
   *   catch can classify the failure (AUTH / RATE_LIMIT / VALIDATION / NETWORK)
   *   via the shared mapper, instead of collapsing every failure to NETWORK.
   * @param status - The HTTP response status.
   * @param message - The error message.
   * @returns An Error decorated with a numeric `status` field.
   */
  private httpError(status: number, message: string): Error {
    return Object.assign(new Error(message), { status });
  }

  private async createContainer(
    creds: ThreadsCredentials,
    text: string,
    mediaUrls: string[]
  ): Promise<string> {
    const body: Record<string, string> = { access_token: creds.accessToken };

    if (mediaUrls.length === 0) {
      body.media_type = "TEXT";
      body.text = text;
    } else if (mediaUrls.length === 1) {
      const url = mediaUrls[0]!;
      const isVideo = url.endsWith(".mp4") || url.endsWith(".mov");
      body.media_type = isVideo ? "VIDEO" : "IMAGE";
      body[isVideo ? "video_url" : "image_url"] = url;
      if (text) body.text = text;
    } else {
      body.media_type = "CAROUSEL";
      const itemIds: string[] = [];
      for (const url of mediaUrls) {
        const isVideo = url.endsWith(".mp4") || url.endsWith(".mov");
        const itemRes = await fetch(`${API_BASE}/${creds.userId}/threads`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            media_type: isVideo ? "VIDEO" : "IMAGE",
            [isVideo ? "video_url" : "image_url"]: url,
            is_carousel_item: true,
            access_token: creds.accessToken,
          }),
        });
        const item = (await itemRes.json()) as { id: string };
        itemIds.push(item.id);
      }
      body.children = itemIds.join(",");
      if (text) body.text = text;
    }

    const res = await fetch(`${API_BASE}/${creds.userId}/threads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as { id?: string; error?: { message: string } };
    if (!res.ok || !data.id) {
      throw this.httpError(res.status, data.error?.message ?? "Failed to create Threads container");
    }
    return data.id;
  }

  private async publishContainer(
    creds: ThreadsCredentials,
    containerId: string
  ): Promise<{ id: string }> {
    const res = await fetch(`${API_BASE}/${creds.userId}/threads_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: creds.accessToken,
      }),
    });

    const data = (await res.json()) as { id?: string; error?: { message: string } };
    if (!res.ok || !data.id) {
      throw this.httpError(
        res.status,
        data.error?.message ?? "Failed to publish Threads container"
      );
    }
    return { id: data.id };
  }

  private async waitForContainer(
    accessToken: string,
    containerId: string,
    maxAttempts = 10
  ): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(
        `${API_BASE}/${containerId}?fields=status&access_token=${accessToken}`
      );
      const data = (await res.json()) as { status?: string };

      if (data.status === "FINISHED") return;
      if (data.status === "ERROR") {
        throw new Error("Threads media container failed");
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Threads media container timed out");
  }
}

/**
 * @function createThreadsAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger).
 */
export function createThreadsAdapter(deps: ThreadsAdapterDeps = {}): ThreadsAdapter {
  return new ThreadsAdapter(deps);
}
