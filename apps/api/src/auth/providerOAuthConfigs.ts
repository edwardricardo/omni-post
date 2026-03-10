/**
 * OAuth Provider Configurations
 *
 * Provider-specific OAuth configurations and validation code implementations.
 * Extracted from providerOAuth.ts to keep files under 800 lines.
 *
 * Active providers (fully implemented):
 *   - x (Twitter/X) -- PKCE S256 flow
 *   - instagram     -- Instagram Basic Display API
 *   - facebook      -- Facebook Graph API v18.0
 *   - youtube       -- Google OAuth 2.0 / YouTube Data API v3
 *   - tiktok        -- TikTok Login Kit
 *   - linkedin      -- LinkedIn OAuth 2.0 (Posts API)
 *   - pinterest     -- Pinterest OAuth 2.0 (API v5)
 *   - snapchat      -- Snapchat OAuth 2.0 (Public Profile API)
 *
 * Non-OAuth provider:
 *   - telegram      -- Uses Bot API token, not OAuth. Stub entry satisfies
 *                      Record<ProviderId, OAuthProvider> type contract.
 *
 * @module auth/providerOAuthConfigs
 */
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import { AppError } from "../lib/errors/AppError.js";
import { getRedisInstance } from "./redisSessionHelpers.js";

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
}

export interface OAuthProvider {
  id: ProviderId;
  config: OAuthConfig;
  validateCode(
    code: string,
    state: string
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresIn?: number;
    accountInfo: {
      id: string;
      name: string;
      username?: string;
      profileImage?: string;
      verified?: boolean;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Helpers — declared before oauthProviders to avoid Temporal Dead Zone errors
// ---------------------------------------------------------------------------

/** Placeholder config for providers whose OAuth flow is not yet built. */
const EMPTY_OAUTH_CONFIG: OAuthConfig = {
  clientId: "",
  clientSecret: "",
  redirectUri: "",
  scopes: [],
  authUrl: "",
  tokenUrl: "",
};

/**
 * Creates a stub OAuthProvider entry for a platform whose OAuth
 * integration has not been implemented yet. Calling `validateCode()`
 * on the returned object throws a typed `AppError` with
 * `ErrorCode.CONFIGURATION_ERROR` so the error is handled consistently
 * by the centralised error handler and never leaks raw stack traces.
 */
function createUnimplementedProvider(id: ProviderId): OAuthProvider {
  return {
    id,
    config: { ...EMPTY_OAUTH_CONFIG },
    async validateCode(): Promise<never> {
      throw AppError.configuration(
        `Provider "${id}" does not use OAuth. ` +
          `Telegram uses Bot API token authentication — configure credentials via the provider settings page.`,
        { provider: id }
      );
    },
  };
}

/**
 * OAuth Provider Configurations for all supported platforms
 */
export const oauthProviders: Record<ProviderId, OAuthProvider> = {
  x: {
    id: "x",
    config: {
      clientId: process.env.X_CLIENT_ID || "",
      clientSecret: process.env.X_CLIENT_SECRET || "",
      redirectUri: process.env.X_REDIRECT_URI || "http://localhost:3000/auth/callback/x",
      scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
      authUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
    },
    /**
     * Exchange an authorization code for tokens with X/Twitter OAuth 2.0.
     *
     * Implements the PKCE S256 verification step:
     * 1. Retrieves the `code_verifier` from Redis using key `pkce:{state}`
     * 2. Sends the verifier to the token endpoint for server-side challenge verification
     * 3. Deletes the Redis key after retrieval (one-time use, prevents replay attacks)
     *
     * The authorization server computes SHA-256(code_verifier) and compares it to the
     * `code_challenge` that was sent during the authorization request. This proves that
     * the same client that initiated the flow is completing it, preventing authorization
     * code interception attacks.
     *
     * @param code - The authorization code from the OAuth callback
     * @param state - The state parameter used to look up the stored PKCE verifier
     */
    async validateCode(code: string, state: string) {
      const config = this.config;

      // Retrieve the PKCE code_verifier stored during authorization URL generation
      const redis = getRedisInstance();
      let codeVerifier = "challenge"; // Fallback for environments without Redis
      if (redis) {
        const storedVerifier = await redis.get(`pkce:${state}`);
        if (storedVerifier) {
          codeVerifier = storedVerifier;
          // Delete after retrieval - one-time use to prevent replay attacks
          await redis.del(`pkce:${state}`);
        }
      }

      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
          code_verifier: codeVerifier,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(
        "https://api.twitter.com/2/users/me?user.fields=profile_image_url,verified",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch X user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: userInfo.data.id,
          name: userInfo.data.name,
          username: userInfo.data.username,
          profileImage: userInfo.data.profile_image_url,
          verified: userInfo.data.verified || false,
        },
      };
    },
  },

  instagram: {
    id: "instagram",
    config: {
      clientId: process.env.INSTAGRAM_CLIENT_ID || "",
      clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || "",
      redirectUri:
        process.env.INSTAGRAM_REDIRECT_URI || "http://localhost:3000/auth/callback/instagram",
      scopes: ["user_profile", "user_media", "instagram_basic"],
      authUrl: "https://api.instagram.com/oauth/authorize",
      tokenUrl: "https://api.instagram.com/oauth/access_token",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
          code,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(
        `https://graph.instagram.com/me?fields=id,username,media_count,account_type&access_token=${tokens.access_token}`
      );

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch Instagram user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: userInfo.id,
          name: userInfo.username,
          username: userInfo.username,
          verified: userInfo.account_type === "BUSINESS",
        },
      };
    },
  },

