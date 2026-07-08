/**
 * @file hashtagManager.ts
 * @description TikTok hashtag manager orchestrating strategy generation,
 * challenge discovery, and recommendation workflows.
 * Types live in hashtagTypes.ts, discovery helpers in hashtagDiscovery.ts,
 * and analytics helpers in hashtagAnalytics.ts.
 * @layer infrastructure
 */

import {
  createExternalApiCircuitBreaker,
  hashCallScope,
  ANALYTICS_CB_OPTIONS,
  type CircuitBreakerStatus,
} from "@adapters/external-apis";
import { ProviderError } from "@providers/shared";
import * as client from "prom-client";
import type { TikTokResearchApiClient, TikTokTrendingHashtag } from "./researchApiClient.js";

// Re-export all types so existing importers continue to work
export type {
  HashtagStrategy,
  HashtagPerformance,
  HashtagMix,
  HashtagChallenge,
  HashtagAnalytics,
  HashtagRecommendation,
} from "./hashtagTypes.js";

import type {
  HashtagPerformance,
  HashtagMix,
  HashtagChallenge,
  HashtagRecommendation,
} from "./hashtagTypes.js";

import {
  createHashtagStrategy,
  extractKeywords,
  getTotalHashtagCount,
  calculateEstimatedReach,
  calculateDifficultyScore,
  assessCompetitionLevel,
  calculateViralPotential,
} from "./hashtagDiscovery.js";

import {
  generateStrategyRecommendations,
  generateStrategyWarnings,
  generateRecommendationsForGoal,
  generateOptimalMix,
  generateAlternatives,
  generateAvoidList,
  generateTimingRecommendations,
  generateReasons,
} from "./hashtagAnalytics.js";

// Global registry for circuit breaker metrics
const registry = new client.Registry();
const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);

export class TikTokHashtagManager {
  private researchClient: TikTokResearchApiClient;

  constructor(researchClient: TikTokResearchApiClient) {
    this.researchClient = researchClient;
  }

  /**
   * Generate optimal hashtag strategy for content
   */
  async generateHashtagStrategy(options: {
    contentCategory: string;
    targetAudience?: string;
    contentType?: "dance" | "comedy" | "education" | "lifestyle" | "business";
    region?: string;
    competitorHashtags?: string[];
    brandedHashtags?: string[];
  }): Promise<HashtagMix> {
    const apiCall = async (): Promise<HashtagMix> => {
      const trendingHashtags = await this.researchClient.getTrendingHashtags({
        category: options.contentCategory,
        ...(options.region && { region: options.region }),
        timeframe: "7d",
        limit: 50,
      });

      const hashtagPerformances = await Promise.all(
        trendingHashtags.slice(0, 20).map((h) => this.analyzeHashtagPerformance(h.hashtag))
      );

      const strategy = createHashtagStrategy(hashtagPerformances, options);
      const estimatedReach = calculateEstimatedReach(strategy);
      const difficultyScore = calculateDifficultyScore(strategy);
      const competitionLevel = assessCompetitionLevel(difficultyScore);
      const viralPotential = calculateViralPotential(strategy);
      const recommendations = generateStrategyRecommendations(strategy, hashtagPerformances);
      const warnings = generateStrategyWarnings(
        strategy,
        hashtagPerformances,
        getTotalHashtagCount(strategy)
      );

      return {
        strategy,
        totalHashtags: getTotalHashtagCount(strategy),
        estimatedReach,
        difficultyScore,
        competitionLevel,
        viralPotential,
        recommendations,
        warnings,
      };
    };

    return circuitBreaker.call("tiktok-hashtag-manager", "generate-hashtag-strategy", apiCall, [], {
      timeout: 30000,
      errorThresholdPercentage: 70,
      resetTimeout: 120000,
      maxRetries: 2,
      baseDelay: 3000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // Scope by the wrapped research client's credential AND the request options
      // so tenant B never runs tenant A's bound closure or reads A's strategy.
      cacheKeyDiscriminant: hashCallScope(this.researchClient.getCredentialScope(), options),
    });
  }

