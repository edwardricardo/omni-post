/**
 * @file postTemplates.ts
 * @description Pre-built social media post templates organized by category (announcement, promotion, engagement, etc.) with variable placeholders and platform targeting.
 * @layer infrastructure
 */

export interface PostTemplate {
  id: string;
  name: string;
  description: string;
  category:
    | "announcement"
    | "promotion"
    | "engagement"
    | "question"
    | "educational"
    | "personal"
    | "event";
  content: string;
  tags: string[];
  variables?: string[];
  platforms: string[];
  preview?: string;
}

export const postTemplates: PostTemplate[] = [
  // Announcement Templates
  {
    id: "product-launch",
    name: "Product Launch",
    description: "Announce a new product or feature",
    category: "announcement",
    content: `🚀 Exciting news! We're thrilled to announce the launch of {{PRODUCT_NAME}}!\n\n{{PRODUCT_DESCRIPTION}}\n\n✨ Key features:\n• {{FEATURE_1}}\n• {{FEATURE_2}}\n• {{FEATURE_3}}\n\nReady to get started? {{CALL_TO_ACTION}}\n\n#ProductLaunch #Innovation #NewFeature`,
    tags: ["ProductLaunch", "Innovation", "NewFeature"],
    variables: [
      "PRODUCT_NAME",
      "PRODUCT_DESCRIPTION",
      "FEATURE_1",
      "FEATURE_2",
      "FEATURE_3",
      "CALL_TO_ACTION",
    ],
    platforms: ["x", "linkedin", "instagram"],
    preview: "🚀 Exciting news! We're thrilled to announce the launch of our new amazing product!",
  },
  {
    id: "company-news",
    name: "Company News",
    description: "Share important company updates",
    category: "announcement",
    content: `📢 Important update from our team!\n\n{{NEWS_CONTENT}}\n\n{{ADDITIONAL_DETAILS}}\n\nWe're grateful for your continued support as we {{FUTURE_PLANS}}.\n\n#CompanyNews #Updates #Community`,
    tags: ["CompanyNews", "Updates", "Community"],
    variables: ["NEWS_CONTENT", "ADDITIONAL_DETAILS", "FUTURE_PLANS"],
    platforms: ["x", "linkedin"],
    preview: "📢 Important update from our team! We have some exciting news to share...",
  },

  // Promotional Templates
  {
    id: "limited-offer",
    name: "Limited Time Offer",
    description: "Promote time-sensitive deals",
    category: "promotion",
    content: `⏰ LIMITED TIME OFFER! ⏰\n\nGet {{DISCOUNT_AMOUNT}} off {{PRODUCT_SERVICE}} - but hurry, this deal expires {{EXPIRY_DATE}}!\n\n🎯 Perfect for {{TARGET_AUDIENCE}}\n💰 Save {{SAVINGS_AMOUNT}}\n🔥 {{URGENCY_REASON}}\n\nUse code: {{PROMO_CODE}}\n{{LINK}}\n\n#LimitedOffer #Sale #DontMissOut`,
    tags: ["LimitedOffer", "Sale", "DontMissOut"],
    variables: [
      "DISCOUNT_AMOUNT",
      "PRODUCT_SERVICE",
      "EXPIRY_DATE",
      "TARGET_AUDIENCE",
      "SAVINGS_AMOUNT",
      "URGENCY_REASON",
      "PROMO_CODE",
      "LINK",
    ],
    platforms: ["x", "instagram", "linkedin"],
    preview: "⏰ LIMITED TIME OFFER! Get 50% off our premium service - but hurry!",
  },
  {
    id: "new-service",
    name: "Service Promotion",
    description: "Promote your services or offerings",
    category: "promotion",
    content: `✨ Introducing our {{SERVICE_NAME}}! ✨\n\n{{SERVICE_DESCRIPTION}}\n\n🌟 What you get:\n→ {{BENEFIT_1}}\n→ {{BENEFIT_2}}\n→ {{BENEFIT_3}}\n\n💡 Perfect for {{IDEAL_CLIENT}}\n\nReady to {{ACTION_VERB}}? {{CONTACT_INFO}}\n\n#{{SERVICE_HASHTAG}} #ProfessionalServices #QualityFirst`,
    tags: ["ProfessionalServices", "QualityFirst"],
    variables: [
      "SERVICE_NAME",
      "SERVICE_DESCRIPTION",
      "BENEFIT_1",
      "BENEFIT_2",
      "BENEFIT_3",
      "IDEAL_CLIENT",
      "ACTION_VERB",
      "CONTACT_INFO",
      "SERVICE_HASHTAG",
    ],
    platforms: ["linkedin", "x"],
    preview: "✨ Introducing our premium consulting service! Perfect for growing businesses...",
  },

  // Engagement Templates
  {
    id: "behind-scenes",
    name: "Behind the Scenes",
    description: "Show your process or team",
    category: "engagement",
    content: `👀 Behind the scenes at {{COMPANY_NAME}}!\n\n{{SCENE_DESCRIPTION}}\n\nOur team is {{ACTIVITY_DESCRIPTION}}. It's amazing to see {{OBSERVATION}}!\n\n{{TEAM_MEMBER}} says: "{{QUOTE}}"\n\nWhat would you like to see more of? Let us know! 👇\n\n#BehindTheScenes #TeamWork #{{COMPANY_HASHTAG}}`,
    tags: ["BehindTheScenes", "TeamWork"],
    variables: [
      "COMPANY_NAME",
      "SCENE_DESCRIPTION",
      "ACTIVITY_DESCRIPTION",
      "OBSERVATION",
      "TEAM_MEMBER",
      "QUOTE",
      "COMPANY_HASHTAG",
    ],
    platforms: ["instagram", "linkedin", "x"],
    preview:
      "👀 Behind the scenes at our company! Our team is working hard on something amazing...",
  },
  {
    id: "user-spotlight",
    name: "User Spotlight",
    description: "Feature customers or community members",
    category: "engagement",
    content: `🌟 Community Spotlight: Meet {{USER_NAME}}! 🌟\n\n{{USER_BIO}}\n\n💫 How they use {{PRODUCT_SERVICE}}:\n"{{USER_TESTIMONIAL}}"\n\n{{ACHIEVEMENT_DESCRIPTION}}\n\nThank you for being part of our community, {{USER_NAME}}! 🙏\n\nWant to be featured? {{CTA}}\n\n#CommunitySpotlight #CustomerLove #{{BRAND_HASHTAG}}`,
    tags: ["CommunitySpotlight", "CustomerLove"],
    variables: [
      "USER_NAME",
      "USER_BIO",
      "PRODUCT_SERVICE",
      "USER_TESTIMONIAL",
      "ACHIEVEMENT_DESCRIPTION",
      "CTA",
      "BRAND_HASHTAG",
    ],
    platforms: ["instagram", "linkedin", "x"],
    preview:
      "🌟 Community Spotlight: Meet Sarah! She's been using our product to achieve amazing results...",
  },

  // Question Templates
  {
    id: "poll-question",
    name: "Poll Question",
    description: "Ask your audience to vote or choose",
    category: "question",
    content: `🤔 Quick question for you!\n\n{{QUESTION_CONTEXT}}\n\nWhich would you choose?\n\nA) {{OPTION_A}}\nB) {{OPTION_B}}\n\n{{ADDITIONAL_CONTEXT}}\n\nVote in the comments! We'd love to hear your thoughts 💭\n\n#{{TOPIC_HASHTAG}} #Community #YourOpinionMatters`,
    tags: ["Community", "YourOpinionMatters"],
    variables: ["QUESTION_CONTEXT", "OPTION_A", "OPTION_B", "ADDITIONAL_CONTEXT", "TOPIC_HASHTAG"],
    platforms: ["x", "instagram", "linkedin"],
    preview: "🤔 Quick question for you! Which feature would you like us to build next?",
  },
  {
    id: "feedback-request",
    name: "Feedback Request",
    description: "Ask for feedback or opinions",
    category: "question",
    content: `💬 We need your input!\n\n{{FEEDBACK_CONTEXT}}\n\n🎯 Specifically, we'd love to know:\n• {{QUESTION_1}}\n• {{QUESTION_2}}\n• {{QUESTION_3}}\n\nYour feedback helps us {{IMPROVEMENT_GOAL}}.\n\nDrop your thoughts in the comments! 👇\n\n#Feedback #Community #{{IMPROVEMENT_HASHTAG}}`,
    tags: ["Feedback", "Community"],
    variables: [
      "FEEDBACK_CONTEXT",
      "QUESTION_1",
      "QUESTION_2",
      "QUESTION_3",
      "IMPROVEMENT_GOAL",
      "IMPROVEMENT_HASHTAG",
    ],
    platforms: ["x", "linkedin"],
    preview: "💬 We need your input! Help us improve by sharing your thoughts on...",
  },

  // Educational Templates
  {
    id: "tip-tuesday",
    name: "Tip Tuesday",
    description: "Share helpful tips and advice",
    category: "educational",
    content: `💡 #TipTuesday: {{TIP_TITLE}}\n\n{{TIP_DESCRIPTION}}\n\n📋 Here's how:\n1. {{STEP_1}}\n2. {{STEP_2}}\n3. {{STEP_3}}\n\n⚡ Pro tip: {{PRO_TIP}}\n\nTried this? Let us know how it worked for you!\n\n#TipTuesday #{{TOPIC_HASHTAG}} #Learning`,
    tags: ["TipTuesday", "Learning"],
    variables: [
      "TIP_TITLE",
      "TIP_DESCRIPTION",
      "STEP_1",
      "STEP_2",
      "STEP_3",
      "PRO_TIP",
      "TOPIC_HASHTAG",
    ],
    platforms: ["linkedin", "x", "instagram"],
    preview: "💡 #TipTuesday: How to boost your productivity with this simple trick...",
  },
  {
    id: "myth-busting",
    name: "Myth Busting",
    description: "Correct common misconceptions",
    category: "educational",
    content: `🚫 MYTH: {{MYTH_STATEMENT}}\n\n✅ REALITY: {{REALITY_EXPLANATION}}\n\n🔍 Why this matters:\n{{IMPORTANCE_EXPLANATION}}\n\n📊 The facts:\n• {{FACT_1}}\n• {{FACT_2}}\n• {{FACT_3}}\n\nHave you heard this myth before? What other misconceptions about {{TOPIC}} should we address?\n\n#MythBusting #Facts #{{TOPIC_HASHTAG}}`,
    tags: ["MythBusting", "Facts"],
    variables: [
      "MYTH_STATEMENT",
      "REALITY_EXPLANATION",
      "IMPORTANCE_EXPLANATION",
      "FACT_1",
      "FACT_2",
      "FACT_3",
      "TOPIC",
      "TOPIC_HASHTAG",
    ],
    platforms: ["linkedin", "x"],
    preview:
      "🚫 MYTH: You need expensive tools to be productive. ✅ REALITY: Simple systems work best...",
  },

  // Personal Templates
  {
    id: "personal-story",
    name: "Personal Story",
    description: "Share personal experiences or lessons",
    category: "personal",
    content: `💭 Personal reflection: {{STORY_TITLE}}\n\n{{STORY_CONTEXT}}\n\n{{CHALLENGE_DESCRIPTION}}\n\nWhat I learned:\n→ {{LESSON_1}}\n→ {{LESSON_2}}\n→ {{LESSON_3}}\n\n{{CURRENT_PERSPECTIVE}}\n\nCan you relate? What's a lesson that changed your perspective?\n\n#PersonalGrowth #Lessons #{{THEME_HASHTAG}}`,
    tags: ["PersonalGrowth", "Lessons"],
    variables: [
      "STORY_TITLE",
      "STORY_CONTEXT",
      "CHALLENGE_DESCRIPTION",
      "LESSON_1",
      "LESSON_2",
      "LESSON_3",
      "CURRENT_PERSPECTIVE",
      "THEME_HASHTAG",
    ],
    platforms: ["linkedin", "x"],
    preview: "💭 Personal reflection: The mistake that taught me everything about leadership...",
  },

  // Event Templates
  {
    id: "event-announcement",
    name: "Event Announcement",
    description: "Promote upcoming events or webinars",
    category: "event",
    content: `🎉 {{EVENT_TYPE}}: {{EVENT_NAME}} 🎉\n\n📅 {{EVENT_DATE}}\n⏰ {{EVENT_TIME}}\n📍 {{EVENT_LOCATION}}\n\n{{EVENT_DESCRIPTION}}\n\n🎯 Perfect for:\n• {{AUDIENCE_1}}\n• {{AUDIENCE_2}}\n• {{AUDIENCE_3}}\n\n✨ What you'll learn:\n→ {{TAKEAWAY_1}}\n→ {{TAKEAWAY_2}}\n→ {{TAKEAWAY_3}}\n\n{{REGISTRATION_CTA}}: {{REGISTRATION_LINK}}\n\n#{{EVENT_HASHTAG}} #{{TOPIC_HASHTAG}} #Events`,
    tags: ["Events"],
    variables: [
      "EVENT_TYPE",
      "EVENT_NAME",
      "EVENT_DATE",
      "EVENT_TIME",
      "EVENT_LOCATION",
      "EVENT_DESCRIPTION",
      "AUDIENCE_1",
      "AUDIENCE_2",
      "AUDIENCE_3",
      "TAKEAWAY_1",
      "TAKEAWAY_2",
      "TAKEAWAY_3",
      "REGISTRATION_CTA",
      "REGISTRATION_LINK",
      "EVENT_HASHTAG",
      "TOPIC_HASHTAG",
    ],
    platforms: ["linkedin", "x", "instagram"],
    preview: "🎉 Webinar: Mastering Social Media Strategy 📅 March 15th ⏰ 2:00 PM EST...",
  },
];

export function getTemplatesByCategory(category: PostTemplate["category"]): PostTemplate[] {
  return postTemplates.filter((template) => template.category === category);
}

export function fillTemplateVariables(
  template: PostTemplate,
  variables: Record<string, string>
): string {
  let content = template.content;

  // Replace variables in the format {{VARIABLE_NAME}}
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, "g");
    content = content.replace(regex, value);
  });

  return content;
}

export const templateCategories = [
  {
    id: "announcement",
    name: "Announcements",
    description: "Product launches, company news, updates",
  },
  { id: "promotion", name: "Promotions", description: "Sales, offers, service promotions" },
  { id: "engagement", name: "Engagement", description: "Behind the scenes, user spotlights" },
  { id: "question", name: "Questions", description: "Polls, feedback requests, discussions" },
  { id: "educational", name: "Educational", description: "Tips, tutorials, myth busting" },
  { id: "personal", name: "Personal", description: "Stories, experiences, reflections" },
  { id: "event", name: "Events", description: "Webinars, conferences, meetups" },
] as const;
