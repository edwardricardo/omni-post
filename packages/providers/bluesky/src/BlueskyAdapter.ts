/**
 * @file BlueskyAdapter.ts
 * @description Bluesky provider adapter. Implements the ProviderAdapter port from
 *   @ports/core directly (no inheritance). Stateless w.r.t. credentials —
 *   credentials are passed per-call by the application layer.
 *   Supports text posts (max 300 chars) and image posts (max 4 images) via the
 *   AT Protocol with App Password authentication.
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
import { BlueskyClient, type BlueskyCredentials } from "./BlueskyClient.js";

export interface BlueskyProviderCredentials extends BlueskyCredentials {
  [key: string]: string | undefined;
}

const REQUIRED_FIELDS: (keyof BlueskyProviderCredentials)[] = ["identifier", "appPassword"];

const BLUESKY_LIMITS: ProviderLimits = {
  maxChars: 300,
  allowedMedia: ["image"],
  aspectRatios: ["1:1", "16:9", "4:3"],
  maxPostsPerThread: 1,
  maxMediaPerPost: 4,
  threadingSupported: false,
  rateLimitHints: { burst: 100, perSeconds: 3600 },
};

const BLUESKY_METADATA: ProviderMetadata = {
  id: "bluesky",
  name: "bluesky",
  displayName: "Bluesky",
  description: "Post to Bluesky via AT Protocol with App Password authentication",
  icon: "/providers/bluesky-icon.svg",
  color: "#0085ff",
  website: "https://bsky.app",
  authType: "api_key",
  requiredScopes: [],
  status: "active",
};

const BLUESKY_CAPABILITIES = {
  publish: true,
  schedule: false,
  analytics: false,
  comments: false,
  replies: false,
  threading: false,
  media: true,
  images: true,
  videos: false,
  stories: false,
  reels: false,
  communityPosts: false,
  linkCards: true,
};

/**
 * Factory for creating BlueskyClient instances. Injected so tests can supply
 * a fake. Defaults to constructing a real `BlueskyClient`.
 */
export type BlueskyClientFactory = (credentials: BlueskyCredentials) => BlueskyClient;

const defaultClientFactory: BlueskyClientFactory = (credentials) => new BlueskyClient(credentials);

export interface BlueskyAdapterDeps {
  /** Logger instance. Default: pino at level "info". */
  logger?: Logger;
  /** Factory that constructs a BlueskyClient given credentials. Default: real client. */
  clientFactory?: BlueskyClientFactory;
}

/**
 * @class BlueskyAdapter
 * @description Publishes content to Bluesky via AT Protocol.
 */
export class BlueskyAdapter implements ProviderAdapter {
  readonly id: ProviderId = "bluesky";
  readonly limits: ProviderLimits = BLUESKY_LIMITS;
  readonly capabilities = BLUESKY_CAPABILITIES;
  readonly metadata: ProviderMetadata = BLUESKY_METADATA;
  readonly constraints: ProviderConstraints = {};

  private readonly logger: Logger;
  private readonly clientFactory: BlueskyClientFactory;

  constructor(deps: BlueskyAdapterDeps = {}) {
    this.logger = deps.logger ?? pino({ name: "bluesky-adapter", level: "info" });
    this.clientFactory = deps.clientFactory ?? defaultClientFactory;
  }

  /**
   * @method validateCredentials
   * @description Verifies that supplied credentials are well-formed and accepted
   *   by Bluesky. Used by ConnectChannel before persisting a channel.
   */
  async validateCredentials(
    credentials: unknown
  ): Promise<Result<void, "AUTH_INVALID" | "AUTH_EXPIRED">> {
    const validation = validateCredentialStructure<BlueskyProviderCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH_INVALID");
    }

    try {
      const client = this.clientFactory(validation.value);
      const loginResult = await client.login();
      if (!loginResult.ok) {
        return err("AUTH_INVALID");
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
   * @description Validates text length and renders content for publishing.
   */
  render(canonical: CanonicalPost): Result<RenderedContent, RenderError> {
    const text = canonical.body ?? "";

    if (text.length > this.limits.maxChars) {
      return err("TEXT_TOO_LONG");
    }

    if (canonical.media && canonical.media.length > this.limits.maxMediaPerPost) {
      return err("VALIDATION_ERROR");
    }

    const content = {
      body: text,
      ...(canonical.media &&
        canonical.media.length > 0 && {
          media: canonical.media.slice(0, 4).map((m) => ({
            url: m.url,
            type: m.type,
            ...(m.alt !== undefined && { alt: m.alt }),
          })),
        }),
    };

    return ok({ type: "single" as const, content });
  }

  /**
   * @method publish
   * @description Publishes a single text or image post to Bluesky using the
   *   credentials supplied by the caller.
   */
  async publish(
    input: PublishInput,
    credentials: unknown
  ): Promise<Result<PublishReceipt, PublishError>> {
    const validation = validateCredentialStructure<BlueskyProviderCredentials>(
      credentials,
      REQUIRED_FIELDS,
      this.logger,
      this.id
    );
    if (!validation.ok) {
      return err("AUTH");
    }

    const text = input.post.body ?? "";

    if (text.length > this.limits.maxChars) {
      return err("VALIDATION");
    }

    try {
      const client = this.clientFactory(validation.value);
      const loginResult = await client.login();
      if (!loginResult.ok) {
        return err("AUTH");
      }

      let result;

      if (input.post.media && input.post.media.length > 0) {
        const buffers: Buffer[] = [];
        const altTexts: string[] = [];

        for (const media of input.post.media.slice(0, 4)) {
          const response = await fetch(media.url);
          if (!response.ok) continue;
          const arrayBuffer = await response.arrayBuffer();
          buffers.push(Buffer.from(arrayBuffer));
          altTexts.push(media.alt ?? "");
        }

        result = await client.publishWithImages(text, buffers, altTexts);
      } else {
        result = await client.publishText(text);
      }

      if (!result.ok) {
        if (result.error === "VALIDATION") {
          return err("VALIDATION");
        }
        return err("NETWORK");
      }

      return ok({
        providerPostId: result.value.uri,
        url: `https://bsky.app/profile/${validation.value.identifier}`,
        publishedAt: new Date(),
      });
    } catch (error: unknown) {
      this.logger.error({
        provider: this.id,
        operation: "publish",
        channelId: input.channelId,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(mapErrorToPublishError(error));
    }
  }
}

/**
 * @function createBlueskyAdapter
 * @description Factory used by the composition root to instantiate the adapter
 *   with explicit dependencies (logger, optional client factory for tests).
 */
export function createBlueskyAdapter(deps: BlueskyAdapterDeps = {}): BlueskyAdapter {
  return new BlueskyAdapter(deps);
}
