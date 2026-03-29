import { createExternalApiCircuitBreaker } from "@adapters/external-apis";
import { CommonFallbackStrategies } from "@adapters/fallback-strategies";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import axios from "axios";
import * as crypto from "crypto";

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface TikTokLoginKitConfig extends TikTokOAuthConfig {
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
}

export interface TikTokAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  expiresAt: Date;
  tokenType: string;
  scope: string;
  openId: string;
  unionId?: string;
}

export interface TikTokUserProfile {
  openId: string;
  unionId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  avatarLargeUrl?: string;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
  verified: boolean;
  profileDeepLink: string;
  bioDescription?: string;
  websiteUrl?: string;
}

export interface TikTokBusinessProfile extends TikTokUserProfile {
  businessAccountType: "creator" | "business";
  category: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  isMarketingApiEnabled: boolean;
  advertiserAccountIds: string[];
}

export interface TikTokRefreshTokenResult {
  accessToken: string;
  expiresIn: number;
  expiresAt: Date;
  refreshToken?: string;
  scope: string;
}

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

const TIKTOK_AUTH_BASE_URL = "https://www.tiktok.com/v2/auth";
const TIKTOK_OAUTH_BASE_URL = "https://open.tiktokapis.com/v2/oauth";

export class TikTokAuthService {
  private config: TikTokOAuthConfig;

  constructor(config: TikTokOAuthConfig) {
    this.config = config;
  }

