/**
 * @file ai-content-utils.ts
 * @description Client-side utility functions for AI content generation: character limit color
 * thresholds, engagement score colors, hashtag generation, media suggestions, and platform-specific
 * text optimization with emoji and variation helpers.
 */
// AI Content Generation Utility Functions

export function getCharacterLimitColor(count: number, platform: string): string {
  const limits: Record<string, number> = {
    twitter: 280,
    linkedin: 1300,
    facebook: 500,
    instagram: 500,
  };
  const limit = limits[platform] || 500;
  const percentage = (count / limit) * 100;

  if (percentage > 90) return "text-red-600";
  if (percentage > 75) return "text-yellow-600";
  return "text-green-600";
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 bg-green-100";
  if (score >= 60) return "text-yellow-600 bg-yellow-100";
  return "text-red-600 bg-red-100";
}

// Client-side hashtag generation; the /ai/optimize endpoint provides data-driven suggestions
function generateHashtags(platform: string, topic: string): string[] {
  const baseHashtags: Record<string, string[]> = {
    twitter: ["tech", "innovation", "startup", "growth", "business"],
    linkedin: ["leadership", "professional", "career", "business", "growth"],
    facebook: ["community", "family", "friends", "life", "sharing"],
    instagram: ["lifestyle", "inspiration", "photooftheday", "beautiful", "amazing"],
  };

  const topicHashtags = [
    topic.toLowerCase().replace(/\s+/g, ""),
    "content",
    "digital",
    "marketing",
  ];

  const platformHashtags = baseHashtags[platform] || [];
  const combined = [...platformHashtags, ...topicHashtags];

  return combined.slice(0, platform === "instagram" ? 8 : 3);
}

function generateMediaSuggestions(
  platform: string,
  category: string
): Array<{ type: "image" | "video"; suggestion: string; dimensions: string }> {
  const suggestions: Record<
    string,
    Array<{ type: "image" | "video"; suggestion: string; dimensions: string }>
  > = {
    Announcements: [
      {
        type: "image",
        suggestion: "Product hero image with logo overlay",
        dimensions: "1200x630",
      },
      {
        type: "video",
        suggestion: "Short product demo or teaser",
        dimensions: "1080x1080",
      },
    ],
    Educational: [
      {
        type: "image",
        suggestion: "Infographic with key steps or tips",
        dimensions: "1080x1350",
      },
    ],
    "Thought Leadership": [
      {
        type: "image",
        suggestion: "Quote card with key insight",
        dimensions: "1200x675",
      },
    ],
  };

  return suggestions[category] || [];
}

// Client-side variation generation; the /ai/generate endpoint provides LLM-assisted variations
export function generateVariations(
  baseText: string,
  _platform: string
): Array<{ id: string; text: string; tone: string; targetAudience: string }> {
  const tones = ["professional", "casual", "enthusiastic", "authoritative"];
  const audiences = ["executives", "professionals", "students", "entrepreneurs"];

  return tones.slice(0, 2).map((tone, index) => ({
    id: `var-${index}`,
    text: `${tone === "casual" ? "👋 " : ""}${baseText.replace(/\./g, tone === "enthusiastic" ? "!" : ".")}`,
    tone,
    targetAudience: audiences[index] || "professionals",
  }));
}

/** Static brand optimization tips shown during content creation. */
const BRAND_SUGGESTIONS = [
  "Consider adding your brand tagline",
  "Include a call-to-action",
  "Add your website link",
  "Use consistent brand hashtags",
  "Maintain consistent tone of voice",
];

export function generateBrandSuggestions(): string[] {
  return BRAND_SUGGESTIONS;
}

export function optimizeForPlatform(
  templateText: string,
  platform: string,
  formData: Record<string, string>,
  settings: { includeHashtags: boolean; includeMentions: boolean; includeEmojis: boolean }
): {
  text: string;
  hashtags: string[];
  mentions: string[];
  media: Array<{ type: "image" | "video"; suggestion: string; dimensions: string }>;
} {
  let text = templateText;

  // Replace template variables
  Object.keys(formData).forEach((key) => {
    const value = formData[key];
    text = text.replace(new RegExp(`{{${key}}}`, "g"), value || "");
  });

  // Clean up empty conditionals
  text = text.replace(/\{\{[^}]*\}\}/g, "");
  text = text.replace(/\s+/g, " ").trim();

  const topic = formData.topic || formData.productName || "content";
  const hashtags = settings.includeHashtags ? generateHashtags(platform, topic) : [];
  // Mentions are not generated client-side — they must come from the /ai/generate endpoint
  const mentions: string[] = [];
  const media = generateMediaSuggestions(platform, "Announcements");

  // Platform character limits and formatting
  switch (platform) {
    case "twitter":
      if (text.length > 240) {
        text = text.substring(0, 237) + "...";
      }
      break;
    case "linkedin":
      text += "\n\n#" + hashtags.slice(0, 3).join(" #");
      break;
    case "instagram":
      text += "\n\n" + hashtags.map((h) => `#${h}`).join(" ");
      break;
    case "facebook":
      // Facebook doesn't require hashtags as much
      break;
  }

  if (settings.includeEmojis) {
    // Deterministic emoji selection based on content hash to avoid random output
    const emojis = ["✨", "🔥", "💡", "🚀", "🎯", "💪", "🌟", "⭐"];
    const hash = text.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const emoji = emojis[hash % emojis.length];
    if (emoji) {
      text += " " + emoji;
    }
  }

  return { text, hashtags, mentions, media };
}