  facebook: {
    id: "facebook",
    config: {
      clientId: process.env.FACEBOOK_CLIENT_ID || "",
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
      redirectUri:
        process.env.FACEBOOK_REDIRECT_URI || "http://localhost:3000/auth/callback/facebook",
      scopes: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
      authUrl: "https://www.facebook.com/v18.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v18.0/oauth/access_token",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(
        `${config.tokenUrl}?client_id=${config.clientId}&client_secret=${config.clientSecret}&redirect_uri=${config.redirectUri}&code=${code}`
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(
        `https://graph.facebook.com/me?fields=id,name,picture&access_token=${tokens.access_token}`
      );

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch Facebook user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: userInfo.id,
          name: userInfo.name,
          profileImage: userInfo.picture?.data?.url,
        },
      };
    },
  },

  youtube: {
    id: "youtube",
    config: {
      clientId: process.env.YOUTUBE_CLIENT_ID || "",
      clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
      redirectUri:
        process.env.YOUTUBE_REDIRECT_URI || "http://localhost:3000/auth/callback/youtube",
      scopes: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ],
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const channelResponse = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${tokens.access_token}` } }
      );

      if (!channelResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch YouTube channel info`);
      }

      const channelInfo = await channelResponse.json();

      if (!channelInfo.items || channelInfo.items.length === 0) {
        throw new Error(`channel_not_found: No YouTube channel found for user`);
      }

      const channel = channelInfo.items[0];

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: channel.id,
          name: channel.snippet.title,
          username: channel.snippet.customUrl,
          profileImage: channel.snippet.thumbnails.default.url,
        },
      };
    },
  },

  tiktok: {
    id: "tiktok",
    config: {
      clientId: process.env.TIKTOK_CLIENT_ID || "",
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
      redirectUri: process.env.TIKTOK_REDIRECT_URI || "http://localhost:3000/auth/callback/tiktok",
      scopes: ["user.info.basic", "video.upload"],
      authUrl: "https://www.tiktok.com/auth/authorize/",
      tokenUrl: "https://open-api.tiktok.com/oauth/access_token/",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: config.clientId,
          client_secret: config.clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,username",
        { headers: { Authorization: `Bearer ${tokens.data.access_token}` } }
      );

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch TikTok user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.data.access_token,
        refreshToken: tokens.data.refresh_token,
        expiresIn: tokens.data.expires_in,
        accountInfo: {
          id: userInfo.data.user.open_id,
          name: userInfo.data.user.display_name,
          username: userInfo.data.user.username,
          profileImage: userInfo.data.user.avatar_url,
        },
      };
    },
  },

  // -----------------------------------------------------------------
  // LinkedIn — OAuth 2.0 Authorization Code Flow (Posts API)
  // -----------------------------------------------------------------
  linkedin: {
    id: "linkedin",
    config: {
      clientId: process.env.LINKEDIN_CLIENT_ID || "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "",
      redirectUri:
        process.env.LINKEDIN_REDIRECT_URI || "http://localhost:3000/auth/callback/linkedin",
      scopes: ["openid", "profile", "w_member_social"],
      authUrl: "https://www.linkedin.com/oauth/v2/authorization",
      tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch LinkedIn user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: userInfo.sub,
          name: userInfo.name,
          username: userInfo.email,
          profileImage: userInfo.picture,
        },
      };
    },
  },

  // -----------------------------------------------------------------
  // Pinterest — OAuth 2.0 Authorization Code Flow (API v5)
  // -----------------------------------------------------------------
  pinterest: {
    id: "pinterest",
    config: {
      clientId: process.env.PINTEREST_CLIENT_ID || "",
      clientSecret: process.env.PINTEREST_CLIENT_SECRET || "",
      redirectUri:
        process.env.PINTEREST_REDIRECT_URI || "http://localhost:3000/auth/callback/pinterest",
      scopes: ["boards:read", "boards:write", "pins:read", "pins:write"],
      authUrl: "https://www.pinterest.com/oauth/",
      tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch("https://api.pinterest.com/v5/user_account", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch Pinterest user info`);
      }

      const userInfo = await userResponse.json();

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: userInfo.username,
          name: userInfo.business_name || userInfo.username,
          username: userInfo.username,
          profileImage: userInfo.profile_image,
        },
      };
    },
  },

  // -----------------------------------------------------------------
  // Snapchat — OAuth 2.0 Authorization Code Flow (Public Profile API)
  // -----------------------------------------------------------------
  snapchat: {
    id: "snapchat",
    config: {
      clientId: process.env.SNAPCHAT_CLIENT_ID || "",
      clientSecret: process.env.SNAPCHAT_CLIENT_SECRET || "",
      redirectUri:
        process.env.SNAPCHAT_REDIRECT_URI || "http://localhost:3000/auth/callback/snapchat",
      scopes: ["snapchat-marketing-api"],
      authUrl: "https://accounts.snapchat.com/login/oauth2/authorize",
      tokenUrl: "https://accounts.snapchat.com/login/oauth2/access_token",
    },
    async validateCode(code: string, _state: string) {
      const config = this.config;
      const tokenResponse = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: config.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        throw new Error(`token_exchange_failure: ${errorText}`);
      }

      const tokens = await tokenResponse.json();

      const userResponse = await fetch("https://adsapi.snapchat.com/v1/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error(`user_info_fetch_failure: Failed to fetch Snapchat user info`);
      }

      const userInfo = await userResponse.json();
      const me = userInfo.me;

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        accountInfo: {
          id: me.id,
          name: me.display_name,
          username: me.email,
        },
      };
    },
  },

  // -----------------------------------------------------------------
  // Telegram — Uses Bot API token (not OAuth). This stub exists to
  // satisfy the Record<ProviderId, OAuthProvider> type contract.
  // Telegram authentication is handled via TelegramAdapter.validateCredentials()
  // which validates the bot token by calling the getMe endpoint.
  // -----------------------------------------------------------------
  telegram: createUnimplementedProvider("telegram"),
};
