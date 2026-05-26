/**
 * @file OAuthTokenRefresher.ts
 * @description Canonical OAuth 2.1 refresh-token exchange with rotation.
 *              On refresh, the provider-issued refresh token (when present)
 *              REPLACES the stored one — the previous refresh token is never
 *              reused (OAuth 2.0 Security BCP). Persistence reuses the
 *              existing AES-256-GCM credential envelope via the channel
 *              repository (no plaintext touches the DB). A failed refresh
 *              flags the channel for re-authorization.
 * @layer infrastructure
 */
import { type Result, ok, err } from "@shared/types";
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { ChannelId } from "@core/domain/value-objects/EntityId.js";

/** Minimal provider config the refresh exchange needs. */
export interface RefreshableProviderConfig {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

interface RefreshTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * @class OAuthTokenRefresher
 * @description Reusable refresh-with-rotation entry point for any standard
 *   OAuth 2.0 confidential client (`grant_type=refresh_token`, HTTP Basic
 *   client auth). Provider-specific refresh quirks are layered on by callers.
 */
export class OAuthTokenRefresher {
  constructor(private readonly channelRepository: ChannelRepository) {}

  /**
   * @method refresh
   * @description Refreshes the channel's access token, rotating the refresh
   *   token when the provider returns a new one, and persists the result
   *   encrypted. Any failure flags the channel for reauth and returns err.
   * @param channelId - Channel whose credentials to refresh.
   * @param config - Provider token endpoint + client credentials.
   * @returns ok on success; err("REFRESH_FAILED") otherwise.
   */
  async refresh(
    channelId: ChannelId,
    config: RefreshableProviderConfig
  ): Promise<Result<void, "REFRESH_FAILED">> {
    const found = await this.channelRepository.findById(channelId);
    if (!found.ok) {
      return err("REFRESH_FAILED");
    }
    const channel = found.value;
    const currentRefreshToken = channel.credentials.refreshToken;

    if (!currentRefreshToken) {
      return this.flagReauth(channelId, "No refresh token stored for channel");
    }

    let response: Response;
    try {
      response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: currentRefreshToken,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return this.flagReauth(channelId, "Refresh request failed (network/timeout)");
    }

    if (!response.ok) {
      return this.flagReauth(channelId, `Refresh rejected by provider (HTTP ${response.status})`);
    }

    let tokens: RefreshTokenResponse;
    try {
      tokens = (await response.json()) as RefreshTokenResponse;
    } catch {
      return this.flagReauth(channelId, "Refresh response was not valid JSON");
    }

    if (!tokens.access_token) {
      return this.flagReauth(channelId, "Refresh response missing access_token");
    }

    // Rotation: adopt the provider's new refresh token when present; the
    // previous one is dropped and never reused.
    const rotatedRefreshToken = tokens.refresh_token ?? currentRefreshToken;
    const updated = channel.updateCredentials({
      accessToken: tokens.access_token,
      refreshToken: rotatedRefreshToken,
      ...(tokens.expires_in !== undefined && {
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      }),
    });
    if (!updated.ok) {
      return err("REFRESH_FAILED");
    }

    const saved = await this.channelRepository.save(channel);
    if (!saved.ok) {
      return err("REFRESH_FAILED");
    }
    return ok(undefined);
  }

  /** Loads, flags the channel for reauth, persists, and returns err. */
  private async flagReauth(
    channelId: ChannelId,
    reason: string
  ): Promise<Result<void, "REFRESH_FAILED">> {
    const found = await this.channelRepository.findById(channelId);
    if (found.ok) {
      found.value.markForReauth(reason);
      await this.channelRepository.save(found.value);
    }
    return err("REFRESH_FAILED");
  }
}
