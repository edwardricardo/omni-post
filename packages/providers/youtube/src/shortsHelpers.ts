/**
 * YouTube Shorts - Private Helper Functions
 *
 * Utility functions used internally by YouTubeShortsService:
 * content optimization, metadata analysis, duration parsing,
 * hashtag recommendations, and retention data generation.
 */

import { Readable } from "stream";
import { youtube_v3 } from "googleapis";
import { createLogger } from "@observability/logger";

const logger = createLogger("provider:youtube:shorts");

// ─── Title / Description / Tag Optimization ──────────────────────────────────

export function optimizeTitleForShorts(title: string): string {
  const shortsKeywords = ["#shorts", "#short", "#viral"];
  const hasShortKeyword = shortsKeywords.some((keyword) =>
    title.toLowerCase().includes(keyword.substring(1))
  );

  if (!hasShortKeyword && title.length < 50) {
    return `${title} #shorts`;
  }

  return title;
}

export function optimizeDescriptionForShorts(description: string): string {
  const shortsOptimizations = [
    "\n\n#shorts #viral #trending",
    "\n\nLike and follow for more!",
    "\n\nComment below ⬇️",
  ];

  let optimized = description;

  if (!description.includes("#shorts")) {
    optimized += shortsOptimizations[0];
  }

  if (
    !description.toLowerCase().includes("like") &&
    !description.toLowerCase().includes("follow")
  ) {
    optimized += shortsOptimizations[1];
  }

  if (!description.toLowerCase().includes("comment")) {
    optimized += shortsOptimizations[2];
  }

  return optimized;
}

export function optimizeTagsForShorts(tags: string[]): string[] {
  const shortsSpecificTags = ["shorts", "short", "viral", "trending", "fyp"];
  const optimizedTags = [...tags];

  for (const tag of shortsSpecificTags) {
    if (!optimizedTags.some((t) => t.toLowerCase().includes(tag))) {
      optimizedTags.push(tag);
    }
  }

  return optimizedTags.slice(0, 15); // Limit to 15 tags
}

// ─── Thumbnail Upload ─────────────────────────────────────────────────────────

export async function uploadCustomThumbnail(
  youtube: youtube_v3.Youtube,
  videoId: string,
  thumbnailUrl: string
): Promise<void> {
  try {
    const thumbnailResponse = await fetch(thumbnailUrl);
    if (!thumbnailResponse.ok) return;

    const thumbnailBuffer = await thumbnailResponse.arrayBuffer();
    const thumbnailStream = Readable.from(Buffer.from(thumbnailBuffer));

    await youtube.thumbnails.set({
      videoId,
      media: {
        body: thumbnailStream,
      },
    });
  } catch (error) {
    logger.warn({ err: error }, "Failed to upload custom thumbnail");
  }
}

// ─── Duration Parsing ─────────────────────────────────────────────────────────

export function parseDuration(duration: string): number {
  // Parse ISO 8601 duration (PT1M30S = 90 seconds)
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");

  return hours * 3600 + minutes * 60 + seconds;
}

// Future: generateRetentionData
// Query YouTube Analytics API for real audience retention data for a Shorts video.
// Requires: YouTube Analytics API v2 (reports.query with audienceRetention metrics)

// ─── Content Analysis ─────────────────────────────────────────────────────────

export function analyzeShortsTitle(title: string): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  let score = 0;

  // Length optimization for Shorts
  if (title.length >= 30 && title.length <= 60) {
    score += 30;
  } else if (title.length < 30) {
    suggestions.push("Consider making your title longer (30-60 characters) for better engagement");
  } else {
    suggestions.push("Consider shortening your title (30-60 characters) for mobile viewing");
  }

  // Shorts-specific keywords
  if (/#shorts|#short/i.test(title)) {
    score += 25;
  } else {
    suggestions.push("Add #shorts hashtag to increase discoverability");
  }

  // Emotional/action words
  if (/\b(amazing|shocking|secret|revealed|watch|see|must|incredible)\b/i.test(title)) {
    score += 25;
  } else {
    suggestions.push('Use engaging words like "amazing", "must see", or "shocking"');
  }

  // Numbers and symbols
  if (/\d|[!?]/.test(title)) {
    score += 20;
  } else {
    suggestions.push("Include numbers or punctuation for visual appeal");
  }

  return { score, suggestions };
}

export function analyzeShortsDescription(description: string): {
  score: number;
  suggestions: string[];
} {
  const suggestions: string[] = [];
  let score = 0;

  // Optimal length for Shorts descriptions
  if (description.length >= 100 && description.length <= 300) {
    score += 40;
  } else if (description.length < 100) {
    suggestions.push("Expand your description (100-300 characters) for better SEO");
  } else {
    suggestions.push("Consider shortening your description for mobile users");
  }

  // Hashtags
  const hashtagCount = (description.match(/#\w+/g) || []).length;
  if (hashtagCount >= 3 && hashtagCount <= 8) {
    score += 30;
  } else if (hashtagCount < 3) {
    suggestions.push("Add 3-8 relevant hashtags for better discoverability");
  } else {
    suggestions.push("Reduce hashtags to 8 or fewer to avoid appearing spammy");
  }

  // Call to action
  if (/like|follow|subscribe|comment|share/i.test(description)) {
    score += 30;
  } else {
    suggestions.push("Include a call-to-action (like, follow, comment)");
  }

  return { score, suggestions };
}

export function analyzeShortsContent(
  tags: string[],
  _category?: string
): { score: number; suggestions: string[] } {
  const suggestions: string[] = [];
  let score = 0;

  // Tag optimization
  if (tags.length >= 5 && tags.length <= 12) {
    score += 50;
  } else if (tags.length < 5) {
    suggestions.push("Add more tags (5-12 recommended) for better discoverability");
  } else {
    suggestions.push("Consider reducing tags to 12 or fewer for optimal performance");
  }

  // Shorts-specific tags
  const shortsTagsPresent = tags.some((tag) => /shorts?|viral|trending|fyp/i.test(tag));

  if (shortsTagsPresent) {
    score += 50;
  } else {
    suggestions.push('Include Shorts-specific tags like "shorts", "viral", or "trending"');
  }

  return { score, suggestions };
}

// Future: getTrendingKeywords
// Fetch real trending keywords from YouTube Search Suggest API or Google Trends API.
// Requires: YouTube Data API v3 search.list with trending parameters

// Future: getOptimalShortsPostingTimes
// Query YouTube Analytics API for real audience activity data to determine
// optimal posting times per channel.
// Requires: YouTube Analytics API v2 (audience activity reports)

export function generateHashtagRecommendations(tags: string[], category?: string): string[] {
  const recommendations = ["#shorts", "#viral", "#trending", "#fyp"];

  if (category) {
    switch (category.toLowerCase()) {
      case "comedy":
        recommendations.push("#funny", "#humor", "#meme", "#comedy");
        break;
      case "education":
        recommendations.push("#tutorial", "#learn", "#tips", "#howto");
        break;
      case "food":
        recommendations.push("#recipe", "#cooking", "#food", "#chef");
        break;
      case "lifestyle":
        recommendations.push("#lifestyle", "#motivation", "#inspiration");
        break;
      default:
        recommendations.push("#entertainment", "#content", "#creator");
    }
  }

  // Add tag-based recommendations
  tags.forEach((tag) => {
    if (tag.toLowerCase().includes("music")) {
      recommendations.push("#music", "#song", "#audio");
    }
    if (tag.toLowerCase().includes("dance")) {
      recommendations.push("#dance", "#moves", "#choreography");
    }
  });

  return [...new Set(recommendations)].slice(0, 10);
}
