/**
 * @file BlueskyClient.ts
 * @description Wrapper around AT Protocol Agent for Bluesky authentication and post publishing.
 * Uses the recommended Agent + CredentialSession pattern (AtpAgent is heading toward deprecation).
 * Handles App Password login, image blob uploads with aspectRatio, and link facet detection.
 * @layer infrastructure
 */

import { AtpAgent, CredentialSession, RichText } from "@atproto/api";
import { imageSize } from "image-size";
import { err, ok, type Result } from "@shared/types";

export interface BlueskyCredentials {
  /** Bluesky handle, e.g. "user.bsky.social" */
  identifier: string;
  /** App Password — format: xxxx-xxxx-xxxx-xxxx */
  appPassword: string;
}

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle: string;
}

export interface BlueskyPostResult {
  uri: string;
  cid: string;
}

/**
 * Discriminated publish-failure reason surfaced by the client. AUTH and
 * RATE_LIMIT are derived from `XRPCError.status` so the adapter can classify a
 * revoked app-password (AUTH) distinctly from a transient throttle/outage.
 */
export type BlueskyPublishError = "AUTH" | "RATE_LIMIT" | "PUBLISH" | "VALIDATION";

/**
 * Classifies a thrown AT Protocol error by its HTTP `status`: 401/403 → AUTH
 * (definitive — app-password revoked/invalid), 429 → RATE_LIMIT (transient),
 * anything else → PUBLISH (transient network/server). XRPCError carries `status`.
 */
function classifyBlueskyError(error: unknown): "AUTH" | "RATE_LIMIT" | "PUBLISH" {
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: unknown }).status
      : undefined;
  if (status === 401 || status === 403) {
    return "AUTH";
  }
  if (status === 429) {
    return "RATE_LIMIT";
  }
  return "PUBLISH";
}

export interface BlueskyMentionResult {
  uri: string;
  cid: string;
  authorDid: string;
  authorHandle: string;
  authorDisplayName?: string;
  authorAvatar?: string;
  text: string;
  lang?: string;
  createdAt: string;
}

export interface BlueskySearchResult {
  posts: BlueskyMentionResult[];
  cursor?: string;
}

const BSKY_SERVICE = new URL("https://bsky.social");

/**
 * Reads image dimensions from a Uint8Array buffer without loading the full image.
 * Returns undefined if dimensions cannot be determined (format not recognized).
 */
