/**
 * @file ai-content-templates.ts
 * @description Default content template definitions for the AI content generator.
 * Each template describes a content pattern with configurable variables,
 * target platforms, and estimated engagement metrics.
 *
 * Dynamic templates can be fetched from the /templates API endpoint when available.
 */

import type { ContentTemplate } from "../../types/ai-content";

export const DEFAULT_CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    id: "product-launch",
    name: "Product Launch Announcement",
    description: "Generate engaging product launch content with key features and benefits",
    category: "Announcements",
    platforms: ["twitter", "linkedin", "facebook", "instagram"],
    variables: [
      {
        name: "productName",
        type: "text",
        label: "Product Name",
        placeholder: "Enter product name",
        required: true,
      },
      {
        name: "keyFeature",
        type: "text",
        label: "Key Feature",
        placeholder: "Main benefit or feature",
        required: true,
      },
      {
        name: "targetMarket",
        type: "select",
        label: "Target Market",
        placeholder: "Select market",
        required: true,
        options: ["B2B", "B2C", "Enterprise", "SMB"],
      },
      {
        name: "launchDate",
        type: "date",
        label: "Launch Date",
        placeholder: "When is it launching?",
        required: false,
      },
      {
        name: "websiteUrl",
        type: "url",
        label: "Website URL",
        placeholder: "https://...",
        required: false,
      },
    ],
    template:
      "🚀 Excited to announce {{productName}}! {{keyFeature}} designed specifically for {{targetMarket}}. {{launchDate ? `Available ${launchDate}` : `Coming soon`}} {{websiteUrl ? `Learn more: ${websiteUrl}` : ``}}",
    tone: ["exciting", "professional", "innovative"],
    estimatedEngagement: 85,
  },
  {
    id: "how-to-guide",
    name: "How-To Guide",
    description: "Create educational content that provides step-by-step guidance",
    category: "Educational",
    platforms: ["linkedin", "twitter", "facebook"],
    variables: [
      {
        name: "topic",
        type: "text",
        label: "Topic",
        placeholder: "What will you teach?",
        required: true,
      },
      {
        name: "difficulty",
        type: "select",
        label: "Difficulty Level",
        placeholder: "Select level",
        required: true,
        options: ["Beginner", "Intermediate", "Advanced"],
      },
      {
        name: "timeRequired",
        type: "text",
        label: "Time Required",
        placeholder: "5 minutes, 1 hour, etc.",
        required: false,
      },
      {
        name: "tools",
        type: "text",
        label: "Tools/Requirements",
        placeholder: "What tools are needed?",
        required: false,
      },
    ],
    template:
      "📚 How to {{topic}} ({{difficulty}} Guide)\n\n{{timeRequired ? `⏱️ Time needed: ${timeRequired}\n` : ``}}{{tools ? `🛠️ You'll need: ${tools}\n` : ``}}\nThread below 👇",
    tone: ["helpful", "educational", "clear"],
    estimatedEngagement: 78,
  },
  {
    id: "industry-insight",
    name: "Industry Insight",
    description: "Share thought leadership content about industry trends and insights",
    category: "Thought Leadership",
    platforms: ["linkedin", "twitter"],
    variables: [
      {
        name: "trend",
        type: "text",
        label: "Industry Trend",
        placeholder: "What trend are you discussing?",
        required: true,
      },
      {
        name: "impact",
        type: "text",
        label: "Impact/Implication",
        placeholder: "What does this mean?",
        required: true,
      },
      {
        name: "prediction",
        type: "text",
        label: "Future Prediction",
        placeholder: "What do you predict?",
        required: false,
      },
      {
        name: "industry",
        type: "text",
        label: "Industry",
        placeholder: "Tech, Finance, Healthcare...",
        required: true,
      },
    ],
    template:
      "🔍 {{industry}} Insight: {{trend}}\n\n💡 What this means: {{impact}}\n\n{{prediction ? `🔮 My prediction: ${prediction}\n\n` : ``}}What are your thoughts? 💬",
    tone: ["authoritative", "insightful", "engaging"],
    estimatedEngagement: 82,
  },
  {
    id: "behind-scenes",
    name: "Behind the Scenes",
    description: "Create authentic content showing the human side of your brand",
    category: "Authentic",
    platforms: ["instagram", "linkedin", "facebook"],
    variables: [
      {
        name: "activity",
        type: "text",
        label: "Activity/Process",
        placeholder: "What are you showing?",
        required: true,
      },
      {
        name: "teamMember",
        type: "text",
        label: "Team Member",
        placeholder: "Who is featured?",
        required: false,
      },
      {
        name: "lesson",
        type: "text",
        label: "Lesson/Insight",
        placeholder: "What did you learn?",
        required: false,
      },
      {
        name: "location",
        type: "text",
        label: "Location",
        placeholder: "Where is this happening?",
        required: false,
      },
    ],
    template:
      "👀 Behind the scenes: {{activity}}\n\n{{teamMember ? `Featuring our amazing ${teamMember}` : ``}}{{location ? ` at ${location}` : ``}}!\n\n{{lesson ? `💡 Key insight: ${lesson}\n\n` : ``}}Love sharing the real work that goes into what we do ✨",
    tone: ["authentic", "personal", "warm"],
    estimatedEngagement: 76,
  },
  {
    id: "question-engagement",
    name: "Question for Engagement",
    description: "Generate thought-provoking questions to boost community engagement",
    category: "Engagement",
    platforms: ["twitter", "linkedin", "facebook"],
    variables: [
      {
        name: "topic",
        type: "text",
        label: "Topic",
        placeholder: "What topic area?",
        required: true,
      },
      {
        name: "context",
        type: "text",
        label: "Context",
        placeholder: "Brief setup or context",
        required: false,
      },
      {
        name: "questionType",
        type: "select",
        label: "Question Type",
        placeholder: "Select type",
        required: true,
        options: ["Opinion", "Experience", "Prediction", "Choice", "Strategy"],
      },
    ],
    template:
      "{{context ? `${context}\n\n` : ``}}🤔 {{questionType}} question about {{topic}}:\n\n[AI will generate specific question based on type]\n\nDrop your thoughts below! 👇",
    tone: ["curious", "engaging", "inclusive"],
    estimatedEngagement: 88,
  },
  {
    id: "milestone-celebration",
    name: "Milestone Celebration",
    description: "Celebrate achievements and milestones with your community",
    category: "Celebration",
    platforms: ["linkedin", "twitter", "facebook", "instagram"],
    variables: [
      {
        name: "milestone",
        type: "text",
        label: "Milestone",
        placeholder: "What are you celebrating?",
        required: true,
      },
      {
        name: "metric",
        type: "text",
        label: "Metric/Number",
        placeholder: "1000 customers, 1M downloads...",
        required: true,
      },
      {
        name: "gratitude",
        type: "text",
        label: "Thank You Message",
        placeholder: "Who do you want to thank?",
        required: false,
      },
      {
        name: "nextGoal",
        type: "text",
        label: "Next Goal",
        placeholder: "What's next?",
        required: false,
      },
    ],
    template:
      "🎉 We just hit {{metric}} {{milestone}}!\n\n{{gratitude ? `Huge thanks to ${gratitude} - this wouldn't be possible without you! ` : ``}}🙏\n\n{{nextGoal ? `Next up: ${nextGoal}. Let's keep this momentum going! ` : ``}}💪",
    tone: ["celebratory", "grateful", "inspiring"],
    estimatedEngagement: 91,
  },
];