  /**
   * Analyze individual hashtag performance
   */
  async analyzeHashtagPerformance(hashtag: string): Promise<HashtagPerformance> {
    const apiCall = async (): Promise<HashtagPerformance> => {
      const trendingData = await this.researchClient.getTrendingHashtags({
        timeframe: "30d",
        limit: 100,
      });

      const hashtagData = trendingData.find((h) => h.hashtag === hashtag);
      if (!hashtagData) {
        throw ProviderError.notFound("tiktok", `Hashtag data for: ${hashtag}`);
      }

      let recommendation: "use" | "avoid" | "monitor" = "use";
      if (hashtagData.difficulty > 80) {
        recommendation = "avoid";
      } else if (hashtagData.difficulty > 60 || hashtagData.growth < 10) {
        recommendation = "monitor";
      }

      let trend: "rising" | "stable" | "declining" = "stable";
      if (hashtagData.growth > 20) {
        trend = "rising";
      } else if (hashtagData.growth < -10) {
        trend = "declining";
      }

      return {
        hashtag: hashtagData.hashtag,
        usage: hashtagData.volume,
        reach: hashtagData.volume * hashtagData.engagement,
        engagement: hashtagData.engagement,
        difficulty: hashtagData.difficulty,
        trend,
        competitiveness: hashtagData.difficulty,
        recommendation,
        optimalTiming: this.calculateOptimalTiming(hashtagData),
        relatedHashtags: hashtagData.relatedHashtags,
      };
    };

    return circuitBreaker.call(
      "tiktok-hashtag-manager",
      "analyze-hashtag-performance",
      apiCall,
      [],
      {
        timeout: 20000,
        errorThresholdPercentage: 60,
        resetTimeout: 90000,
        maxRetries: 3,
        baseDelay: 2000,
        maxDelay: 30000,
        jitterEnabled: true,
        cacheEnabled: true,
        ...ANALYTICS_CB_OPTIONS,
        // Scope by the wrapped research client's credential AND the queried
        // hashtag so tenant B never runs tenant A's bound closure.
        cacheKeyDiscriminant: hashCallScope(this.researchClient.getCredentialScope(), hashtag),
      }
    );
  }

  /**
   * Get active hashtag challenges
   */
  async getActiveHashtagChallenges(
    options: {
      category?: string;
      region?: string;
      minParticipants?: number;
    } = {}
  ): Promise<HashtagChallenge[]> {
    const apiCall = async (): Promise<HashtagChallenge[]> => {
      const mockChallenges: HashtagChallenge[] = [
        {
          id: "dance-trend-2024",
          hashtag: "#DanceTrend2024",
          name: "Dance Trend Challenge 2024",
          description: "Show us your best dance moves with this year's trending choreography",
          startDate: "2024-01-01",
          endDate: "2024-12-31",
          participantCount: 125000,
          totalViews: 45000000,
          rules: [
            "Use the official audio track",
            "Include the hashtag #DanceTrend2024",
            "Video must be 15-60 seconds",
            "Original choreography encouraged",
          ],
          category: "dance",
          difficulty: "easy",
          eligibility: ["All users", "No age restrictions"],
          submissionGuidelines: [
            "High-quality video",
            "Good lighting",
            "Clear audio",
            "Follow community guidelines",
          ],
          judging: {
            criteria: ["Creativity", "Skill", "Entertainment value"],
            winners: 100,
            announcement: "Weekly winners announced",
          },
          trending: true,
          officialAccount: "@tiktok",
          relatedHashtags: ["#dance", "#trending", "#viral"],
        },
        {
          id: "edu-challenge-2024",
          hashtag: "#LearnOnTikTok",
          name: "Educational Content Challenge",
          description: "Share your knowledge and teach something new",
          startDate: "2024-01-15",
          endDate: "2024-03-15",
          participantCount: 78000,
          totalViews: 22000000,
          rules: [
            "Content must be educational",
            "Include sources for facts",
            "Appropriate for all ages",
            "Use #LearnOnTikTok hashtag",
          ],
          category: "education",
          difficulty: "medium",
          eligibility: ["Educators", "Content creators", "Students"],
          submissionGuidelines: [
            "Fact-check all information",
            "Clear explanations",
            "Visual aids recommended",
            "Cite sources when applicable",
          ],
          judging: {
            criteria: ["Accuracy", "Clarity", "Engagement", "Impact"],
            winners: 50,
            announcement: "Monthly winners",
          },
          trending: true,
          relatedHashtags: ["#education", "#learning", "#knowledge"],
        },
      ];

      let filteredChallenges = mockChallenges;

      if (options.category) {
        filteredChallenges = filteredChallenges.filter((c) => c.category === options.category);
      }

      if (options.minParticipants) {
        filteredChallenges = filteredChallenges.filter(
          (c) => c.participantCount >= options.minParticipants!
        );
      }

      return filteredChallenges;
    };

    return circuitBreaker.call("tiktok-hashtag-manager", "get-active-challenges", apiCall, [], {
      timeout: 15000,
      errorThresholdPercentage: 60,
      resetTimeout: 60000,
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      jitterEnabled: true,
      cacheEnabled: true,
      ...ANALYTICS_CB_OPTIONS,
      // Scope by the wrapped research client's credential AND the filter options
      // so tenant B never runs tenant A's bound closure.
      cacheKeyDiscriminant: hashCallScope(this.researchClient.getCredentialScope(), options),
    });
  }

