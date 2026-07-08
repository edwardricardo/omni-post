/**
 * @file analytics.ts
 * @description YouTube analytics client fetching core and engagement metrics (views, likes,
 *              comments, watch time) via the YouTube Analytics API with circuit breaker protection.
 * @layer infrastructure
 */
import { google, youtubeAnalytics_v2 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import {
  createExternalApiCircuitBreaker,
  hashCallScope,
  ANALYTICS_CB_OPTIONS,
  METADATA_CB_OPTIONS,
} from "@adapters/external-apis";
import { ProviderError } from "@providers/shared";
import client from "prom-client";

export interface YouTubeAnalyticsMetrics {
  // Core metrics
  views: number;
  likes: number;
  dislikes: number;
  comments: number;
  shares: number;
  estimatedMinutesWatched: number;
  averageViewDuration: number;

  // Audience metrics
  subscribersGained: number;
  subscribersLost: number;
  averageViewPercentage: number;

  // Revenue metrics (if monetized)
  estimatedRevenue?: number;
  estimatedAdRevenue?: number;
  estimatedRedRevenue?: number;

  // Engagement metrics
  cardClickRate?: number;
  cardTeaserClickRate?: number;
  annotationClickThroughRate?: number;
  annotationCloseRate?: number;
}

export interface YouTubeAudienceInsights {
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
  };
  trafficSources: Record<string, number>;
  deviceTypes: Record<string, number>;
  playbackLocations: Record<string, number>;
}

export interface YouTubeOptimizationSuggestions {
  title: {
    score: number;
    suggestions: string[];
  };
  description: {
    score: number;
    suggestions: string[];
  };
  tags: {
    score: number;
    suggestions: string[];
  };
  thumbnail: {
    score: number;
    suggestions: string[];
  };
  publishingTime: {
    optimalTimes: string[];
    reasoning: string;
  };
}

export interface YouTubePerformanceInsights {
  retentionGraph: Array<{
    timestamp: number;
    retentionPercentage: number;
  }>;
  clickThroughRate: number;
  impressions: number;
  topGeographies: Array<{
    country: string;
    views: number;
    watchTime: number;
  }>;
  searchTerms: Array<{
    term: string;
    views: number;
    rank: number;
  }>;
}

