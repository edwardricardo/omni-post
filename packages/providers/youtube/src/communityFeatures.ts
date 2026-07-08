/**
 * @file communityFeatures.ts
 * @description YouTube community posts service — creates, lists, and moderates community posts
 *              and their replies via the YouTube Data API.
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

export interface CommunityPost {
  id: string;
  content: string;
  authorDisplayName: string;
  publishedAt: string;
  likeCount: number;
  dislikeCount: number;
  totalReplyCount: number;
  canReply: boolean;
  isPublic: boolean;
  parentId?: string;
  snippet: {
    topLevelComment?: {
      snippet: {
        textDisplay: string;
        textOriginal: string;
        authorDisplayName: string;
        authorProfileImageUrl: string;
        authorChannelUrl: string;
        authorChannelId: string;
        videoId?: string;
        canRate: boolean;
        likeCount: number;
        publishedAt: string;
        updatedAt: string;
      };
    };
    replies?: {
      comments: Array<{
        snippet: {
          textDisplay: string;
          textOriginal: string;
          authorDisplayName: string;
          authorProfileImageUrl: string;
          authorChannelUrl: string;
          authorChannelId: string;
          parentId: string;
          canRate: boolean;
          likeCount: number;
          publishedAt: string;
          updatedAt: string;
        };
      }>;
    };
  };
}

export interface CommunityPostRequest {
  content: string;
  videoId?: string; // For video-specific posts
  images?: string[]; // Image URLs for community tab posts
  pollOptions?: string[]; // For poll posts
}

export interface CommunityMetrics {
  totalComments: number;
  totalReplies: number;
  averageLikes: number;
  engagementRate: number;
  topCommenterChannels: Array<{
    channelId: string;
    displayName: string;
    commentCount: number;
    averageLikes: number;
  }>;
  sentimentAnalysis: {
    positive: number;
    negative: number;
    neutral: number;
  };
  commonKeywords: Array<{
    keyword: string;
    frequency: number;
  }>;
}

export interface ChannelDiscussion {
  id: string;
  title: string;
  messageCount: number;
  isArchived: boolean;
  createdAt: string;
  recentMessages: Array<{
    id: string;
    content: string;
    authorName: string;
    publishedAt: string;
    likeCount: number;
  }>;
}

export interface ModerationAction {
  type: "hide" | "remove" | "approve" | "block_user" | "timeout_user";
  commentId?: string;
  channelId?: string;
  reason?: string;
  duration?: number; // For timeouts
}

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class YouTubeCommunityService {
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

    this.youtube = google.youtube({
      version: "v3",
      auth: this.oauth2Client as unknown as import("googleapis").Auth.OAuth2Client,
    });
  }

  /**
   * Get comments for a specific video
   */
  async getVideoComments(
    videoId: string,
    maxResults: number = 100,
    order: "time" | "relevance" = "time"
  ): Promise<CommunityPost[]> {
    const apiCall = async (): Promise<CommunityPost[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.commentThreads.list({
        part: ["snippet", "replies"],
        videoId,
        order,
        maxResults,
        textFormat: "plainText",
      });

      return (response.data.items || []).map((item) => this.mapCommentThread(item));
    };

    return circuitBreaker.call("youtube-community", "get-video-comments", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // Public-resource-by-id read: fold channel + videoId + query params so
      // video X never returns video Y's cached comments and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.channelId, videoId, maxResults, order),
    });
  }

  /**
   * Get all comments on the channel (not video-specific)
   */
  async getChannelComments(
    maxResults: number = 100,
    order: "time" | "relevance" = "time"
  ): Promise<CommunityPost[]> {
    const apiCall = async (): Promise<CommunityPost[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.commentThreads.list({
        part: ["snippet", "replies"],
        channelId: this.channelId,
        order,
        maxResults,
        textFormat: "plainText",
      });

      return (response.data.items || []).map((item) => this.mapCommentThread(item));
    };

    return circuitBreaker.call("youtube-community", "get-channel-comments", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // PII (channel comments): fold channel + query params so channel B never
      // receives channel A's cached comments and pages never collide.
      cacheKeyDiscriminant: hashCallScope(this.channelId, maxResults, order),
    });
  }

  /**
   * Reply to a comment
   */
  async replyToComment(commentId: string, replyText: string): Promise<CommunityPost> {
    const apiCall = async (): Promise<CommunityPost> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.comments.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            parentId: commentId,
            textOriginal: replyText,
          },
        },
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to post reply");
      }

      return this.mapComment(response.data);
    };

    return circuitBreaker.call("youtube-community", "reply-to-comment", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment
      // so acting on comment B never runs comment A's bound closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Like or unlike a comment
   */
  async rateComment(commentId: string, rating: "like" | "dislike" | "none"): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      // Note: setRating is available on videos resource, not comments
      // Comments rating is handled through the videos.rate API
      await this.youtube.videos.rate({
        id: commentId,
        rating: rating as "like" | "dislike" | "none",
      });

      return true;
    };

    return circuitBreaker.call("youtube-community", "rate-comment", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Update a comment (edit)
   */
  async updateComment(commentId: string, newText: string): Promise<CommunityPost> {
    const apiCall = async (): Promise<CommunityPost> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.comments.update({
        part: ["snippet"],
        requestBody: {
          id: commentId,
          snippet: {
            textOriginal: newText,
          },
        },
      });

      if (!response.data.id) {
        throw ProviderError.externalService("youtube", "Failed to update comment");
      }

      return this.mapComment(response.data);
    };

    return circuitBreaker.call("youtube-community", "update-comment", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      await this.youtube.comments.delete({
        id: commentId,
      });

      return true;
    };

    return circuitBreaker.call("youtube-community", "delete-comment", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Mark comment as spam
   */
  async markCommentAsSpam(commentId: string): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      await this.youtube.comments.markAsSpam({
        id: [commentId],
      });

      return true;
    };

    return circuitBreaker.call("youtube-community", "mark-spam", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Set comment moderation status
   */
  async moderateComment(
    commentId: string,
    moderationStatus: "published" | "heldForReview" | "likelySpam" | "rejected"
  ): Promise<boolean> {
    const apiCall = async (): Promise<boolean> => {
      await this.refreshTokenIfNeeded();

      await this.youtube.comments.setModerationStatus({
        id: [commentId],
        moderationStatus,
      });

      return true;
    };

    return circuitBreaker.call("youtube-community", "moderate-comment", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE + closure partition by channel + comment (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId, commentId),
    });
  }

  /**
   * Get community metrics and analytics
   */
  async getCommunityMetrics(
    videoId?: string,
    _timeRange?: { start: Date; end: Date }
  ): Promise<CommunityMetrics> {
    const apiCall = async (): Promise<CommunityMetrics> => {
      await this.refreshTokenIfNeeded();

      // Get comments for analysis
      const comments = videoId
        ? await this.getVideoComments(videoId, 500)
        : await this.getChannelComments(500);

      // Analyze comments
      const totalComments = comments.length;
      const totalReplies = comments.reduce((sum, comment) => sum + comment.totalReplyCount, 0);
      const totalLikes = comments.reduce((sum, comment) => sum + comment.likeCount, 0);
      const averageLikes = totalComments > 0 ? totalLikes / totalComments : 0;

      // Calculate engagement rate (simplified)
      const engagementRate = totalComments > 0 ? (totalLikes + totalReplies) / totalComments : 0;

      // Analyze top commenters
      const commenterMap = new Map<string, { name: string; count: number; likes: number }>();

      comments.forEach((comment) => {
        const author = comment.snippet.topLevelComment?.snippet.authorDisplayName || "Unknown";
        const authorId = comment.snippet.topLevelComment?.snippet.authorChannelId || "unknown";
        const likes = comment.snippet.topLevelComment?.snippet.likeCount || 0;

        if (commenterMap.has(authorId)) {
          const existing = commenterMap.get(authorId)!;
          existing.count += 1;
          existing.likes += likes;
        } else {
          commenterMap.set(authorId, { name: author, count: 1, likes });
        }
      });

      const topCommenterChannels = Array.from(commenterMap.entries())
        .map(([channelId, data]) => ({
          channelId,
          displayName: data.name,
          commentCount: data.count,
          averageLikes: data.count > 0 ? data.likes / data.count : 0,
        }))
        .sort((a, b) => b.commentCount - a.commentCount)
        .slice(0, 10);

      // Simple sentiment analysis (would use ML service in production)
      const sentimentAnalysis = this.analyzeSentiment(comments);

      // Extract common keywords
      const commonKeywords = this.extractKeywords(comments);

      return {
        totalComments,
        totalReplies,
        averageLikes,
        engagementRate,
        topCommenterChannels,
        sentimentAnalysis,
        commonKeywords,
      };
    };

    return circuitBreaker.call("youtube-community", "get-metrics", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII (community metrics): fold channel + optional videoId + time range so
      // distinct scopes never collide and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.channelId, videoId, _timeRange),
    });
  }

  /**
   * Get comments that need moderation
   */
  async getModerationQueue(): Promise<CommunityPost[]> {
    const apiCall = async (): Promise<CommunityPost[]> => {
      await this.refreshTokenIfNeeded();

      const response = await this.youtube.commentThreads.list({
        part: ["snippet", "replies"],
        channelId: this.channelId,
        moderationStatus: "heldForReview",
        maxResults: 100,
        textFormat: "plainText",
      });

      return (response.data.items || []).map((item) => this.mapCommentThread(item));
    };

    return circuitBreaker.call("youtube-community", "get-moderation-queue", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      // Uncached channel read: STATE + closure partition by channel so channel B
      // never runs channel A's bound closure for the moderation queue (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.channelId),
    });
  }

  private async refreshTokenIfNeeded(): Promise<void> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        this.oauth2Client.setCredentials(credentials);
      }
    } catch (error) {
      throw ProviderError.unauthorized(
        "youtube",
        `Failed to refresh YouTube Community token: ${error}`
      );
    }
  }

  private mapCommentThread(item: youtube_v3.Schema$CommentThread): CommunityPost {
    const snippet = item.snippet?.topLevelComment?.snippet;

    return {
      id: item.id || "",
      content: snippet?.textDisplay || "",
      authorDisplayName: snippet?.authorDisplayName || "Unknown",
      publishedAt: snippet?.publishedAt || "",
      likeCount: snippet?.likeCount || 0,
      dislikeCount: 0, // Not available in API
      totalReplyCount: item.snippet?.totalReplyCount || 0,
      canReply: snippet?.canRate ?? true,
      isPublic: true,
      snippet: {
        ...(item.snippet?.topLevelComment && {
          topLevelComment: {
            snippet: {
              textDisplay: item.snippet.topLevelComment.snippet?.textDisplay || "",
              textOriginal: item.snippet.topLevelComment.snippet?.textOriginal || "",
              authorDisplayName: item.snippet.topLevelComment.snippet?.authorDisplayName || "",
              authorProfileImageUrl:
                item.snippet.topLevelComment.snippet?.authorProfileImageUrl || "",
              authorChannelUrl: item.snippet.topLevelComment.snippet?.authorChannelUrl || "",
              authorChannelId: item.snippet.topLevelComment.snippet?.authorChannelId?.value || "",
              ...(item.snippet.topLevelComment.snippet?.videoId && {
                videoId: item.snippet.topLevelComment.snippet.videoId,
              }),
              canRate: item.snippet.topLevelComment.snippet?.canRate ?? true,
              likeCount: item.snippet.topLevelComment.snippet?.likeCount || 0,
              publishedAt: item.snippet.topLevelComment.snippet?.publishedAt || "",
              updatedAt: item.snippet.topLevelComment.snippet?.updatedAt || "",
            },
          },
        }),
        ...(item.replies && {
          replies: {
            comments: (item.replies.comments || []).map((comment) => ({
              snippet: {
                textDisplay: comment.snippet?.textDisplay || "",
                textOriginal: comment.snippet?.textOriginal || "",
                authorDisplayName: comment.snippet?.authorDisplayName || "",
                authorProfileImageUrl: comment.snippet?.authorProfileImageUrl || "",
                authorChannelUrl: comment.snippet?.authorChannelUrl || "",
                authorChannelId: comment.snippet?.authorChannelId?.value || "",
                parentId: comment.snippet?.parentId || "",
                canRate: comment.snippet?.canRate ?? true,
                likeCount: comment.snippet?.likeCount || 0,
                publishedAt: comment.snippet?.publishedAt || "",
                updatedAt: comment.snippet?.updatedAt || "",
              },
            })),
          },
        }),
      },
    };
  }

  private mapComment(item: youtube_v3.Schema$Comment): CommunityPost {
    const snippet = item.snippet;

    return {
      id: item.id || "",
      content: snippet?.textDisplay || "",
      authorDisplayName: snippet?.authorDisplayName || "Unknown",
      publishedAt: snippet?.publishedAt || "",
      likeCount: snippet?.likeCount || 0,
      dislikeCount: 0,
      totalReplyCount: 0,
      canReply: snippet?.canRate ?? true,
      isPublic: true,
      ...(snippet?.parentId && { parentId: snippet.parentId }),
      snippet: {
        ...(snippet && {
          topLevelComment: {
            snippet: {
              textDisplay: snippet.textDisplay || "",
              textOriginal: snippet.textOriginal || "",
              authorDisplayName: snippet.authorDisplayName || "",
              authorProfileImageUrl: snippet.authorProfileImageUrl || "",
              authorChannelUrl: snippet.authorChannelUrl || "",
              authorChannelId: snippet.authorChannelId?.value || "",
              ...(snippet.videoId && { videoId: snippet.videoId }),
              canRate: snippet.canRate ?? true,
              likeCount: snippet.likeCount || 0,
              publishedAt: snippet.publishedAt || "",
              updatedAt: snippet.updatedAt || "",
            },
          },
        }),
      },
    };
  }

  private analyzeSentiment(comments: CommunityPost[]): {
    positive: number;
    negative: number;
    neutral: number;
  } {
    // Simple keyword-based sentiment analysis
    // In production, this would use a proper ML sentiment analysis service

    const positiveWords = [
      "good",
      "great",
      "awesome",
      "amazing",
      "love",
      "excellent",
      "fantastic",
      "wonderful",
    ];
    const negativeWords = [
      "bad",
      "terrible",
      "awful",
      "hate",
      "horrible",
      "disgusting",
      "worst",
      "stupid",
    ];

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const comment of comments) {
      const text = comment.content.toLowerCase();
      const hasPositive = positiveWords.some((word) => text.includes(word));
      const hasNegative = negativeWords.some((word) => text.includes(word));

      if (hasPositive && !hasNegative) {
        positive++;
      } else if (hasNegative && !hasPositive) {
        negative++;
      } else {
        neutral++;
      }
    }

    return { positive, negative, neutral };
  }

  private extractKeywords(
    comments: CommunityPost[]
  ): Array<{ keyword: string; frequency: number }> {
    const wordCounts = new Map<string, number>();

    // Common stop words to exclude
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "me",
      "him",
      "her",
      "us",
      "them",
    ]);

    for (const comment of comments) {
      const words = comment.content
        .toLowerCase()
        .replace(/[^\w\s]/g, "") // Remove punctuation
        .split(/\s+/)
        .filter((word) => word.length > 2 && !stopWords.has(word));

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
    }

    return Array.from(wordCounts.entries())
      .map(([keyword, frequency]) => ({ keyword, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 20);
  }
}