  /**
   * Generate OAuth authorization URL for TikTok Login Kit
   */
  generateAuthUrl(
    options: {
      state?: string;
      usePKCE?: boolean;
      additionalScopes?: string[];
    } = {}
  ): { url: string; state: string; codeVerifier?: string } {
    const state = options.state || crypto.randomBytes(16).toString("hex");
    const scopes = [...this.config.scopes, ...(options.additionalScopes || [])];

    const params = new URLSearchParams({
      client_key: this.config.clientKey,
      scope: scopes.join(","),
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      state,
    });

    let codeVerifier: string | undefined;
    if (options.usePKCE) {
      codeVerifier = crypto.randomBytes(32).toString("base64url");
      const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

      params.append("code_challenge", codeChallenge);
      params.append("code_challenge_method", "S256");
    }

    const url = `${TIKTOK_AUTH_BASE_URL}/authorize/?${params.toString()}`;

    return {
      url,
      state,
      ...(codeVerifier && { codeVerifier }),
    };
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    code: string,
    options: {
      state?: string;
      codeVerifier?: string;
    } = {}
  ): Promise<TikTokAuthResult> {
    const apiCall = async (): Promise<TikTokAuthResult> => {
      const params: Record<string, string> = {
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
      };

      if (options.codeVerifier) {
        params.code_verifier = options.codeVerifier;
      }

      const response = await axios.post(`${TIKTOK_OAUTH_BASE_URL}/token/`, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
      });

      if (response.data.error) {
        throw ProviderError.unauthorized(
          "tiktok",
          `TikTok OAuth error: ${response.data.error} - ${response.data.error_description}`
        );
      }

      const tokenData = response.data.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        expiresAt,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
        openId: tokenData.open_id,
        unionId: tokenData.union_id,
      };
    };

    return circuitBreaker.call("tiktok-auth-api", "exchange-code-for-token", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache auth tokens
      fallbackEnabled: false, // No fallback for auth operations
    });
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<TikTokRefreshTokenResult> {
    const apiCall = async (): Promise<TikTokRefreshTokenResult> => {
      const params = {
        client_key: this.config.clientKey,
        client_secret: this.config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      };

      const response = await axios.post(`${TIKTOK_OAUTH_BASE_URL}/token/`, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cache-Control": "no-cache",
        },
      });

      if (response.data.error) {
        throw ProviderError.unauthorized(
          "tiktok",
          `TikTok token refresh error: ${response.data.error} - ${response.data.error_description}`
        );
      }

      const tokenData = response.data.data;
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      return {
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in,
        expiresAt,
        refreshToken: tokenData.refresh_token,
        scope: tokenData.scope,
      };
    };

    return circuitBreaker.call("tiktok-auth-api", "refresh-access-token", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache auth tokens
      fallbackEnabled: false, // No fallback for auth operations
    });
  }

  /**
   * Get user profile information
   */
  async getUserProfile(
    accessToken: string,
    options: {
      includeStats?: boolean;
      includeBusiness?: boolean;
    } = {}
  ): Promise<TikTokUserProfile | TikTokBusinessProfile> {
    const apiCall = async (): Promise<TikTokUserProfile | TikTokBusinessProfile> => {
      const fields = [
        "open_id",
        "union_id",
        "username",
        "display_name",
        "avatar_url",
        "avatar_large_url",
        "profile_deep_link",
        "bio_description",
        "website_url",
        "verified",
      ];

      if (options.includeStats) {
        fields.push("follower_count", "following_count", "likes_count", "video_count");
      }

      if (options.includeBusiness) {
        fields.push(
          "business_account_type",
          "category",
          "business_email",
          "business_phone",
          "business_address"
        );
      }

      const response = await axios.post(
        `${TIKTOK_OAUTH_BASE_URL}/user/info/`,
        {
          fields: fields,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error?.code) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok API error: ${response.data.error.code} - ${response.data.error.message}`
        );
      }

      const user = response.data.data.user;

      const baseProfile: TikTokUserProfile = {
        openId: user.open_id,
        unionId: user.union_id,
        username: user.username,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
        avatarLargeUrl: user.avatar_large_url,
        followerCount: user.follower_count || 0,
        followingCount: user.following_count || 0,
        likesCount: user.likes_count || 0,
        videoCount: user.video_count || 0,
        verified: user.verified || false,
        profileDeepLink: user.profile_deep_link,
        bioDescription: user.bio_description,
        websiteUrl: user.website_url,
      };

      // Return business profile if business information is included
      if (options.includeBusiness && user.business_account_type) {
        return {
          ...baseProfile,
          businessAccountType: user.business_account_type,
          category: user.category,
          businessEmail: user.business_email,
          businessPhone: user.business_phone,
          businessAddress: user.business_address,
          isMarketingApiEnabled: user.is_marketing_api_enabled || false,
          advertiserAccountIds: user.advertiser_account_ids || [],
        } as TikTokBusinessProfile;
      }

      return baseProfile;
    };

    return circuitBreaker.call("tiktok-auth-api", "get-user-profile", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      cacheTtl: 300000, // 5 minutes cache for profile data
      fallbackEnabled: true,
      fallbackConfig: CommonFallbackStrategies.METADATA_FALLBACK,
    });
  }

  /**
   * Revoke access token
   */
  async revokeToken(accessToken: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      const response = await axios.post(
        `${TIKTOK_OAUTH_BASE_URL}/revoke/`,
        {
          client_key: this.config.clientKey,
          client_secret: this.config.clientSecret,
          token: accessToken,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data.error) {
        throw ProviderError.externalService(
          "tiktok",
          `TikTok token revocation error: ${response.data.error} - ${response.data.error_description}`
        );
      }

      return response.data.data?.revoked || true;
    };

    return circuitBreaker.call("tiktok-auth-api", "revoke-token", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 70,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false, // Don't cache revocation results
      fallbackEnabled: false, // No fallback for revocation
    });
  }

  /**
   * Validate access token
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.getUserProfile(accessToken, { includeStats: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if token needs refresh (expires within the next hour)
   */
  shouldRefreshToken(expiresAt: Date): boolean {
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

    return timeUntilExpiry <= oneHour;
  }

  /**
   * Generate Login Kit configuration for frontend
   */
  generateLoginKitConfig(
    options: {
      state?: string;
      usePKCE?: boolean;
      additionalScopes?: string[];
    } = {}
  ): TikTokLoginKitConfig {
    const state = options.state || crypto.randomBytes(16).toString("hex");
    let codeChallenge: string | undefined;
    let codeChallengeMethod: "S256" | "plain" | undefined;

    if (options.usePKCE) {
      const codeVerifier = crypto.randomBytes(32).toString("base64url");
      codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
      codeChallengeMethod = "S256";
    }

    return {
      clientKey: this.config.clientKey,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      scopes: [...this.config.scopes, ...(options.additionalScopes || [])],
      state,
      ...(codeChallenge && { codeChallenge }),
      ...(codeChallengeMethod && { codeChallengeMethod }),
    };
  }

  /**
   * Get available scopes for TikTok API
   */
  static getAvailableScopes(): Record<string, string> {
    return {
      "user.info.basic": "Access to basic user information",
      "user.info.profile": "Access to user profile information",
      "user.info.stats": "Access to user statistics",
      "video.list": "Access to user's video list",
      "video.upload": "Permission to upload videos",
      "video.publish": "Permission to publish videos",
      "research.adlib.basic": "Access to basic advertising library data",
      "research.data.basic": "Access to basic research data",
      "business.insights": "Access to business insights and analytics",
      "marketing.api": "Access to Marketing API functionality",
    };
  }

  /**
   * Get circuit breaker status for TikTok Auth API operations
   */
  getCircuitBreakerStatus(): Record<string, unknown> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * Get API metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clear API cache
   */
  clearCache(): void {
    circuitBreaker.clearCache("tiktok-auth-api");
  }
}
