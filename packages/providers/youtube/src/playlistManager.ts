/**
 * @file playlistManager.ts
 * @description YouTubePlaylistManager — CRUD operations and analytics for YouTube playlists.
 * Types are defined in playlistTypes.ts; pure analytics/optimization helpers live in
 * playlistAnalyticsHelpers.ts.
 * @layer infrastructure
 */

import { google, youtube_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { hashCallScope, METADATA_CB_OPTIONS } from "@adapters/external-apis";
import { ProviderError } from "@providers/shared";
import {
  circuitBreaker,
  type Playlist,
  type PlaylistCreateRequest,
  type PlaylistItem,
  type PlaylistUpdateRequest,
} from "./playlistTypes.js";

export type {
  Playlist,
  PlaylistCreateRequest,
  PlaylistItem,
  PlaylistUpdateRequest,
} from "./playlistTypes.js";

export class YouTubePlaylistManager {
  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private channelId: string;

  constructor(credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken?: string;
    channelId: string;
  }) {
    this.channelId = credentials.channelId;

    this.oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
      "urn:ietf:wg:oauth:2.0:oob"
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
      ...(credentials.accessToken && { access_token: credentials.accessToken }),
    });

    const youtubeFactory = (
      google as unknown as Record<string, ((...args: unknown[]) => youtube_v3.Youtube) | undefined>
    ).youtube;
    if (!youtubeFactory) throw new Error("google.youtube factory not available");
    this.youtube = youtubeFactory({
      version: "v3",
      auth: this.oauth2Client,
    });
  }

  /**
   * Create a new playlist
   */
  async createPlaylist(request: PlaylistCreateRequest): Promise<Playlist> {
    const apiCall = async (): Promise<Playlist> => {
      await this.refreshTokenIfNeeded();

      const yt = this.youtube as unknown as {
        playlists: { insert: (...args: unknown[]) => Promise<unknown> };
      };
      const response = (await yt.playlists.insert({
        part: ["snippet", "status", "localizations"],
        requestBody: {
          snippet: {
            title: request.title,
            description: request.description,
            tags: request.tags,
            defaultLanguage: request.defaultLanguage || "en",
          },
          status: {
            privacyStatus: request.privacy,
          },
          localizations: request.localizations,
        },
      })) as unknown as { data: youtube_v3.Schema$Playlist };

      if (!response.data) {
        throw ProviderError.externalService(
          "youtube",
          "Failed to create playlist - no response data"
        );
      }

      if (!response.data.id) {
        throw ProviderError.externalService(
          "youtube",
          "Failed to create playlist - no playlist ID"
        );
      }

      return this.mapPlaylistResponse(response.data);
    };

    return circuitBreaker.call("youtube-playlists", "create-playlist", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + request
      // so channel B never runs channel A's bound create closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, request),
    });
  }

  /**
   * Update an existing playlist
   */
  async updatePlaylist(playlistId: string, request: PlaylistUpdateRequest): Promise<Playlist> {
    const apiCall = async (): Promise<Playlist> => {
      await this.refreshTokenIfNeeded();

      // First, get the current playlist to preserve existing data
      const currentPlaylist = await this.youtube.playlists.list({
        part: ["snippet", "status"],
        id: [playlistId],
      });

      if (!currentPlaylist.data.items || currentPlaylist.data.items.length === 0) {
        throw ProviderError.notFound("youtube", "Playlist");
      }

      const current = currentPlaylist.data.items[0];
      if (!current) {
        throw ProviderError.notFound("youtube", "Playlist");
      }
      const currentSnippet = current.snippet!;

      const ytUpdate = this.youtube as unknown as {
        playlists: { update: (...args: unknown[]) => Promise<unknown> };
      };
      const response = (await ytUpdate.playlists.update({
        part: ["snippet", "status"],
        requestBody: {
          id: playlistId,
          snippet: {
            title: request.title || currentSnippet.title,
            description: request.description || currentSnippet.description,
            tags: request.tags || currentSnippet.tags,
            defaultLanguage: currentSnippet.defaultLanguage,
            channelId: this.channelId,
          },
          status: {
            privacyStatus: request.privacy || current.status?.privacyStatus,
          },
        },
      })) as unknown as { data: youtube_v3.Schema$Playlist };

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to update playlist");
      }

      return this.mapPlaylistResponse(response.data);
    };

    return circuitBreaker.call("youtube-playlists", "update-playlist", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + the
      // target playlist so acting on playlist B never runs playlist A's closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistId),
    });
  }

  /**
   * Delete a playlist
   */
  async deletePlaylist(playlistId: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      await this.youtube.playlists.delete({
        id: playlistId,
      });

      return true;
    };

    return circuitBreaker.call("youtube-playlists", "delete-playlist", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + the
      // target playlist (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistId),
    });
  }

  /**
   * Get all playlists for the channel
   */
  async getChannelPlaylists(maxResults: number = 50): Promise<Playlist[]> {
    const apiCall = async (): Promise<Playlist[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.playlists.list({
        part: ["snippet", "status", "contentDetails"],
        channelId: this.channelId,
        maxResults,
      });

      return (response.data.items || []).map((item) => this.mapPlaylistResponse(item));
    };

    return circuitBreaker.call("youtube-playlists", "get-channel-playlists", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // PII (channel playlists): fold channel + page size so channel B never
      // receives channel A's cached playlists and pages never collide.
      cacheKeyDiscriminant: hashCallScope(this.channelId, maxResults),
    });
  }

  /**
   * Get playlist details by ID
   */
  async getPlaylist(playlistId: string): Promise<Playlist> {
    const apiCall = async (): Promise<Playlist> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.playlists.list({
        part: ["snippet", "status", "contentDetails", "localizations"],
        id: [playlistId],
      });

      if (!response.data.items || response.data.items.length === 0) {
        throw ProviderError.notFound("youtube", "Playlist");
      }

      const playlist = response.data.items[0];
      if (!playlist) {
        throw ProviderError.notFound("youtube", "Playlist");
      }

      return this.mapPlaylistResponse(playlist);
    };

    return circuitBreaker.call("youtube-playlists", "get-playlist", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // Public-resource-by-id read: fold channel + playlistId so playlist X never
      // returns playlist Y's cached details and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistId),
    });
  }

  /**
   * Add video to playlist
   */
  async addVideoToPlaylist(
    playlistId: string,
    videoId: string,
    position?: number,
    note?: string,
    startAt?: number,
    endAt?: number
  ): Promise<PlaylistItem> {
    const apiCall = async (): Promise<PlaylistItem> => {
      await this.refreshTokenIfNeeded();

      const requestBody: youtube_v3.Schema$PlaylistItem = {
        snippet: {
          playlistId,
          resourceId: {
            kind: "youtube#video",
            videoId,
          },
          ...(position !== undefined && { position }),
        },
      };

      // Add time-based parameters if specified
      if (startAt !== undefined || endAt !== undefined) {
        requestBody.contentDetails = {
          ...(startAt !== undefined && { startAt: this.formatTimeOffset(startAt) }),
          ...(endAt !== undefined && { endAt: this.formatTimeOffset(endAt) }),
        };
      }

      // Note: snippet.note is not part of the official API schema but used by some implementations
      if (note && requestBody.snippet) {
        (requestBody.snippet as Record<string, unknown>).note = note;
      }

      const response = await this.youtube.playlistItems.insert({
        part: ["snippet", "contentDetails"],
        requestBody,
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to add video to playlist");
      }

      return this.mapPlaylistItemResponse(response.data);
    };

    return circuitBreaker.call("youtube-playlists", "add-video", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + the
      // playlist + video so adding to playlist B never runs playlist A's closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistId, videoId),
    });
  }

  /**
   * Remove video from playlist
   */
  async removeVideoFromPlaylist(playlistItemId: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      await this.youtube.playlistItems.delete({
        id: playlistItemId,
      });

      return true;
    };

    return circuitBreaker.call("youtube-playlists", "remove-video", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + the
      // playlist item so removing item B never runs item A's closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistItemId),
    });
  }

  /**
   * Update video position in playlist
   */
  async updateVideoPosition(
    playlistItemId: string,
    newPosition: number,
    playlistId: string,
    videoId: string
  ): Promise<PlaylistItem> {
    const apiCall = async (): Promise<PlaylistItem> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.playlistItems.update({
        part: ["snippet"],
        requestBody: {
          id: playlistItemId,
          snippet: {
            playlistId,
            position: newPosition,
            resourceId: {
              kind: "youtube#video",
              videoId,
            },
          },
        },
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to update video position");
      }

      return this.mapPlaylistItemResponse(response.data);
    };

    return circuitBreaker.call("youtube-playlists", "update-position", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + the
      // playlist item/playlist/video so reordering item B never runs item A's
      // closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistItemId, playlistId, videoId),
    });
  }

  /**
   * Get all videos in a playlist
   */
  async getPlaylistItems(playlistId: string, maxResults: number = 50): Promise<PlaylistItem[]> {
    const apiCall = async (): Promise<PlaylistItem[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.playlistItems.list({
        part: ["snippet", "contentDetails", "status"],
        playlistId,
        maxResults,
      });

      return (response.data.items || []).map((item) => this.mapPlaylistItemResponse(item));
    };

    return circuitBreaker.call("youtube-playlists", "get-playlist-items", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // Public-resource-by-id read: fold channel + playlistId + page size so
      // playlist X never returns playlist Y's cached items and pages never collide.
      cacheKeyDiscriminant: hashCallScope(this.channelId, playlistId, maxResults),
    });
  }

  // Future: Playlist Order Optimization
  // Once getPlaylistAnalytics is implemented with real YouTube Analytics API data,
  // use actual viewer retention, drop-off, and engagement metrics to recommend
  // optimal video ordering within playlists.

  /**
   * Get comprehensive playlist analytics
   */
  // Future: Playlist Analytics via YouTube Analytics API
  // Implement using the YouTube Analytics API (youtubeAnalytics.reports.query)
  // with dimensions=video, metrics=views,estimatedMinutesWatched,averageViewDuration,
  // averageViewPercentage,likes,comments. Requires youtube.readonly + yt-analytics.readonly
  // OAuth scopes. Aggregate per-video metrics into playlist-level totals, completion rates,
  // drop-off points, top performing videos, viewer flow, and real demographic breakdowns
  // from the YouTube Analytics demographics report.

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
      }
    } catch (error) {
      throw ProviderError.unauthorized(
        "youtube",
        `Failed to refresh YouTube Playlists token: ${error}`
      );
    }
  }

  private mapPlaylistResponse(item: youtube_v3.Schema$Playlist): Playlist {
    const snippet = item.snippet!;
    const status = item.status!;

    const result: Playlist = {
      id: item.id!,
      title: snippet.title || "",
      description: snippet.description || "",
      privacy: (status.privacyStatus as "public" | "private" | "unlisted") || "private",
      channelId: snippet.channelId || this.channelId,
      channelTitle: snippet.channelTitle || "",
      publishedAt: snippet.publishedAt || "",
      itemCount: item.contentDetails?.itemCount || 0,
      etag: item.etag || "",
    };

    // Add optional properties only if they exist
    if (snippet.thumbnails?.high?.url) {
      result.thumbnailUrl = snippet.thumbnails.high.url;
    }
    if (snippet.tags) {
      result.tags = snippet.tags;
    }
    if (snippet.defaultLanguage) {
      result.defaultLanguage = snippet.defaultLanguage;
    }
    if (item.localizations) {
      result.localizations = item.localizations as Record<
        string,
        { title: string; description: string }
      >;
    }

    return result;
  }

  private mapPlaylistItemResponse(item: youtube_v3.Schema$PlaylistItem): PlaylistItem {
    const snippet = item.snippet!;
    const resourceId = snippet.resourceId!;

    const result: PlaylistItem = {
      id: item.id!,
      videoId: resourceId.videoId!,
      title: snippet.title || "",
      description: snippet.description || "",
      channelTitle: snippet.channelTitle || "",
      publishedAt: snippet.publishedAt || "",
      position: snippet.position || 0,
      privacy: (item.status?.privacyStatus as "public" | "private" | "unlisted") || "public",
    };

    // Add optional properties only if they exist
    if (snippet.thumbnails?.high?.url) {
      result.thumbnailUrl = snippet.thumbnails.high.url;
    }
    if (item.contentDetails?.startAt) {
      result.startAt = this.parseTimeOffset(item.contentDetails.startAt);
    }
    if (item.contentDetails?.endAt) {
      result.endAt = this.parseTimeOffset(item.contentDetails.endAt);
    }

    return result;
  }

  private formatTimeOffset(seconds: number): string {
    // Convert seconds to YouTube time offset format (PT#M#S)
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `PT${minutes}M${remainingSeconds}S`;
  }

  private parseTimeOffset(timeOffset: string): number {
    // Parse YouTube time offset format (PT#M#S) to seconds
    const match = timeOffset.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const minutes = parseInt(match[1] || "0");
    const seconds = parseInt(match[2] || "0");

    return minutes * 60 + seconds;
  }
}
