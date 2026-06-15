/**
 * @file engagementPredictor.config.ts
 * @description Model weights and platform-specific configuration constants
 *              for the engagement predictor.
 * @layer infrastructure
 */

import type { ContentType, ProviderType } from "@shared/types/analytics.js";

// ---------------------------------------------------------------------------
// Rule-based scoring weights
// ---------------------------------------------------------------------------

/**
 * Feature weights for the engagement scoring model.
 *
 * NOTE: These are hand-tuned heuristic weights, NOT machine-learned parameters.
 * They are based on industry best practices and platform documentation rather
 * than statistical training on real data. Treat them as configurable constants
 * for a rule-based scoring system.
 */
export const MODEL_WEIGHTS = {
  contentLength: -0.02, // Negative: shorter content often performs better
  hashtagCount: 0.15, // Positive: hashtags help discoverability
  mediaPresence: 0.45, // Strong positive: visual content performs better
  timeOfDay: 0.25, // Timing matters significantly
  dayOfWeek: 0.18, // Some days perform better
  historicalPerformance: 0.35, // Past performance predicts future
  contentSentiment: 0.12, // Positive sentiment generally better
  seasonality: 0.08, // Seasonal effects
  trending: 0.22, // Trending topics boost performance
  audienceAlignment: 0.3, // Content-audience fit is crucial
} as const;

export type ModelWeights = typeof MODEL_WEIGHTS;

// ---------------------------------------------------------------------------
// Platform configuration
// ---------------------------------------------------------------------------

export interface PlatformConfig {
  textOptimal: number;
  hashtagOptimal: number;
  mediaBoost: number;
  peakHours: number[];
  contentTypeMultipliers: Record<ContentType, number>;
}

/**
 * Per-platform constants that drive content scoring and timing optimisation.
 */
export const PLATFORM_MULTIPLIERS: Record<ProviderType, PlatformConfig> = {
  X: {
    textOptimal: 120,
    hashtagOptimal: 2,
    mediaBoost: 1.3,
    peakHours: [9, 12, 17, 19],
    contentTypeMultipliers: {
      text: 1.0,
      image: 1.35,
      video: 1.8,
      carousel: 1.1,
      story: 0.8,
      reel: 0.9,
      thread: 1.2,
      poll: 1.5,
      live: 2.1,
    },
  },
  INSTAGRAM: {
    textOptimal: 150,
    hashtagOptimal: 8,
    mediaBoost: 2.1,
    peakHours: [11, 13, 17, 19, 21],
    contentTypeMultipliers: {
      text: 0.6,
      image: 1.5,
      video: 1.9,
      carousel: 1.7,
      story: 1.4,
      reel: 2.3,
      thread: 0.7,
      poll: 1.3,
      live: 1.8,
    },
  },
  FACEBOOK: {
    textOptimal: 200,
    hashtagOptimal: 3,
    mediaBoost: 1.4,
    peakHours: [10, 14, 15, 20],
    contentTypeMultipliers: {
      text: 1.0,
      image: 1.4,
      video: 1.6,
      carousel: 1.3,
      story: 1.2,
      reel: 1.1,
      thread: 0.8,
      poll: 1.4,
      live: 1.9,
    },
  },
  LINKEDIN: {
    textOptimal: 300,
    hashtagOptimal: 5,
    mediaBoost: 1.2,
    peakHours: [8, 12, 17, 18],
    contentTypeMultipliers: {
      text: 1.2,
      image: 1.3,
      video: 1.5,
      carousel: 1.4,
      story: 0.9,
      reel: 0.8,
      thread: 1.1,
      poll: 1.6,
      live: 1.7,
    },
  },
  YOUTUBE: {
    textOptimal: 500,
    hashtagOptimal: 10,
    mediaBoost: 3.0,
    peakHours: [14, 16, 18, 20, 21],
    contentTypeMultipliers: {
      text: 0.3,
      image: 0.5,
      video: 3.0,
      carousel: 0.7,
      story: 1.1,
      reel: 2.5,
      thread: 0.4,
      poll: 1.2,
      live: 2.8,
    },
  },
  TIKTOK: {
    textOptimal: 100,
    hashtagOptimal: 6,
    mediaBoost: 2.8,
    peakHours: [16, 18, 19, 20, 21, 22],
    contentTypeMultipliers: {
      text: 0.2,
      image: 0.8,
      video: 2.8,
      carousel: 1.0,
      story: 1.3,
      reel: 2.9,
      thread: 0.3,
      poll: 1.4,
      live: 2.2,
    },
  },
  PINTEREST: {
    textOptimal: 200,
    hashtagOptimal: 10,
    mediaBoost: 2.5,
    peakHours: [10, 14, 20, 21],
    contentTypeMultipliers: {
      text: 0.4,
      image: 2.5,
      video: 1.8,
      carousel: 2.2,
      story: 0.9,
      reel: 1.5,
      thread: 0.3,
      poll: 1.1,
      live: 0.8,
    },
  },
  SNAPCHAT: {
    textOptimal: 80,
    hashtagOptimal: 0,
    mediaBoost: 2.6,
    peakHours: [16, 18, 20, 22],
    contentTypeMultipliers: {
      text: 0.2,
      image: 1.6,
      video: 2.4,
      carousel: 0.6,
      story: 2.8,
      reel: 1.2,
      thread: 0.2,
      poll: 0.7,
      live: 1.0,
    },
  },
  TELEGRAM: {
    textOptimal: 400,
    hashtagOptimal: 3,
    mediaBoost: 1.3,
    peakHours: [9, 13, 18, 21],
    contentTypeMultipliers: {
      text: 1.1,
      image: 1.3,
      video: 1.5,
      carousel: 1.2,
      story: 0.6,
      reel: 0.7,
      thread: 0.9,
      poll: 1.4,
      live: 1.2,
    },
  },
  BLUESKY: {
    textOptimal: 250,
    hashtagOptimal: 2,
    mediaBoost: 1.3,
    peakHours: [9, 12, 17, 20],
    contentTypeMultipliers: {
      text: 1.1,
      image: 1.3,
      video: 0.9,
      carousel: 0.8,
      story: 0.5,
      reel: 0.6,
      thread: 1.2,
      poll: 0.8,
      live: 0.7,
    },
  },
  THREADS: {
    textOptimal: 200,
    hashtagOptimal: 3,
    mediaBoost: 1.6,
    peakHours: [9, 12, 18, 20],
    contentTypeMultipliers: {
      text: 1.1,
      image: 1.4,
      video: 1.6,
      carousel: 1.3,
      story: 0.7,
      reel: 0.9,
      thread: 1.3,
      poll: 0.9,
      live: 1.1,
    },
  },
};
