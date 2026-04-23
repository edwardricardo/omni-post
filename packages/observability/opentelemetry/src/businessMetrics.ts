/**
 * @file businessMetrics.ts
 * @description Business intelligence and KPI tracking via OpenTelemetry meter — content
 *              publishing counters, success rate histograms, and engagement gauges.
 * @layer infrastructure
 */
import { metrics } from "@opentelemetry/api";
import pino from "pino";

const _logger = pino({ name: "business-metrics" });
const meter = metrics.getMeter("social-cms-business-kpis", "1.0.0");

// Content Publishing KPIs
const contentPublishedCounter = meter.createCounter("content_published_total", {
  description: "Total content pieces published across all platforms",
  unit: "1",
});

const publishingSuccessRate = meter.createHistogram("publishing_success_rate", {
  description: "Success rate of content publishing operations",
  unit: "%",
});

const contentPerformanceScore = meter.createHistogram("content_performance_score", {
  description: "Performance score of published content based on engagement",
  unit: "score",
});

// User Engagement KPIs
const userActiveSessionsGauge = meter.createUpDownCounter("user_active_sessions", {
  description: "Number of active user sessions",
  unit: "1",
});

const userRetentionRate = meter.createHistogram("user_retention_rate", {
  description: "User retention rate over different time periods",
  unit: "%",
});

const featureAdoptionCounter = meter.createCounter("feature_adoption_total", {
  description: "Feature adoption events by users",
  unit: "1",
});

// Social Media Provider KPIs
const providerAvailability = meter.createHistogram("provider_availability", {
  description: "Availability percentage of social media providers",
  unit: "%",
});

const providerRateLimit = meter.createHistogram("provider_rate_limit_utilization", {
  description: "Rate limit utilization percentage by provider",
  unit: "%",
});

const crossPlatformReach = meter.createCounter("cross_platform_reach_total", {
  description: "Total reach across all social media platforms",
  unit: "1",
});

// Business Revenue KPIs
const subscriptionConversionRate = meter.createHistogram("subscription_conversion_rate", {
  description: "Conversion rate from free to paid subscriptions",
  unit: "%",
});

const monthlyRecurringRevenue = meter.createUpDownCounter("monthly_recurring_revenue", {
  description: "Monthly recurring revenue in USD",
  unit: "USD",
});

const customerLifetimeValue = meter.createHistogram("customer_lifetime_value", {
  description: "Average customer lifetime value",
  unit: "USD",
});

// Content Quality KPIs
const contentModerationFlags = meter.createCounter("content_moderation_flags_total", {
  description: "Content flagged for moderation",
  unit: "1",
});

const aiContentOptimization = meter.createHistogram("ai_content_optimization_score", {
  description: "AI-driven content optimization scores",
  unit: "score",
});

// Operational KPIs
const systemUptime = meter.createHistogram("system_uptime_percentage", {
  description: "System uptime percentage",
  unit: "%",
});

const averageResponseTime = meter.createHistogram("average_response_time_ms", {
  description: "Average API response time",
  unit: "ms",
});

export interface ContentMetrics {
  postId: string;
  provider: string;
  contentType: "single" | "thread" | "story";
  publishTime: Date;
  success: boolean;
  error?: string;
  engagementScore?: number;
  reach?: number;
}

export interface UserMetrics {
  userId: string;
  sessionId: string;
  action: string;
  feature: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface ProviderMetrics {
  provider: string;
  endpoint: string;
  responseTime: number;
  success: boolean;
  rateLimitRemaining: number;
  rateLimitTotal: number;
}

export interface BusinessMetrics {
  tenantId: string;
  subscriptionTier: string;
  revenue: number;
  userCount: number;
  contentCount: number;
  engagementRate: number;
}

/**
 * Business KPI tracking service
 */
export class BusinessKPITracker {
  private logger: pino.Logger;

  constructor() {
    this.logger = pino({ name: "business-kpi-tracker" });
  }