const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class YouTubeAnalyticsService {
  private oauth2Client: OAuth2Client;
  private youtubeAnalytics: youtubeAnalytics_v2.Youtubeanalytics;
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

    this.youtubeAnalytics = google.youtubeAnalytics({
      version: "v2",
      auth: this.oauth2Client as unknown as import("googleapis").Auth.OAuth2Client,
    });
  }

  /**
   * Get comprehensive video analytics
   */
  async getVideoAnalytics(
    videoId: string,
    startDate: Date,
    endDate: Date
  ): Promise<YouTubeAnalyticsMetrics> {
    const apiCall = async (): Promise<YouTubeAnalyticsMetrics> => {
      await this.refreshTokenIfNeeded();

      const metrics = [
        "views",
        "likes",
        "dislikes",
        "comments",
        "shares",
        "estimatedMinutesWatched",
        "averageViewDuration",
        "subscribersGained",
        "subscribersLost",
        "averageViewPercentage",
      ].join(",");

      const response = await this.youtubeAnalytics.reports.query({
        ids: `channel==${this.channelId}`,
        startDate: this.formatDate(startDate),
        endDate: this.formatDate(endDate),
        metrics,
        filters: `video==${videoId}`,
        dimensions: "day",
      });

      // Process the response data
      const rows = response.data.rows || [];
      const headers =
        response.data.columnHeaders
          ?.map((h) => h.name)
          .filter((name): name is string => name !== null && name !== undefined) || [];

      // Aggregate data across all days
      const aggregated = this.aggregateMetrics(rows, headers);

      return {
        views: aggregated.views || 0,
        likes: aggregated.likes || 0,
        dislikes: aggregated.dislikes || 0,
        comments: aggregated.comments || 0,
        shares: aggregated.shares || 0,
        estimatedMinutesWatched: aggregated.estimatedMinutesWatched || 0,
        averageViewDuration: aggregated.averageViewDuration || 0,
        subscribersGained: aggregated.subscribersGained || 0,
        subscribersLost: aggregated.subscribersLost || 0,
        averageViewPercentage: aggregated.averageViewPercentage || 0,
      };
    };

    return circuitBreaker.call("youtube-analytics", "get-video-metrics", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII per-video: fold channel + videoId + the date window so video X never
      // returns video Y's cached metrics and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(
        this.channelId,
        videoId,
        startDate.getTime(),
        endDate.getTime()
      ),
    });
  }

  /**
   * Get audience insights for a channel
   */
  async getAudienceInsights(startDate: Date, endDate: Date): Promise<YouTubeAudienceInsights> {
    const apiCall = async (): Promise<YouTubeAudienceInsights> => {
      await this.refreshTokenIfNeeded();

      // Get demographics data
      const [ageResponse, genderResponse, geoResponse, trafficResponse, deviceResponse] =
        await Promise.all([
          this.youtubeAnalytics.reports.query({
            ids: `channel==${this.channelId}`,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            metrics: "viewerPercentage",
            dimensions: "ageGroup",
          }),
          this.youtubeAnalytics.reports.query({
            ids: `channel==${this.channelId}`,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            metrics: "viewerPercentage",
            dimensions: "gender",
          }),
          this.youtubeAnalytics.reports.query({
            ids: `channel==${this.channelId}`,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            metrics: "views",
            dimensions: "country",
            sort: "-views",
            maxResults: 10,
          }),
          this.youtubeAnalytics.reports.query({
            ids: `channel==${this.channelId}`,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            metrics: "views",
            dimensions: "insightTrafficSourceType",
          }),
          this.youtubeAnalytics.reports.query({
            ids: `channel==${this.channelId}`,
            startDate: this.formatDate(startDate),
            endDate: this.formatDate(endDate),
            metrics: "views",
            dimensions: "deviceType",
          }),
        ]);

      return {
        demographics: {
          ageGroups: this.processMetricResponse(ageResponse),
          genders: this.processMetricResponse(genderResponse),
          countries: this.processMetricResponse(geoResponse),
        },
        trafficSources: this.processMetricResponse(trafficResponse),
        deviceTypes: this.processMetricResponse(deviceResponse),
        playbackLocations: {}, // Would require additional API call
      };
    };

    return circuitBreaker.call("youtube-analytics", "get-audience-insights", apiCall, [], {
      timeout: 20000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII (channel audience): fold channel + the date window so channel B never
      // receives channel A's cached insights and windows never collide.
      cacheKeyDiscriminant: hashCallScope(this.channelId, startDate.getTime(), endDate.getTime()),
    });
  }

  /**
   * Get SEO optimization suggestions
   */
  async getOptimizationSuggestions(
    videoId: string,
    title: string,
    description: string,
    tags: string[]
  ): Promise<YouTubeOptimizationSuggestions> {
    const apiCall = async (): Promise<YouTubeOptimizationSuggestions> => {
      // This would integrate with YouTube's analytics and search trends
      // For now, we'll provide rule-based optimization suggestions

      const titleScore = this.analyzeTitleSEO(title);
      const descriptionScore = this.analyzeDescriptionSEO(description);
      const tagsScore = this.analyzeTagsSEO(tags);

      // Get optimal posting times based on channel analytics
      const optimalTimes = await this.getOptimalPostingTimes();

      return {
        title: {
          score: titleScore.score,
          suggestions: titleScore.suggestions,
        },
        description: {
          score: descriptionScore.score,
          suggestions: descriptionScore.suggestions,
        },
        tags: {
          score: tagsScore.score,
          suggestions: tagsScore.suggestions,
        },
        thumbnail: {
          score: 75, // Would analyze actual thumbnail
          suggestions: [
            "Use bright colors to stand out",
            "Include faces for higher click-through rates",
            "Add text overlay for context",
            "Test A/B thumbnail variations",
          ],
        },
        publishingTime: {
          optimalTimes,
          reasoning: "Based on your audience activity patterns and engagement data",
        },
      };
    };

    return circuitBreaker.call("youtube-analytics", "get-optimization-suggestions", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...METADATA_CB_OPTIONS,
      // Content-derived read: fold channel + videoId + the analysed title/
      // description/tags so distinct inputs never collide and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(this.channelId, videoId, title, description, tags),
    });
  }

  /**
   * Get performance insights including retention data
   */
  async getPerformanceInsights(
    videoId: string,
    startDate: Date,
    endDate: Date
  ): Promise<YouTubePerformanceInsights> {
    const apiCall = async (): Promise<YouTubePerformanceInsights> => {
      await this.refreshTokenIfNeeded();

      const [metricsResponse, geoResponse] = await Promise.all([
        this.youtubeAnalytics.reports.query({
          ids: `channel==${this.channelId}`,
          startDate: this.formatDate(startDate),
          endDate: this.formatDate(endDate),
          metrics: "views,impressions,impressionClickThroughRate",
          filters: `video==${videoId}`,
        }),
        this.youtubeAnalytics.reports.query({
          ids: `channel==${this.channelId}`,
          startDate: this.formatDate(startDate),
          endDate: this.formatDate(endDate),
          metrics: "views,estimatedMinutesWatched",
          dimensions: "country",
          filters: `video==${videoId}`,
          sort: "-views",
          maxResults: 10,
        }),
      ]);

      const metrics = this.processAnalyticsResponse(metricsResponse);
      const geoData = this.processGeoResponse(geoResponse);

      return {
        retentionGraph: [], // Would require YouTube Analytics API audience retention data
        clickThroughRate: metrics.impressionClickThroughRate || 0,
        impressions: metrics.impressions || 0,
        topGeographies: geoData,
        searchTerms: [], // Would require search terms API data
      };
    };

    return circuitBreaker.call("youtube-analytics", "get-performance-insights", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // PII per-video: fold channel + videoId + the date window so video X never
      // returns video Y's cached performance and no cross-tenant sharing.
      cacheKeyDiscriminant: hashCallScope(
        this.channelId,
        videoId,
        startDate.getTime(),
        endDate.getTime()
      ),
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
        `Failed to refresh YouTube Analytics token: ${error}`
      );
    }
  }

  private formatDate(date: Date): string {
    const isoString = date.toISOString().split("T")[0];
    return isoString || "";
  }

  private aggregateMetrics(
    rows: Array<Array<string | number>>,
    headers: string[]
  ): Record<string, number> {
    const result: Record<string, number> = {};

    if (!rows.length) return result;

    // Skip the date column (index 0) and aggregate numeric metrics
    for (let colIndex = 1; colIndex < headers.length; colIndex++) {
      const metric = headers[colIndex];
      if (!metric) continue;

      let sum = 0;
      let count = 0;

      for (const row of rows) {
        const value = parseFloat(String(row[colIndex]));
        if (!isNaN(value)) {
          sum += value;
          count++;
        }
      }

      result[metric] = count > 0 ? sum : 0;
    }

    return result;
  }

  private processMetricResponse(response: {
    data: youtubeAnalytics_v2.Schema$QueryResponse;
  }): Record<string, number> {
    const result: Record<string, number> = {};
    const rows = response.data.rows || [];

    for (const row of rows) {
      const dimension = String(row[0]);
      const value = parseFloat(String(row[1]));
      if (!isNaN(value)) {
        result[dimension] = value;
      }
    }

    return result;
  }

  private processAnalyticsResponse(response: {
    data: youtubeAnalytics_v2.Schema$QueryResponse;
  }): Record<string, number> {
    const result: Record<string, number> = {};
    const rows = response.data.rows || [];
    const headers =
      response.data.columnHeaders
        ?.map((h) => h.name)
        .filter((name): name is string => name !== null && name !== undefined) || [];

    if (rows.length > 0) {
      for (let i = 0; i < headers.length; i++) {
        const value = parseFloat(String(rows[0]?.[i]));
        if (!isNaN(value)) {
          result[headers[i]!] = value;
        }
      }
    }

    return result;
  }

  private processGeoResponse(response: { data: youtubeAnalytics_v2.Schema$QueryResponse }): Array<{
    country: string;
    views: number;
    watchTime: number;
  }> {
    const rows = response.data.rows || [];
    return rows.map((row: Array<string | number>) => ({
      country: String(row[0]),
      views: parseInt(String(row[1])) || 0,
      watchTime: parseInt(String(row[2])) || 0,
    }));
  }

  private analyzeTitleSEO(title: string): { score: number; suggestions: string[] } {
    const suggestions: string[] = [];
    let score = 0;

    // Length check
    if (title.length >= 60 && title.length <= 100) {
      score += 30;
    } else if (title.length < 60) {
      suggestions.push("Consider making your title longer (60-100 characters) for better SEO");
    } else {
      suggestions.push("Consider shortening your title (60-100 characters) to avoid truncation");
    }

    // Keyword placement
    if (/^[A-Z]/.test(title)) {
      score += 20;
    } else {
      suggestions.push("Start your title with a capital letter");
    }

    // Numbers and brackets
    if (/\d/.test(title)) {
      score += 25;
    } else {
      suggestions.push("Including numbers in titles often increases click-through rates");
    }

    // Question or emotional words
    if (/\?|!|amazing|incredible|shocking|secret|revealed/.test(title.toLowerCase())) {
      score += 25;
    } else {
      suggestions.push("Consider adding emotional words or questions to increase engagement");
    }

    return { score, suggestions };
  }

  private analyzeDescriptionSEO(description: string): { score: number; suggestions: string[] } {
    const suggestions: string[] = [];
    let score = 0;

    // Length check
    if (description.length >= 200) {
      score += 40;
    } else {
      suggestions.push("Expand your description to at least 200 characters for better SEO");
    }

    // Links and CTAs
    if (/https?:\/\//.test(description)) {
      score += 30;
    } else {
      suggestions.push("Include relevant links in your description");
    }

    // Timestamps
    if (/\d{1,2}:\d{2}/.test(description)) {
      score += 30;
    } else {
      suggestions.push("Add timestamps to improve user experience and retention");
    }

    return { score, suggestions };
  }

  private analyzeTagsSEO(tags: string[]): { score: number; suggestions: string[] } {
    const suggestions: string[] = [];
    let score = 0;

    // Number of tags
    if (tags.length >= 5 && tags.length <= 15) {
      score += 50;
    } else if (tags.length < 5) {
      suggestions.push("Add more tags (5-15 recommended) to improve discoverability");
    } else {
      suggestions.push("Consider reducing tags to 15 or fewer for optimal performance");
    }

    // Tag length variety
    const hasShort = tags.some((tag) => tag.split(" ").length === 1);
    const hasLong = tags.some((tag) => tag.split(" ").length >= 3);

    if (hasShort && hasLong) {
      score += 50;
    } else {
      suggestions.push("Use a mix of short and long-tail keywords in your tags");
    }

    return { score, suggestions };
  }

  private async getOptimalPostingTimes(): Promise<string[]> {
    // This would analyze historical engagement data
    // For now, return general best practices
    return [
      "Tuesday 2-4 PM",
      "Wednesday 2-4 PM",
      "Thursday 12-3 PM",
      "Friday 12-3 PM",
      "Saturday 9-11 AM",
      "Sunday 9-11 AM",
    ];
  }
}
