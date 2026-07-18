/**
 * @file liveStreaming.ts
 * @description YouTube live-streaming service — creates and manages broadcasts, streams, and
 *              live chat moderation through the YouTube Live Streaming API.
 * @layer infrastructure
 */
import { google, youtube_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import {
  createExternalApiCircuitBreaker,
  hashCallScope,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
} from "@adapters/external-apis";
import { ProviderError } from "@providers/shared";
import client from "prom-client";

export interface LiveStreamConfig {
  title: string;
  description: string;
  privacy: "public" | "private" | "unlisted";
  scheduledStartTime?: Date;
  categoryId?: string;
  tags?: string[];
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  enableDvr?: boolean;
  enableContentEncryption?: boolean;
  enableEmbed?: boolean;
  recordFromStart?: boolean;
  enableClosedCaptions?: boolean;
  projection?: "360" | "rectangular";
  latencyPreference?: "normal" | "low" | "ultraLow";
}

export interface LiveStream {
  id: string;
  title: string;
  description: string;
  status: "created" | "ready" | "testing" | "live" | "complete" | "revoked";
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
  streamName: string;
  ingestionInfo: {
    streamName: string;
    ingestionAddress: string;
    backupIngestionAddress?: string;
  };
  monitoring: {
    broadcastStatus: string;
    lifeCycleStatus: string;
    streamStatus: string;
  };
  metrics?: {
    concurrentViewers?: number;
    totalViewTime?: number;
    averageViewDuration?: number;
    peakConcurrentViewers?: number;
  };
}

export interface LiveChatMessage {
  id: string;
  authorChannelId: string;
  authorDisplayName: string;
  message: string;
  timestamp: string;
  type: "textMessage" | "superChat" | "superSticker" | "membership" | "sponsorship";
  superChatDetails?: {
    amountMicros: string;
    currency: string;
    amountDisplayString: string;
    userComment: string;
    tier: number;
  };
}

export interface LiveStreamAnalytics {
  streamId: string;
  totalViewers: number;
  peakViewers: number;
  averageViewDuration: number;
  totalWatchTime: number;
  chatMessages: number;
  superChats: number;
  newSubscribers: number;
  likes: number;
  shares: number;
  viewerRetention: Array<{
    timestamp: number;
    viewerCount: number;
  }>;
  geographicDistribution: Record<string, number>;
  deviceDistribution: Record<string, number>;
}

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class YouTubeLiveStreamingService {
  private oauth2Client: OAuth2Client;
  private youtube: youtube_v3.Youtube;
  private channelId: string;
  // Per-tenant OAuth refresh token — a SECRET that uniquely identifies this
  // tenant's grant (unlike channelId, which is PUBLIC and guessable). Folded as
  // the leading segment of every cacheKeyDiscriminant below so the breaker's L1
  // cache / STATE key is scoped by an unguessable per-tenant secret, not a public
  // id. clientId/clientSecret are the shared OAuth APP credentials, not per-tenant.
  private readonly refreshToken: string;

  constructor(credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken?: string;
    channelId: string;
  }) {
    this.channelId = credentials.channelId;
    this.refreshToken = credentials.refreshToken;

    this.oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
      "urn:ietf:wg:oauth:2.0:oob"
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
      ...(credentials.accessToken && { access_token: credentials.accessToken }),
    });

    this.youtube = google.youtube({
      version: "v3",
      auth: this.oauth2Client as unknown as import("googleapis").Auth.OAuth2Client,
    });
  }

  /**
   * Create a new live stream
   */
  async createLiveStream(config: LiveStreamConfig): Promise<LiveStream> {
    const apiCall = async (): Promise<LiveStream> => {
      await this.refreshTokenIfNeeded();

      // Step 1: Create the live stream
      const streamResponse = await this.youtube.liveStreams.insert({
        part: ["snippet", "cdn", "status"],
        requestBody: {
          snippet: {
            title: `${config.title} - Stream`,
            description: config.description,
          },
          cdn: {
            frameRate: "variable",
            ingestionType: "rtmp",
            resolution: "variable",
          },
          status: {
            streamStatus: "created",
          },
        },
      });

      if (!streamResponse.data.id) {
        throw ProviderError.externalService("youtube", "Failed to create live stream");
      }

      // Step 2: Create the live broadcast
      const broadcastResponse = await this.youtube.liveBroadcasts.insert({
        part: ["snippet", "status", "contentDetails"],
        requestBody: {
          snippet: {
            title: config.title,
            description: config.description,
            ...(config.scheduledStartTime && {
              scheduledStartTime: config.scheduledStartTime.toISOString(),
            }),
          },
          status: {
            privacyStatus: config.privacy,
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: config.enableAutoStart ?? false,
            enableAutoStop: config.enableAutoStop ?? false,
            enableDvr: config.enableDvr ?? true,
            enableContentEncryption: config.enableContentEncryption ?? false,
            enableEmbed: config.enableEmbed ?? true,
            recordFromStart: config.recordFromStart ?? true,
            enableClosedCaptions: config.enableClosedCaptions ?? false,
            projection: config.projection ?? "rectangular",
            latencyPreference: config.latencyPreference ?? "normal",
          },
        },
      });

      if (!broadcastResponse.data) {
        throw ProviderError.externalService(
          "youtube",
          "Failed to create live broadcast - no response data"
        );
      }

      if (!broadcastResponse.data.id) {
        throw ProviderError.externalService(
          "youtube",
          "Failed to create live broadcast - no broadcast ID"
        );
      }

      // Step 3: Bind the stream to the broadcast
      await this.youtube.liveBroadcasts.bind({
        part: ["id", "contentDetails"],
        id: broadcastResponse.data.id,
        streamId: streamResponse.data.id,
      });

      const stream = streamResponse.data;
      const broadcast = broadcastResponse.data;

      if (!broadcast.id) {
        throw ProviderError.notFound("youtube", "Broadcast ID");
      }

      return {
        id: broadcast.id,
        title: config.title,
        description: config.description,
        status: "created",
        ...(config.scheduledStartTime && {
          scheduledStartTime: config.scheduledStartTime.toISOString(),
        }),
        streamName: stream.cdn?.ingestionInfo?.streamName || "",
        ingestionInfo: {
          streamName: stream.cdn?.ingestionInfo?.streamName || "",
          ingestionAddress: stream.cdn?.ingestionInfo?.ingestionAddress || "",
          ...(stream.cdn?.ingestionInfo?.backupIngestionAddress && {
            backupIngestionAddress: stream.cdn.ingestionInfo.backupIngestionAddress,
          }),
        },
        monitoring: {
          broadcastStatus: broadcast.status?.lifeCycleStatus || "created",
          lifeCycleStatus: broadcast.status?.lifeCycleStatus || "created",
          streamStatus: stream.status?.streamStatus || "created",
        },
      };
    };

    return circuitBreaker.call("youtube-live", "create-stream", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + config
      // so channel B never runs channel A's bound create closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, config),
    });
  }

  /**
   * Start a live stream
   */
  async startLiveStream(streamId: string): Promise<LiveStream> {
    const apiCall = async (): Promise<LiveStream> => {
      await this.refreshTokenIfNeeded();

      // Transition the broadcast to live
      const response = await this.youtube.liveBroadcasts.transition({
        part: ["id", "status", "snippet"],
        id: streamId,
        broadcastStatus: "live",
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to start live stream");
      }

      return await this.getLiveStreamStatus(streamId);
    };

    return circuitBreaker.call("youtube-live", "start-stream", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + stream
      // so acting on stream B never runs stream A's bound closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId),
    });
  }

  /**
   * Stop a live stream
   */
  async stopLiveStream(streamId: string): Promise<LiveStream> {
    const apiCall = async (): Promise<LiveStream> => {
      await this.refreshTokenIfNeeded();

      // Transition the broadcast to complete
      const response = await this.youtube.liveBroadcasts.transition({
        part: ["id", "status", "snippet"],
        id: streamId,
        broadcastStatus: "complete",
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to stop live stream");
      }

      return await this.getLiveStreamStatus(streamId);
    };

    return circuitBreaker.call("youtube-live", "stop-stream", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + stream (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId),
    });
  }

  /**
   * Get live stream status and metrics
   */
  async getLiveStreamStatus(streamId: string): Promise<LiveStream> {
    const apiCall = async (): Promise<LiveStream> => {
      await this.refreshTokenIfNeeded();

      const [broadcastResponse, streamResponse] = await Promise.all([
        this.youtube.liveBroadcasts.list({
          part: ["id", "snippet", "status", "statistics"],
          id: [streamId],
        }),
        this.youtube.liveStreams.list({
          part: ["id", "snippet", "cdn", "status"],
          id: [streamId],
        }),
      ]);

      const broadcast = broadcastResponse.data.items?.[0];
      const stream = streamResponse.data.items?.[0];

      if (!broadcast) {
        throw ProviderError.notFound("youtube", "Live broadcast");
      }

      if (!broadcast.id) {
        throw ProviderError.notFound("youtube", "Broadcast ID");
      }

      return {
        id: broadcast.id,
        title: broadcast.snippet?.title || "",
        description: broadcast.snippet?.description || "",
        status: this.mapBroadcastStatus(broadcast.status?.lifeCycleStatus),
        ...(broadcast.snippet?.scheduledStartTime && {
          scheduledStartTime: broadcast.snippet.scheduledStartTime,
        }),
        ...(broadcast.snippet?.actualStartTime && {
          actualStartTime: broadcast.snippet.actualStartTime,
        }),
        ...(broadcast.snippet?.actualEndTime && { actualEndTime: broadcast.snippet.actualEndTime }),
        streamName: stream?.cdn?.ingestionInfo?.streamName || "",
        ingestionInfo: {
          streamName: stream?.cdn?.ingestionInfo?.streamName || "",
          ingestionAddress: stream?.cdn?.ingestionInfo?.ingestionAddress || "",
          ...(stream?.cdn?.ingestionInfo?.backupIngestionAddress && {
            backupIngestionAddress: stream.cdn.ingestionInfo.backupIngestionAddress,
          }),
        },
        monitoring: {
          broadcastStatus: broadcast.status?.lifeCycleStatus || "unknown",
          lifeCycleStatus: broadcast.status?.lifeCycleStatus || "unknown",
          streamStatus: stream?.status?.streamStatus || "unknown",
        },
        metrics: {
          concurrentViewers: parseInt(broadcast.statistics?.concurrentViewers || "0"),
          // Note: totalChatCount doesn't exist in Schema$LiveBroadcastStatistics
          // Using a placeholder value here
          totalViewTime: 0,
        },
      };
    };

    return circuitBreaker.call("youtube-live", "get-stream-status", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Uncached read: STATE + closure partition by channel + stream so status
      // of stream B never runs stream A's bound closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId),
    });
  }

  /**
   * Get live chat messages
   */
  async getLiveChatMessages(
    streamId: string,
    pageToken?: string
  ): Promise<{ messages: LiveChatMessage[]; nextPageToken?: string }> {
    const apiCall = async (): Promise<{ messages: LiveChatMessage[]; nextPageToken?: string }> => {
      await this.refreshTokenIfNeeded();

      // First get the live chat ID
      const broadcastResponse = await this.youtube.liveBroadcasts.list({
        part: ["snippet"],
        id: [streamId],
      });

      const liveChatId = broadcastResponse.data.items?.[0]?.snippet?.liveChatId;
      if (!liveChatId) {
        throw ProviderError.notFound("youtube", "Live chat");
      }

      // Get chat messages

      const response = (await this.youtube.liveChatMessages.list({
        liveChatId,
        part: ["id", "snippet", "authorDetails"],
        ...(pageToken ? { pageToken } : {}),
        maxResults: 200,
      })) as unknown as { data: youtube_v3.Schema$LiveChatMessageListResponse };

      if (!response.data) {
        throw ProviderError.externalService(
          "youtube",
          "Failed to fetch chat messages - no response data"
        );
      }

      const messages: LiveChatMessage[] = (response.data.items || []).map(
        (item: youtube_v3.Schema$LiveChatMessage) => ({
          id: item.id || "",
          authorChannelId: item.authorDetails?.channelId || "",
          authorDisplayName: item.authorDetails?.displayName || "Unknown",
          message: item.snippet?.displayMessage || "",
          timestamp: item.snippet?.publishedAt || "",
          type: this.mapMessageType(item.snippet?.type),
          ...(item.snippet?.superChatDetails && {
            superChatDetails: {
              amountMicros: item.snippet.superChatDetails.amountMicros || "0",
              currency: item.snippet.superChatDetails.currency || "USD",
              amountDisplayString: item.snippet.superChatDetails.amountDisplayString || "",
              userComment: item.snippet.superChatDetails.userComment || "",
              tier: item.snippet.superChatDetails.tier || 0,
            },
          }),
        })
      );

      return {
        messages,
        ...(response.data.nextPageToken && { nextPageToken: response.data.nextPageToken }),
      };
    };

    return circuitBreaker.call("youtube-live", "get-chat-messages", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Uncached read: STATE + closure partition by channel + stream + page so
      // chat of stream B never runs stream A's bound closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId, pageToken),
    });
  }

  /**
   * Send a message to live chat
   */
  async sendChatMessage(streamId: string, message: string): Promise<LiveChatMessage> {
    const apiCall = async (): Promise<LiveChatMessage> => {
      await this.refreshTokenIfNeeded();

      // First get the live chat ID
      const broadcastResponse = await this.youtube.liveBroadcasts.list({
        part: ["snippet"],
        id: [streamId],
      });

      const liveChatId = broadcastResponse.data.items?.[0]?.snippet?.liveChatId;
      if (!liveChatId) {
        throw ProviderError.notFound("youtube", "Live chat");
      }

      // Send the message
      const response = await this.youtube.liveChatMessages.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            liveChatId,
            type: "textMessageEvent",
            textMessageDetails: {
              messageText: message,
            },
          },
        },
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to send chat message");
      }

      return {
        id: response.data.id,
        authorChannelId: this.channelId,
        authorDisplayName: "You",
        message,
        timestamp: new Date().toISOString(),
        type: "textMessage",
      };
    };

    return circuitBreaker.call("youtube-live", "send-chat-message", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + stream (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId),
    });
  }

  /**
   * Get comprehensive live stream analytics
   */
  async getLiveStreamAnalytics(streamId: string): Promise<LiveStreamAnalytics> {
    const apiCall = async (): Promise<LiveStreamAnalytics> => {
      await this.refreshTokenIfNeeded();

      // Get broadcast statistics
      const broadcastResponse = await this.youtube.liveBroadcasts.list({
        part: ["statistics", "snippet"],
        id: [streamId],
      });

      const broadcast = broadcastResponse.data.items?.[0];
      if (!broadcast) {
        throw ProviderError.notFound("youtube", "Live broadcast");
      }

      // This would typically integrate with YouTube Analytics API for more detailed metrics
      // For now, we'll return basic statistics available from the Broadcasts API

      return {
        streamId,
        // Note: totalChatCount doesn't exist in Schema$LiveBroadcastStatistics
        // These metrics would require YouTube Analytics API integration
        totalViewers: 0,
        peakViewers: parseInt(broadcast.statistics?.concurrentViewers || "0"),
        averageViewDuration: 0, // Would require Analytics API
        totalWatchTime: 0, // Would require Analytics API
        chatMessages: 0, // Would require parsing chat messages or Analytics API
        superChats: 0, // Would require parsing chat messages
        newSubscribers: 0, // Would require Analytics API
        likes: 0, // Would require Analytics API
        shares: 0, // Would require Analytics API
        viewerRetention: [], // Would require Analytics API
        geographicDistribution: {}, // Would require Analytics API
        deviceDistribution: {}, // Would require Analytics API
      };
    };

    return circuitBreaker.call("youtube-live", "get-stream-analytics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII (per-stream analytics): fold channel + streamId so stream X never
      // returns stream Y's cached analytics and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, streamId),
    });
  }

  /**
   * List all live streams for the channel
   */
  async listLiveStreams(status?: string): Promise<LiveStream[]> {
    const apiCall = async (): Promise<LiveStream[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.liveBroadcasts.list({
        part: ["id", "snippet", "status"],
        broadcastType: "all",
        mine: true,
        maxResults: 50,
      });

      const broadcasts = response.data.items || [];

      // Filter by status if provided
      const filteredBroadcasts = status
        ? broadcasts.filter((b) => b.status?.lifeCycleStatus === status)
        : broadcasts;

      return filteredBroadcasts.map((broadcast) => ({
        id: broadcast.id || "",
        title: broadcast.snippet?.title || "",
        description: broadcast.snippet?.description || "",
        status: this.mapBroadcastStatus(broadcast.status?.lifeCycleStatus),
        ...(broadcast.snippet?.scheduledStartTime && {
          scheduledStartTime: broadcast.snippet.scheduledStartTime,
        }),
        ...(broadcast.snippet?.actualStartTime && {
          actualStartTime: broadcast.snippet.actualStartTime,
        }),
        ...(broadcast.snippet?.actualEndTime && { actualEndTime: broadcast.snippet.actualEndTime }),
        streamName: "",
        ingestionInfo: {
          streamName: "",
          ingestionAddress: "",
        },
        monitoring: {
          broadcastStatus: broadcast.status?.lifeCycleStatus || "unknown",
          lifeCycleStatus: broadcast.status?.lifeCycleStatus || "unknown",
          streamStatus: "unknown",
        },
      }));
    };

    return circuitBreaker.call("youtube-live", "list-streams", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // PII (channel stream list): fold channel + status filter so channel B
      // never receives channel A's cached list and filters never collide.
      cacheKeyDiscriminant: hashCallScope(this.refreshToken, this.channelId, status),
    });
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
      }
    } catch (error) {
      throw ProviderError.unauthorized("youtube", `Failed to refresh YouTube Live token: ${error}`);
    }
  }

  private mapBroadcastStatus(status: string | null | undefined): LiveStream["status"] {
    switch (status) {
      case "created":
        return "created";
      case "ready":
        return "ready";
      case "testing":
        return "testing";
      case "live":
        return "live";
      case "complete":
        return "complete";
      case "revoked":
        return "revoked";
      default:
        return "created";
    }
  }

  private mapMessageType(type?: string | null): LiveChatMessage["type"] {
    switch (type) {
      case "textMessageEvent":
        return "textMessage";
      case "superChatEvent":
        return "superChat";
      case "superStickerEvent":
        return "superSticker";
      case "newSponsorEvent":
        return "sponsorship";
      case "memberMilestoneChatEvent":
        return "membership";
      default:
        return "textMessage";
    }
  }
}
