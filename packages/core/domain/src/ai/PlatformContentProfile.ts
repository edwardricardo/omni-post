/**
 * @file PlatformContentProfile.ts
 * @description Content strategy profiles for each social platform.
 *              Used by AI to generate platform-native content variants.
 * @layer domain
 */

export interface PlatformProfile {
  name: string;
  maxChars: number;
  style: string;
  hashtagStrategy: string;
  toneNotes: string;
  structure: string;
  avoidances: string;
}

export const PLATFORM_CONTENT_PROFILES: Record<string, PlatformProfile> = {
  X: {
    name: "X (Twitter)",
    maxChars: 280,
    style: "punchy, direct, conversational",
    hashtagStrategy: "2-3 highly relevant hashtags at the end",
    toneNotes:
      "Start with a hook — question, bold statement, or surprising fact. No corporate speak.",
    structure: "Hook → Core message → CTA or hashtags",
    avoidances: "Do not use em dashes. Avoid lists. No 'Excited to announce'.",
  },
  INSTAGRAM: {
    name: "Instagram",
    maxChars: 2200,
    style: "visual-first, aspirational, community-focused",
    hashtagStrategy: "5-10 targeted hashtags, mix of niche and broad",
    toneNotes: "Write as if describing a scene or feeling. Lead with emotion, back with context.",
    structure: "Emotional hook → Story/context → CTA → Hashtags (separate from text)",
    avoidances: "Avoid link mentions (links don't work in captions). Don't start with 'I'.",
  },
  LINKEDIN: {
    name: "LinkedIn",
    maxChars: 3000,
    style: "professional, insightful, thought-leadership",
    hashtagStrategy: "3-5 professional hashtags at the very end",
    toneNotes: "Share expertise or a lesson learned. First-person perspective works well.",
    structure: "Bold first line → Context/story → Key insight → CTA or question",
    avoidances: "No slang. Avoid excessive emoji. Don't oversell.",
  },
  TIKTOK: {
    name: "TikTok",
    maxChars: 2200,
    style: "casual, trend-aware, entertainment-first",
    hashtagStrategy: "3-5 trending hashtags + 2-3 niche",
    toneNotes: "Write like talking to a friend. References to trends and memes are good.",
    structure: "Hook question/challenge → Body → CTA for comments/duets",
    avoidances: "Avoid formal language. Don't ignore trending challenges.",
  },
  FACEBOOK: {
    name: "Facebook",
    maxChars: 63206,
    style: "community-oriented, conversational, shareable",
    hashtagStrategy: "1-2 hashtags maximum (hashtags less effective on Facebook)",
    toneNotes: "Encourage discussion. Ask questions. Share stories.",
    structure: "Engaging question or statement → Context → Discussion question",
    avoidances: "Don't paste Instagram posts verbatim. Avoid hashtag overuse.",
  },
  YOUTUBE: {
    name: "YouTube",
    maxChars: 5000,
    style: "informative, searchable, detail-rich",
    hashtagStrategy: "3-5 hashtags in description for search",
    toneNotes:
      "Write descriptions as companion content to the video. Include timestamps if relevant.",
    structure: "Video summary → Key points → Links/resources → CTA to subscribe",
    avoidances: "Don't repeat the title verbatim as the first line.",
  },
  BLUESKY: {
    name: "Bluesky",
    maxChars: 300,
    style: "authentic, thoughtful, slightly niche",
    hashtagStrategy: "1-2 hashtags maximum",
    toneNotes: "Bluesky skews tech/creator audience. Authentic over polished.",
    structure: "Direct statement or question → Optional context",
    avoidances: "Avoid corporate/marketing tone. No platitudes.",
  },
  PINTEREST: {
    name: "Pinterest",
    maxChars: 500,
    style: "aspirational, keyword-rich, actionable",
    hashtagStrategy: "No hashtags — use keywords naturally in description",
    toneNotes: "Focus on what the user can DO with this content. Be actionable and inspiring.",
    structure: "Descriptive title → What it is → How to use/make it → Why it matters",
    avoidances: "Don't be salesy. Avoid clickbait. Pinterest rewards genuine value.",
  },
  SNAPCHAT: {
    name: "Snapchat",
    maxChars: 250,
    style: "ephemeral, casual, authentic",
    hashtagStrategy: "No hashtags",
    toneNotes: "Keep it real and spontaneous. FOMO-driven content works well.",
    structure: "Quick hook → Behind-the-scenes or exclusive → Swipe up CTA",
    avoidances: "Don't over-produce. Avoid long text. Raw and real wins.",
  },
  TELEGRAM: {
    name: "Telegram",
    maxChars: 4096,
    style: "informative, community-focused, detailed",
    hashtagStrategy: "2-3 hashtags for discoverability",
    toneNotes: "Telegram users expect substance. Longer, more detailed posts work well.",
    structure: "Key update → Detailed explanation → Links/resources → Discussion prompt",
    avoidances: "Don't be too casual. Telegram communities value depth over brevity.",
  },
  THREADS: {
    name: "Threads",
    maxChars: 500,
    style: "conversational, authentic, community-first",
    hashtagStrategy: "Minimal — 0-3 hashtags, audience uses search not hashtags",
    toneNotes:
      "Threads rewards genuine conversation over broadcast marketing. Speak to a community, not an audience. Ask questions. Share perspectives.",
    structure: "Standalone thought or question → optional context → optional CTA",
    avoidances:
      "Avoid link spam (links discouraged in feed). Avoid cross-posting from X verbatim. No hashtag walls.",
  },
} as const;
