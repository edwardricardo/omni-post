/**
 * @file playlistAnalyticsHelpers.ts
 * @description Pure helper functions for YouTube playlist analytics and optimization.
 * Extracted from YouTubePlaylistManager to keep file sizes within the 800-line limit.
 * These functions are stateless and operate solely on the data types defined in playlistTypes.ts.
 * @layer infrastructure
 */

import type { PlaylistAnalytics, PlaylistItem, PlaylistOptimization } from "./playlistTypes.js";

/**
 * Calculate an aggregate quality score (0-100) for a playlist based on its analytics.
 */
export function calculatePlaylistScore(analytics: PlaylistAnalytics): number {
  const completionScore = analytics.completionRate * 40;
  const engagementScore = Math.min(analytics.averageViewsPerVideo / 1000, 30);
  const flowScore = calculateFlowScore(analytics.viewerFlow);

  return Math.min(completionScore + engagementScore + flowScore, 100);
}

/**
 * Calculate how well viewers flow through the playlist (max 30 points).
 */
export function calculateFlowScore(viewerFlow: PlaylistAnalytics["viewerFlow"]): number {
  if (viewerFlow.length === 0) return 0;

  const averageFlow =
    viewerFlow.reduce((sum, flow) => sum + flow.percentage, 0) / viewerFlow.length;
  return Math.min(averageFlow, 30);
}

/**
 * Generate actionable optimization suggestions based on playlist analytics and items.
 */
export function generateOptimizationSuggestions(
  analytics: PlaylistAnalytics,
  _items: PlaylistItem[]
): PlaylistOptimization["suggestions"] {
  const suggestions: PlaylistOptimization["suggestions"] = [];

  // Completion rate suggestions
  if (analytics.completionRate < 0.3) {
    suggestions.push({
      type: "order",
      priority: "high",
      suggestion: "Reorder videos to put your best content first",
      expectedImpact: "Could increase completion rate by 15-25%",
    });
  }

  // Drop-off analysis
  const highDropOff = analytics.dropOffPoints.filter((point) => point.dropOffPercentage > 50);
  if (highDropOff.length > 0) {
    suggestions.push({
      type: "content",
      priority: "high",
      suggestion: `Review videos at positions ${highDropOff.map((p) => p.position).join(", ")} for high drop-off rates`,
      expectedImpact: "Could improve overall retention by 10-20%",
    });
  }

  // Title optimization
  if (analytics.title.length < 50) {
    suggestions.push({
      type: "title",
      priority: "medium",
      suggestion: "Expand playlist title to 50-100 characters for better SEO",
      expectedImpact: "Could increase discoverability by 5-10%",
    });
  }

  return suggestions;
}

/**
 * Generate a recommended reordering of playlist items based on retention analytics.
 */
export function generateOrderOptimization(
  analytics: PlaylistAnalytics,
  items: PlaylistItem[]
): PlaylistOptimization["orderOptimization"] {
  const sortedByPerformance = [...analytics.topPerformingVideos].sort(
    (a, b) => b.retentionRate - a.retentionRate
  );

  const recommendedOrder = items.map((item, index) => {
    const performance = sortedByPerformance.find((p) => p.videoId === item.videoId);
    const currentPosition = item.position;
    const recommendedPosition = performance ? sortedByPerformance.indexOf(performance) : index;

    return {
      currentPosition,
      recommendedPosition,
      videoId: item.videoId,
      title: item.title,
      reasoning: performance
        ? `High retention rate (${(performance.retentionRate * 100).toFixed(1)}%)`
        : "Maintain current position",
    };
  });

  return {
    recommendedOrder,
    estimatedImprovementPercent: 15, // Estimated improvement
  };
}

/**
 * Identify missing introductory or concluding videos in the playlist.
 */
export function identifyContentGaps(items: PlaylistItem[]): PlaylistOptimization["contentGaps"] {
  const contentGaps: PlaylistOptimization["contentGaps"] = [];

  const hasIntroduction = items.some((item) =>
    /intro|introduction|getting started|begin/i.test(item.title)
  );

  if (!hasIntroduction) {
    contentGaps.push({
      position: 0,
      suggestedTopic: "Introduction/Getting Started",
      reasoning: "Playlists perform better with a clear introduction video",
      keywords: ["introduction", "getting started", "overview", "basics"],
    });
  }

  const hasConclusion = items.some((item) => /conclusion|summary|wrap|final|end/i.test(item.title));

  if (!hasConclusion) {
    contentGaps.push({
      position: items.length,
      suggestedTopic: "Summary/Conclusion",
      reasoning: "A summary video can improve completion rates",
      keywords: ["summary", "conclusion", "wrap up", "key takeaways"],
    });
  }

  return contentGaps;
}

// Future: generateDropOffPoints
// Query YouTube Analytics API for real viewer drop-off data per playlist position.
// Requires: YouTube Analytics API v2 (reports.query with playlistViews metrics)

// Future: generateTopPerformingVideos
// Query YouTube Analytics API for real per-video metrics within a playlist
// (views, watchTime, retentionRate).
// Requires: YouTube Analytics API v2 (reports.query with video-level metrics)

// Future: generateViewerFlow
// Query YouTube Analytics API for real viewer flow between playlist positions
// (sequential viewing patterns, skip rates).
// Requires: YouTube Analytics API v2 (playlist engagement reports)
