/**
 * @file utils.ts
 * @description Pure utility functions for the performance insights module, including
 * day-name formatting and AI recommendation generation logic from raw analytics data.
 */

import type {
  ContentPerformance,
  OptimalTiming,
  HashtagPerformance,
  AudienceInsight,
  Recommendation,
} from "./types";

// Helper function for day names
function getDayName(dayOfWeek: number): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[dayOfWeek] ?? "Unknown";
}

// Recommendation generation logic
export function generateRecommendations(
  content: ContentPerformance[],
  timings: OptimalTiming[],
  hashtags: HashtagPerformance[],
  audience: AudienceInsight[],
  platforms: string[]
): Recommendation[] {
  const recs: Recommendation[] = [];

  // Timing recommendations
  timings.forEach((timing) => {
    if (timing.confidence > 0.8) {
      recs.push({
        id: `timing-${timing.platformId}`,
        type: "timing",
        priority: "high",
        title: `Optimize posting schedule for ${timing.platformId}`,
        description: `Your audience is ${timing.engagementMultiplier}x more active on ${getDayName(timing.dayOfWeek)} at ${timing.hour}:00`,
        expectedImpact: `${((timing.engagementMultiplier - 1) * 100).toFixed(0)}% increase in engagement`,
        actionItems: [
          `Schedule posts for ${getDayName(timing.dayOfWeek)} at ${timing.hour}:00`,
          "Test this timing with your next 3-5 posts",
          "Monitor engagement rates and adjust if needed",
        ],
        relatedData: timing,
        confidence: timing.confidence,
      });
    }
  });

  // Content format recommendations
  const bestPerformingContent = content.slice(0, 3);
  if (bestPerformingContent.length > 0) {
    const avgScore =
      bestPerformingContent.reduce((sum, c) => sum + c.score, 0) / bestPerformingContent.length;
    const hasMediaCount = bestPerformingContent.filter((c) => c.factors.hasMedia).length;
    const avgHashtagCount =
      bestPerformingContent.reduce((sum, c) => sum + c.factors.hashtags.length, 0) /
      bestPerformingContent.length;

    recs.push({
      id: "content-format",
      type: "content",
      priority: "high",
      title: "Replicate successful content patterns",
      description: `Your top content averages ${avgScore.toFixed(1)} performance score`,
      expectedImpact: "20-30% improvement in engagement",
      actionItems: [
        hasMediaCount > bestPerformingContent.length / 2
          ? "Include visual media in posts"
          : "Focus on text-based content",
        `Use approximately ${Math.round(avgHashtagCount)} hashtags per post`,
        "Keep content length similar to top performers",
        "Maintain consistent posting voice and style",
      ],
      relatedData: bestPerformingContent,
      confidence: 0.85,
    });
  }

  // Hashtag optimization
  const highPerformingHashtags = hashtags.filter(
    (h) =>
      h.avgEngagement > hashtags.reduce((sum, tag) => sum + tag.avgEngagement, 0) / hashtags.length
  );
  if (highPerformingHashtags.length > 0) {
    recs.push({
      id: "hashtag-optimization",
      type: "hashtags",
      priority: "medium",
      title: "Leverage high-performing hashtags",
      description: `${highPerformingHashtags.length} hashtags are driving significantly higher engagement`,
      expectedImpact: "15-25% increase in discoverability",
      actionItems: [
        ...highPerformingHashtags.map(
          (h) => `Use ${h.hashtag} (avg ${h.avgEngagement} engagement)`
        ),
        "Experiment with related hashtags",
        "Monitor hashtag performance weekly",
      ],
      relatedData: highPerformingHashtags,
      confidence: 0.82,
    });
  }

  // Audience growth recommendations
  audience.forEach((aud) => {
    if (aud.growthRate > 10) {
      recs.push({
        id: `audience-${aud.platformId}`,
        type: "audience",
        priority: "medium",
        title: `Capitalize on ${aud.platformId} audience growth`,
        description: `Your ${aud.platformId} audience is growing at ${aud.growthRate}% - optimize content for this momentum`,
        expectedImpact: "Sustain or increase current growth rate",
        actionItems: [
          ...aud.recommendations,
          `Focus on ${aud.engagement.contentPreferences.join(", ")}`,
          `Post during peak times: ${aud.engagement.peakTimes.join(", ")}`,
        ],
        relatedData: aud,
        confidence: 0.75,
      });
    }
  });

  // Platform diversification recommendation
  const platformPerformance = platforms.map((platform) => {
    const platformContent = content.filter((c) => c.platformId === platform);
    const avgScore =
      platformContent.length > 0
        ? platformContent.reduce((sum, c) => sum + c.score, 0) / platformContent.length
        : 0;
    return { platform, avgScore, postCount: platformContent.length };
  });

  const underperformingPlatforms = platformPerformance.filter(
    (p) => p.avgScore < 70 || p.postCount < 5
  );
  if (underperformingPlatforms.length > 0) {
    recs.push({
      id: "platform-optimization",
      type: "platform",
      priority: "low",
      title: "Improve underperforming platforms",
      description: `${underperformingPlatforms.length} platform(s) have room for improvement`,
      expectedImpact: "Better overall cross-platform performance",
      actionItems: [
        ...underperformingPlatforms.map((p) => `Increase posting frequency on ${p.platform}`),
        "Adapt content style for each platform",
        "Study platform-specific best practices",
      ],
      relatedData: underperformingPlatforms,
      confidence: 0.68,
    });
  }

  return recs.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return b.confidence - a.confidence;
  });
}
