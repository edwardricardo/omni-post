/**
 * @file smartContentOptimizerUtils.ts
 * @description Interfaces, API response adapters, and pure helper functions for
 * the SmartContentOptimizer component. Kept in a separate module so the main
 * component file stays under the 800-line limit.
 * @layer infrastructure
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentAnalysis {
  overallScore: number;
  engagementPotential: number;
  readabilityScore: number;
  sentimentScore: number;
  viralityIndex: number;
  seoScore: number;
  wordCount: number;
  characterCount: number;
  estimatedReadTime: number;
  keywordDensity: number;
}

export interface OptimizationSuggestion {
  id: string;
  type: "hashtags" | "mentions" | "tone" | "length" | "timing" | "structure" | "cta" | "emoji";
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  currentValue?: string;
  suggestedValue: string;
  expectedImpact: number;
  reasoning: string;
  implementation: "automatic" | "manual" | "optional";
}

export interface HashtagAnalysis {
  hashtag: string;
  platforms: string[];
}

export interface ToneAnalysis {
  detected: "professional" | "casual" | "humorous" | "urgent" | "inspirational" | "educational";
  confidence: number;
  appropriateFor: string[];
  suggestedTone?: string;
  emotionalTone: {
    positive: number;
    negative: number;
    neutral: number;
  };
}

export interface SmartContentOptimizerProps {
  content: string;
  platforms?: string[];
  targetAudience?: string;
  brandVoice?: "professional" | "casual" | "humorous" | "educational";
  onContentUpdate?: (optimizedContent: string) => void;
  onSuggestionApply?: (suggestion: OptimizationSuggestion) => void;
  realTimeAnalysis?: boolean;
  showAdvancedMetrics?: boolean;
}

// ---------------------------------------------------------------------------
// API response adapters
// ---------------------------------------------------------------------------

/**
 * Maps the /ai/analyze (engagement type) response to the component's
 * ContentAnalysis shape. The backend ContentAnalysis type has a different
 * structure, so we extract what we can and derive the rest from the raw text.
 */
export function adaptAnalysisResponse(
  apiValue: Record<string, unknown>,
  textContent: string
): ContentAnalysis {
  const wordCount = textContent.trim().split(/\s+/).length;
  const characterCount = textContent.length;
  const readTime = Math.ceil(wordCount / 200);

  // The API returns { sentiment, tone, readability, engagement } sub-objects
  const sentiment = apiValue.sentiment as { score?: number } | undefined;
  const readability = apiValue.readability as { score?: number } | undefined;
  const engagement = apiValue.engagement as { score?: number } | undefined;
  const tone = apiValue.tone as { confidence?: number } | undefined;

  // Normalise scores to 0-100 range.
  // sentiment.score is -1..1 → map to 0..100
  const rawSentiment = typeof sentiment?.score === "number" ? sentiment.score : 0;
  const sentimentScore = (rawSentiment + 1) / 2; // 0..1 for bar width

  const readabilityScore = typeof readability?.score === "number" ? readability.score * 100 : 0;
  const engagementScore = typeof engagement?.score === "number" ? engagement.score * 100 : 0;
  const toneConfidence = typeof tone?.confidence === "number" ? tone.confidence * 100 : 0;

  return {
    overallScore: (readabilityScore + engagementScore) / 2,
    engagementPotential: engagementScore,
    readabilityScore,
    sentimentScore,
    viralityIndex: toneConfidence,
    seoScore: 0, // Not provided by current endpoint
    wordCount,
    characterCount,
    estimatedReadTime: readTime,
    keywordDensity: wordCount > 0 ? (wordCount / characterCount) * 100 : 0,
  };
}

/**
 * Maps the /ai/optimize-content response to OptimizationSuggestion[].
 * The backend returns a rich object with optimizedText, changes, hashtags, etc.
 */
export function adaptOptimizationResponse(
  apiValue: Record<string, unknown>
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];

  // Map "changes" array to suggestions
  const changes = Array.isArray(apiValue.changes) ? apiValue.changes : [];
  changes.forEach(
    (
      change: { type?: string; original?: string; optimized?: string; reason?: string },
      index: number
    ) => {
      suggestions.push({
        id: `change-${index}`,
        type: "structure",
        priority: "medium",
        title: `Content improvement (${change.type ?? "modify"})`,
        description: change.reason ?? "Suggested content update",
        ...(change.original !== undefined && { currentValue: change.original }),
        suggestedValue: change.optimized ?? "",
        expectedImpact: 10,
        reasoning: change.reason ?? "",
        implementation: "manual",
      });
    }
  );

  // Add hashtag suggestion if the API returned hashtags
  const hashtags = Array.isArray(apiValue.hashtags) ? (apiValue.hashtags as string[]) : [];
  if (hashtags.length > 0) {
    suggestions.push({
      id: "hashtags-suggestion",
      type: "hashtags",
      priority: "high",
      title: "Add recommended hashtags",
      description: "Boost discoverability with these relevant hashtags",
      suggestedValue: hashtags.join(" "),
      expectedImpact: 15,
      reasoning: "Platform-optimised hashtags increase reach",
      implementation: "automatic",
    });
  }

  return suggestions;
}

/**
 * Maps the /ai/analyze (tone) response to the component's ToneAnalysis shape.
 */
export function adaptToneResponse(apiValue: Record<string, unknown>): ToneAnalysis | null {
  const tone = apiValue.tone as
    | {
        detected?: string;
        confidence?: number;
        suggestions?: string[];
      }
    | undefined;
  const sentiment = apiValue.sentiment as
    | {
        score?: number;
        label?: string;
      }
    | undefined;

  if (!tone) return null;

  const detected = tone.detected as ToneAnalysis["detected"] | undefined;
  const confidence = typeof tone.confidence === "number" ? tone.confidence * 100 : 50;

  const sentimentScore = typeof sentiment?.score === "number" ? sentiment.score : 0;
  const positive = Math.max(0, sentimentScore);
  const negative = Math.max(0, -sentimentScore);
  const neutral = 1 - positive - negative;

  return {
    detected: detected ?? "professional",
    confidence,
    appropriateFor: ["general audience"],
    ...(tone.suggestions?.[0] !== undefined && { suggestedTone: tone.suggestions[0] }),
    emotionalTone: {
      positive,
      negative,
      neutral: Math.max(0, neutral),
    },
  };
}

// ---------------------------------------------------------------------------
// Pure UI helper functions
// ---------------------------------------------------------------------------

/** Returns Tailwind CSS classes for a score badge based on its value (0-100). */
export function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 bg-green-100";
  if (score >= 60) return "text-yellow-600 bg-yellow-100";
  return "text-red-600 bg-red-100";
}

/** Returns Tailwind CSS classes for a suggestion card border/background based on priority. */
export function getPriorityColor(priority: string): string {
  switch (priority) {
    case "high":
      return "border-red-500 bg-red-50";
    case "medium":
      return "border-yellow-500 bg-yellow-50";
    case "low":
      return "border-green-500 bg-green-50";
    default:
      return "border-gray-500 bg-gray-50";
  }
}

/** Maps a platform display name (e.g. "twitter") to the API provider enum value. */
export const PLATFORM_TO_API_PROVIDER: Record<string, string> = {
  twitter: "X",
  x: "X",
  facebook: "FACEBOOK",
  instagram: "INSTAGRAM",
  tiktok: "TIKTOK",
  youtube: "YOUTUBE",
  linkedin: "LINKEDIN",
};