function getImageDimensions(buffer: Uint8Array): { width: number; height: number } | undefined {
  try {
    const result = imageSize(buffer);
    if (result.width !== undefined && result.height !== undefined) {
      return { width: result.width, height: result.height };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * @class BlueskyClient
 * @description Low-level AT Protocol client. Each instance represents one authenticated session.
 * Uses Agent + CredentialSession (recommended pattern for @atproto/api v0.13+).
 */
export class BlueskyClient {
  private session: CredentialSession;
  /**
   * AtpAgent wraps Agent + CredentialSession. Using AtpAgent(session) instead of
   * AtpAgent({ service }) makes the session explicit and ready for future migration
   * to Agent(session) once the TypeScript structural typing issue in @atproto/api
   * is resolved upstream.
   */
  private agent: AtpAgent;
  private credentials: BlueskyCredentials;

  constructor(credentials: BlueskyCredentials) {
    this.credentials = credentials;
    this.session = new CredentialSession(BSKY_SERVICE);
    this.agent = new AtpAgent(this.session);
  }

  /**
   * @method login
   * @description Authenticates with App Password via CredentialSession and establishes a session.
   */
  async login(): Promise<Result<BlueskySession, "AUTH">> {
    try {
      await this.session.login({
        identifier: this.credentials.identifier,
        password: this.credentials.appPassword,
      });

      const s = this.session.session;
      if (!s) {
        return err("AUTH");
      }

      return ok({
        accessJwt: s.accessJwt,
        refreshJwt: s.refreshJwt,
        did: s.did,
        handle: s.handle,
      });
    } catch {
      return err("AUTH");
    }
  }

  /**
   * @method publishText
   * @description Publishes a plain text post with auto-detected link facets.
   * Returns the AT-URI and CID of the created record.
   */
  async publishText(text: string): Promise<Result<BlueskyPostResult, BlueskyPublishError>> {
    if (text.length > 300) {
      return err("VALIDATION");
    }

    try {
      const rt = new RichText({ text });
      await rt.detectFacets(this.agent);

      const response = await this.agent.post({
        text: rt.text,
        ...(rt.facets !== undefined && { facets: rt.facets }),
        createdAt: new Date().toISOString(),
      });

      return ok({ uri: response.uri, cid: response.cid });
    } catch (error: unknown) {
      return err(classifyBlueskyError(error));
    }
  }

  /**
   * @method publishWithImages
   * @description Uploads image blobs and publishes a post with an embed.images record.
   * Includes aspectRatio for each image (strongly recommended by Bluesky for correct rendering).
   * Maximum 4 images per post. Images must be < 1,000,000 bytes each.
   */
  async publishWithImages(
    text: string,
    imageBuffers: Uint8Array[],
    altTexts: string[]
  ): Promise<Result<BlueskyPostResult, BlueskyPublishError>> {
    if (text.length > 300) {
      return err("VALIDATION");
    }

    if (imageBuffers.length > 4) {
      return err("VALIDATION");
    }

    // Validate image sizes before uploading (1,000,000 bytes limit per Bluesky spec)
    for (const buf of imageBuffers) {
      if (buf.byteLength > 1_000_000) {
        return err("VALIDATION");
      }
    }

    try {
      const rt = new RichText({ text });
      await rt.detectFacets(this.agent);

      const uploadedImages = await Promise.all(
        imageBuffers.map(async (buffer, i) => {
          const upload = await this.agent.uploadBlob(buffer, {
            encoding: "image/jpeg",
          });

          const dimensions = getImageDimensions(buffer);

          return {
            image: upload.data.blob,
            alt: altTexts[i] ?? "",
            ...(dimensions !== undefined && {
              aspectRatio: {
                width: dimensions.width,
                height: dimensions.height,
              },
            }),
          };
        })
      );

      const response = await this.agent.post({
        text: rt.text,
        ...(rt.facets !== undefined && { facets: rt.facets }),
        embed: {
          $type: "app.bsky.embed.images",
          images: uploadedImages,
        },
        createdAt: new Date().toISOString(),
      });

      return ok({ uri: response.uri, cid: response.cid });
    } catch (error: unknown) {
      return err(classifyBlueskyError(error));
    }
  }

  /**
   * @method searchPosts
   * @description Searches recent public posts matching the query (brand-mention
   *   listening) via app.bsky.feed.searchPosts. Assumes the session has been
   *   established via `login()` first. Sorted latest-first; paginated by cursor.
   * @param query - Search query (terms joined with OR / quoted phrases)
   * @param limit - Max results per page (1-100, default 25)
   * @param since - ISO timestamp lower bound
   * @param cursor - Pagination cursor from a previous response
   */
  async searchPosts(
    query: string,
    limit: number = 25,
    since?: string,
    cursor?: string
  ): Promise<Result<BlueskySearchResult, "NETWORK" | "RATE_LIMIT">> {
    try {
      const res = await this.agent.app.bsky.feed.searchPosts({
        q: query,
        limit: Math.min(Math.max(limit, 1), 100),
        sort: "latest",
        ...(since ? { since } : {}),
        ...(cursor ? { cursor } : {}),
      });

      const posts: BlueskyMentionResult[] = res.data.posts.map((p) => {
        const record = (p.record ?? {}) as {
          text?: string;
          createdAt?: string;
          langs?: string[];
        };
        const firstLang = record.langs?.[0];
        return {
          uri: p.uri,
          cid: p.cid,
          authorDid: p.author.did,
          authorHandle: p.author.handle,
          text: record.text ?? "",
          createdAt: record.createdAt ?? p.indexedAt,
          ...(p.author.displayName ? { authorDisplayName: p.author.displayName } : {}),
          ...(p.author.avatar ? { authorAvatar: p.author.avatar } : {}),
          ...(firstLang ? { lang: firstLang } : {}),
        };
      });

      return ok({ posts, ...(res.data.cursor ? { cursor: res.data.cursor } : {}) });
    } catch (error: unknown) {
      const status =
        error instanceof Error && "status" in error
          ? (error as Record<string, unknown>).status
          : undefined;
      if (status === 429) {
        return err("RATE_LIMIT");
      }
      return err("NETWORK");
    }
  }
}
