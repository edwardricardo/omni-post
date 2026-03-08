/**
 * @file ai-content.ts
 * @description TypeScript type definitions for the AI content generation feature: content templates,
 * template variables, generated content shapes, metrics, variations, brand consistency, and settings.
 */
// AI Content Generation Types

export interface ContentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  platforms: string[];
  variables: TemplateVariable[];
  template: string;
  tone: string[];
  estimatedEngagement: number;
}

export interface TemplateVariable {
  name: string;
  type: "text" | "number" | "select" | "date" | "url";
  label: string;
  placeholder: string;
  required: boolean;
  options?: string[];
}

export interface GeneratedContent {
  id: string;
  platform: string;
  content: {
    text: string;
    hashtags: string[];
    mentions: string[];
    media?: MediaSuggestion[];
  };
  metrics: ContentMetrics;
  variations: ContentVariation[];
  brandConsistency: BrandConsistency;
}

export interface MediaSuggestion {
  type: "image" | "video";
  suggestion: string;
  dimensions: string;
}

export interface ContentMetrics {
  characterCount: number;
  wordCount: number;
  hashtagCount: number;
  readabilityScore: number;
  engagementScore: number;
  viralPotential: number;
}

export interface ContentVariation {
  id: string;
  text: string;
  tone: string;
  targetAudience: string;
}

export interface BrandConsistency {
  score: number;
  suggestions: string[];
  voiceMatch: boolean;
}

export interface GenerationSettings {
  creativity: number;
  platforms: string[];
  brandVoice: string;
  tone: string;
  length: string;
  includeHashtags: boolean;
  includeMentions: boolean;
  includeEmojis: boolean;
  generateVariations: boolean;
  abTestMode: boolean;
}

export type BrandVoice = "professional" | "casual" | "humorous" | "educational" | "inspirational";
export type ContentGoal = "awareness" | "engagement" | "conversion" | "education" | "entertainment";
