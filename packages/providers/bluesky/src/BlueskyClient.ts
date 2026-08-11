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
 * Formats Bluesky accepts for image blobs. The magic-byte gate below admits
 * ONLY these into image-size: its ICNS/JXL/HEIF parsers can be driven into an
 * infinite loop by a crafted buffer (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq
 * — no patched release exists), and a hung parser blocks the event loop, which
 * a try/catch cannot contain. Restricting by leading bytes makes the
 * vulnerable parsers unreachable regardless of what the upload claims to be.
 */
function isAcceptedImageFormat(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }
  // GIF: "GIF8"
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return true;
  }
  // WebP: "RIFF"....  "WEBP"
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }
  return false;
}

/**
 * Reads image dimensions from a Uint8Array buffer without loading the full image.
 * Returns undefined if dimensions cannot be determined — either because the
 * buffer is not one of the formats Bluesky accepts (see the magic-byte gate)
 * or because the accepted-format parse fails. The aspectRatio hint is optional
 * on Bluesky uploads, so declining to measure is always safe.
 */
function getImageDimensions(buffer: Uint8Array): { width: number; height: number } | undefined {
  if (!isAcceptedImageFormat(buffer)) {
    return undefined;
  }
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
  async publishText(text: string): Promise<Result<BlueskyPostResult, "PUBLISH" | "VALIDATION">> {
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
    } catch {
      return err("PUBLISH");
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
  ): Promise<Result<BlueskyPostResult, "PUBLISH" | "VALIDATION">> {
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
    } catch {
      return err("PUBLISH");
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
