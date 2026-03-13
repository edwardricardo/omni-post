import { PrismaClient } from "./generated/prisma/client/client.js";
import { Provider, SubscriptionTier } from "./generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required for seeding");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Create a default account first
  const account = await prisma.account.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      email: "demo@example.com",
      name: "Demo Account",
      subscription: SubscriptionTier.PRO,
      maxProjects: 3,
    },
  });

  // Create project under the account
  const project = await prisma.project.upsert({
    where: {
      accountId_name: {
        accountId: account.id,
        name: "Gol de Ayer",
      },
    },
    update: {},
    create: {
      accountId: account.id,
      name: "Gol de Ayer",
      locale: "es",
    },
  });

  await prisma.channel.upsert({
    where: { id: "dev-x" },
    update: {},
    create: {
      id: "dev-x",
      projectId: project.id,
      provider: Provider.X,
      handle: "@GolDeAyerDev",
      credentials: { token: "REEMPLAZAR" },
    },
  });

  // Seed system AI prompt templates (migrated from hardcoded array)
  const systemTemplates = [
    {
      name: "Product Launch Announcement",
      category: "Announcements",
      platforms: ["twitter", "linkedin", "facebook", "instagram"],
      prompt:
        "🚀 Excited to announce {{productName}}! {{keyFeature}} designed specifically for {{targetMarket}}. {{launchDate ? `Available ${launchDate}` : `Coming soon`}} {{websiteUrl ? `Learn more: ${websiteUrl}` : ``}}",
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
      tone: ["exciting", "professional", "innovative"],
    },
    {
      name: "How-To Guide",
      category: "Educational",
      platforms: ["linkedin", "twitter", "facebook"],
      prompt:
        "📚 How to {{topic}} ({{difficulty}} Guide)\n\n{{timeRequired ? `⏱️ Time needed: ${timeRequired}\n` : ``}}{{tools ? `🛠️ You'll need: ${tools}\n` : ``}}\nThread below 👇",
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
      tone: ["helpful", "educational", "clear"],
    },
    {
      name: "Industry Insight",
      category: "Thought Leadership",
      platforms: ["linkedin", "twitter"],
      prompt:
        "🔍 {{industry}} Insight: {{trend}}\n\n💡 What this means: {{impact}}\n\n{{prediction ? `🔮 My prediction: ${prediction}\n\n` : ``}}What are your thoughts? 💬",
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
      tone: ["authoritative", "insightful", "engaging"],
    },
    {
      name: "Behind the Scenes",
      category: "Authentic",
      platforms: ["instagram", "linkedin", "facebook"],
      prompt:
        "👀 Behind the scenes: {{activity}}\n\n{{teamMember ? `Featuring our amazing ${teamMember}` : ``}}{{location ? ` at ${location}` : ``}}!\n\n{{lesson ? `💡 Key insight: ${lesson}\n\n` : ``}}Love sharing the real work that goes into what we do ✨",
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
      tone: ["authentic", "personal", "warm"],
    },
    {
      name: "Question for Engagement",
      category: "Engagement",
      platforms: ["twitter", "linkedin", "facebook"],
      prompt:
        "{{context ? `${context}\n\n` : ``}}🤔 {{questionType}} question about {{topic}}:\n\n[AI will generate specific question based on type]\n\nDrop your thoughts below! 👇",
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
      tone: ["curious", "engaging", "inclusive"],
    },
    {
      name: "Milestone Celebration",
      category: "Celebration",
      platforms: ["linkedin", "twitter", "facebook", "instagram"],
      prompt:
        "🎉 We just hit {{metric}} {{milestone}}!\n\n{{gratitude ? `Huge thanks to ${gratitude} - this wouldn't be possible without you! ` : ``}}🙏\n\n{{nextGoal ? `Next up: ${nextGoal}. Let's keep this momentum going! ` : ``}}💪",
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
      tone: ["celebratory", "grateful", "inspiring"],
    },
  ];

  for (const tpl of systemTemplates) {
    await prisma.aIPromptTemplate.upsert({
      where: { id: `system-${tpl.name.toLowerCase().replace(/\s+/g, "-")}` },
      update: {},
      create: {
        id: `system-${tpl.name.toLowerCase().replace(/\s+/g, "-")}`,
        accountId: null,
        name: tpl.name,
        category: tpl.category,
        platforms: tpl.platforms,
        prompt: tpl.prompt,
        variables: tpl.variables,
        tone: tpl.tone,
        isSystem: true,
      },
    });
  }

  console.log("Seed OK", { account, project, systemTemplates: systemTemplates.length });
}

main().finally(() => prisma.$disconnect());