  /**
   * Create custom hashtag challenge
   */
  async createHashtagChallenge(
    challenge: Omit<HashtagChallenge, "id" | "participantCount" | "totalViews">
  ): Promise<HashtagChallenge> {
    const apiCall = async (): Promise<HashtagChallenge> => {
      const newChallenge: HashtagChallenge = {
        ...challenge,
        id: `custom-${Date.now()}`,
        participantCount: 0,
        totalViews: 0,
      };
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return newChallenge;
    };

    return circuitBreaker.call("tiktok-hashtag-manager", "create-hashtag-challenge", apiCall, [], {
      timeout: 10000,
      errorThresholdPercentage: 70,
      resetTimeout: 60000,
      maxRetries: 2,
      baseDelay: 2000,
      maxDelay: 20000,
      jitterEnabled: true,
      cacheEnabled: false,
      fallbackEnabled: false,
      // Write op (stays uncached): STATE-only partition by the wrapped research
      // client's credential so tenant B never runs tenant A's bound closure (W-1/D2b).
      cacheKeyDiscriminant: hashCallScope(this.researchClient.getCredentialScope()),
    });
  }

  /**
   * Get hashtag recommendations based on content and goals
   */
  async getHashtagRecommendations(options: {
    content: string;
    goals: "reach" | "engagement" | "viral" | "niche";
    currentHashtags?: string[];
    avoidHashtags?: string[];
    region?: string;
  }): Promise<HashtagRecommendation> {
    const apiCall = async (): Promise<HashtagRecommendation> => {
      const keywords = extractKeywords(options.content);

      const keywordTrends = await this.researchClient.getKeywordTrends(keywords, {
        ...(options.region && { region: options.region }),
        timeframe: "30d",
      });

      const trendingHashtags = await this.researchClient.getTrendingHashtags({
        ...(options.region && { region: options.region }),
        timeframe: "7d",
        limit: 100,
      });

      const recommended = generateRecommendationsForGoal(
        options.goals,
        keywordTrends,
        trendingHashtags,
        options.currentHashtags || [],
        options.avoidHashtags || []
      );

      const optimal = generateOptimalMix(recommended, options.goals);
      const alternatives = generateAlternatives(recommended);
      const avoid = generateAvoidList(trendingHashtags, options.avoidHashtags || []);
      const timing = generateTimingRecommendations(recommended);

      return {
        recommended: recommended.slice(0, 15),
        reasons: generateReasons(recommended),
        alternatives,
        optimal,
        avoid,
        timing,
      };
    };

    return circuitBreaker.call(
      "tiktok-hashtag-manager",
      "get-hashtag-recommendations",
      apiCall,
      [],
      {
        timeout: 35000,
        errorThresholdPercentage: 75,
        resetTimeout: 150000,
        maxRetries: 2,
        baseDelay: 5000,
        maxDelay: 45000,
        jitterEnabled: true,
        cacheEnabled: true,
        ...ANALYTICS_CB_OPTIONS,
        // Scope by the wrapped research client's credential AND the request options
        // so tenant B never runs tenant A's bound closure or reads A's recommendations.
        cacheKeyDiscriminant: hashCallScope(this.researchClient.getCredentialScope(), options),
      }
    );
  }

  // Private helpers

  private calculateOptimalTiming(_hashtagData: TikTokTrendingHashtag): string[] {
    return ["12:00 PM", "6:00 PM", "9:00 PM"];
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus(): Record<string, CircuitBreakerStatus | null> {
    return circuitBreaker.getAllStatuses();
  }

  /**
   * Get API metrics registry for monitoring
   */
  static getMetricsRegistry(): client.Registry {
    return registry;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    circuitBreaker.clearCache("tiktok-hashtag-manager");
  }
}
