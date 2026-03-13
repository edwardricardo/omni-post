/**
 * @file BlueskyAdapter.ts
 * @description Bluesky provider adapter extending AbstractProviderAdapter.
 * Supports text posts (max 300 chars) and image posts (max 4 images).
 * Uses AT Protocol with App Password authentication.
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
  Result,
  RenderError,
  PublishError,
} from "@shared/types";
import { ok, err } from "@shared/types";
import { BlueskyClient, type BlueskyCredentials } from "./BlueskyClient.js";

/**
 * Bluesky credentials implement ProviderCredentials (index signature required by base class).
 * The index signature allows arbitrary string keys while preserving required typed fields.
 */
export interface BlueskyProviderCredentials extends BlueskyCredentials {
  [key: string]: string | undefined;
}

/**
 * @class BlueskyAdapter
 * @description Publishes content to Bluesky via AT Protocol.
 */
export class BlueskyAdapter extends AbstractProviderAdapter<BlueskyProviderCredentials> {
  readonly id: ProviderId = "bluesky";

  readonly metadata: ProviderMetadata = {
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

  readonly constraints: ProviderConstraints = {};

  readonly limits: ProviderLimits = {
    maxChars: 300,
    allowedMedia: ["image"],
    aspectRatios: ["1:1", "16:9", "4:3"],
    maxPostsPerThread: 1,
    maxMediaPerPost: 4,
    threadingSupported: false,
    rateLimitHints: { burst: 100, perSeconds: 3600 },
  };

  readonly capabilities = {
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

  protected readonly requiredCredentialFields: (keyof BlueskyProviderCredentials)[] = [
    "identifier",
    "appPassword",
  ];

  /**
   * @method createApiClient
   * @description Creates a BlueskyClient from the given credentials.
   */
  protected createApiClient(credentials: BlueskyProviderCredentials): BlueskyClient {
    return new BlueskyClient({
      identifier: credentials.identifier ?? "",
      appPassword: credentials.appPassword ?? "",
    });
  }

  /**
   * @method getCredentialsFromEnvironment
   * @description Reads Bluesky credentials from environment variables.
   */
  protected getCredentialsFromEnvironment(): Result<BlueskyProviderCredentials, "AUTH"> {
    const identifier = process.env.BLUESKY_IDENTIFIER;
    const appPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!identifier || !appPassword) {
      return err("AUTH");
    }

    return ok({ identifier, appPassword });
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
   * @description Publishes a single text or image post to Bluesky.
   */
  override async publish(input: PublishInput): Promise<Result<PublishReceipt, PublishError>> {
    const credResult = await this.getCredentials(input.channelId);
    if (!credResult.ok) {
      return err("AUTH");
    }

    const client = this.createApiClient(credResult.value);
    const loginResult = await client.login();
    if (!loginResult.ok) {
      return err("AUTH");
    }

    const text = input.post.body ?? "";

    if (text.length > this.limits.maxChars) {
      return err("VALIDATION");
    }

    try {
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
        url: `https://bsky.app/profile/${credResult.value.identifier}`,
        publishedAt: new Date(),
      });
    } catch (error: unknown) {
      this.logError("publish", error, { channelId: input.channelId });
      return err(this.mapErrorToPublishError(error));
    }
  }
}

export const blueskyAdapter = new BlueskyAdapter();