  /**
   * Track content publishing metrics
   */
  trackContentPublication(metrics: ContentMetrics): void {
    try {
      const labels = {
        provider: metrics.provider,
        content_type: metrics.contentType,
        status: metrics.success ? "success" : "failed",
      };

      // Track published content
      contentPublishedCounter.add(1, labels);

      // Track success rate (in a real implementation, you'd calculate this over a window)
      const successRate = metrics.success ? 100 : 0;
      publishingSuccessRate.record(successRate, labels);

      // Track content performance if available
      if (metrics.engagementScore !== undefined) {
        contentPerformanceScore.record(metrics.engagementScore, {
          provider: metrics.provider,
          content_type: metrics.contentType,
        });
      }

      // Track cross-platform reach
      if (metrics.reach) {
        crossPlatformReach.add(metrics.reach, {
          provider: metrics.provider,
        });
      }

      this.logger.debug(
        {
          postId: metrics.postId,
          provider: metrics.provider,
          success: metrics.success,
          engagementScore: metrics.engagementScore,
        },
        "Content publication metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error, metrics }, "Failed to track content publication metrics");
    }
  }

  /**
   * Track user engagement and session metrics
   */
  trackUserEngagement(metrics: UserMetrics): void {
    try {
      const labels = {
        action: metrics.action,
        feature: metrics.feature,
      };

      // Track feature adoption
      featureAdoptionCounter.add(1, labels);

      // Track active session (increment/decrement based on action)
      if (metrics.action === "login" || metrics.action === "session_start") {
        userActiveSessionsGauge.add(1, { user_id: metrics.userId });
      } else if (metrics.action === "logout" || metrics.action === "session_end") {
        userActiveSessionsGauge.add(-1, { user_id: metrics.userId });
      }

      this.logger.debug(
        {
          userId: metrics.userId,
          action: metrics.action,
          feature: metrics.feature,
        },
        "User engagement metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error, metrics }, "Failed to track user engagement metrics");
    }
  }

  /**
   * Track social media provider performance
   */
  trackProviderPerformance(metrics: ProviderMetrics): void {
    try {
      const labels = {
        provider: metrics.provider,
        endpoint: metrics.endpoint,
      };

      // Track provider availability
      const availability = metrics.success ? 100 : 0;
      providerAvailability.record(availability, labels);

      // Track rate limit utilization
      const rateLimitUtilization =
        metrics.rateLimitTotal > 0
          ? ((metrics.rateLimitTotal - metrics.rateLimitRemaining) / metrics.rateLimitTotal) * 100
          : 0;
      providerRateLimit.record(rateLimitUtilization, labels);

      this.logger.debug(
        {
          provider: metrics.provider,
          responseTime: metrics.responseTime,
          success: metrics.success,
          rateLimitUtilization,
        },
        "Provider performance metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error, metrics }, "Failed to track provider performance metrics");
    }
  }

  /**
   * Track business revenue and subscription metrics
   */
  trackBusinessMetrics(metrics: BusinessMetrics): void {
    try {
      const labels = {
        tenant_id: metrics.tenantId,
        subscription_tier: metrics.subscriptionTier,
      };

      // Track MRR
      monthlyRecurringRevenue.add(metrics.revenue, labels);

      // Track engagement rate
      contentPerformanceScore.record(metrics.engagementRate * 100, {
        tenant_id: metrics.tenantId,
      });

      this.logger.debug(
        {
          tenantId: metrics.tenantId,
          revenue: metrics.revenue,
          userCount: metrics.userCount,
          contentCount: metrics.contentCount,
        },
        "Business metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error, metrics }, "Failed to track business metrics");
    }
  }

  /**
   * Track system operational metrics
   */
  trackSystemHealth(uptime: number, avgResponseTime: number): void {
    try {
      systemUptime.record(uptime * 100); // Convert to percentage
      averageResponseTime.record(avgResponseTime);

      this.logger.debug(
        {
          uptime: uptime * 100,
          avgResponseTime,
        },
        "System health metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to track system health metrics");
    }
  }

  /**
   * Track content moderation and AI optimization
   */
  trackContentQuality(moderationFlags: number, aiOptimizationScore?: number): void {
    try {
      contentModerationFlags.add(moderationFlags);

      if (aiOptimizationScore !== undefined) {
        aiContentOptimization.record(aiOptimizationScore);
      }

      this.logger.debug(
        {
          moderationFlags,
          aiOptimizationScore,
        },
        "Content quality metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to track content quality metrics");
    }
  }

  /**
   * Calculate and track user retention rate
   */
  trackUserRetention(retentionRate: number, period: string): void {
    try {
      userRetentionRate.record(retentionRate * 100, {
        period,
      });

      this.logger.debug(
        {
          retentionRate: retentionRate * 100,
          period,
        },
        "User retention metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to track user retention metrics");
    }
  }

  /**
   * Track subscription conversion metrics
   */
  trackSubscriptionConversion(conversionRate: number, fromTier: string, toTier: string): void {
    try {
      subscriptionConversionRate.record(conversionRate * 100, {
        from_tier: fromTier,
        to_tier: toTier,
      });

      this.logger.debug(
        {
          conversionRate: conversionRate * 100,
          fromTier,
          toTier,
        },
        "Subscription conversion metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to track subscription conversion metrics");
    }
  }

  /**
   * Track customer lifetime value
   */
  trackCustomerLifetimeValue(ltv: number, subscriptionTier: string): void {
    try {
      customerLifetimeValue.record(ltv, {
        subscription_tier: subscriptionTier,
      });

      this.logger.debug(
        {
          ltv,
          subscriptionTier,
        },
        "Customer LTV metrics tracked"
      );
    } catch (error) {
      this.logger.error({ error }, "Failed to track customer LTV metrics");
    }
  }
}

// Export singleton instance
export const businessKPITracker = new BusinessKPITracker();

/**
 * Utility functions for common business metric calculations
 */
export class BusinessMetricCalculations {
  /**
   * Calculate engagement rate from social media metrics
   */
  static calculateEngagementRate(
    likes: number,
    comments: number,
    shares: number,
    impressions: number
  ): number {
    if (impressions === 0) return 0;
    return (likes + comments + shares) / impressions;
  }

  /**
   * Calculate content performance score based on multiple factors
   */
  static calculateContentPerformanceScore(
    engagementRate: number,
    reach: number,
    clickThroughRate: number,
    conversionRate: number
  ): number {
    // Weighted score calculation (weights can be adjusted based on business priorities)
    const engagementWeight = 0.3;
    const reachWeight = 0.25;
    const ctrWeight = 0.25;
    const conversionWeight = 0.2;

    const normalizedEngagement = Math.min(engagementRate * 1000, 100); // Normalize to 0-100
    const normalizedReach = Math.min(reach / 10000, 100); // Normalize based on expected reach
    const normalizedCTR = Math.min(clickThroughRate * 100, 100);
    const normalizedConversion = Math.min(conversionRate * 100, 100);

    return (
      normalizedEngagement * engagementWeight +
      normalizedReach * reachWeight +
      normalizedCTR * ctrWeight +
      normalizedConversion * conversionWeight
    );
  }

  /**
   * Calculate monthly recurring revenue growth rate
   */
  static calculateMRRGrowthRate(currentMRR: number, previousMRR: number): number {
    if (previousMRR === 0) return 0;
    return (currentMRR - previousMRR) / previousMRR;
  }
}

export { BusinessMetricCalculations as MetricCalculations };
