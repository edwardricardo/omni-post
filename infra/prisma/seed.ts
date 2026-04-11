import path from "path";
import dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.join(import.meta.dirname, "../../.env") });

import { PrismaClient } from "./generated/prisma/client/client.js";
import { Provider } from "./generated/prisma/client/client.js";
import argon2 from "argon2";
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
    update: {
      isOnTrial: false,
    },
    create: {
      email: "demo@example.com",
      name: "Demo Account",
      maxProjects: 3,
      isOnTrial: false,
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

  // Create AccountSubscription for demo account if it doesn't exist
  await prisma.accountSubscription.upsert({
    where: { accountId: account.id },
    update: {},
    create: {
      accountId: account.id,
      providers: ["X"],
      status: "ACTIVE",
      pricePerMonth: 10.0,
      maxProjects: 3,
      billingCycle: "MONTHLY",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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

  // Upsert system roles and their permissions before creating the admin user
  const systemRoles = [
    {
      id: "role-super-admin",
      name: "SUPER_ADMIN",
      description: "Full system access with all permissions",
      level: 100,
      isSystem: true,
      permissions: [
        "user:read",
        "user:manage",
        "user:manage_roles",
        "account:read",
        "account:manage",
        "billing:read",
        "billing:manage",

        "pricing:manage",
        "analytics:read",
        "analytics:export",
        "system:configure",
        "system:monitor",
        "audit:read",
        "audit:export",
        "webhook:manage",
      ],
    },
    {
      id: "role-admin",
      name: "ADMIN",
      description: "Administrative access with account and user management capabilities",
      level: 50,
      isSystem: true,
      permissions: [
        "user:read",
        "user:manage",
        "account:read",
        "account:manage",
        "billing:read",
        "billing:manage",

        "analytics:read",
        "analytics:export",
        "system:monitor",
        "audit:read",
        "webhook:manage",
      ],
    },
    {
      id: "role-support",
      name: "SUPPORT",
      description: "Limited access for customer support operations",
      level: 10,
      isSystem: true,
      permissions: ["user:read", "account:read", "billing:read", "analytics:read", "audit:read"],
    },
  ];

  for (const roleDef of systemRoles) {
    await prisma.role.upsert({
      where: { id: roleDef.id },
      update: {
        description: roleDef.description,
        level: roleDef.level,
      },
      create: {
        id: roleDef.id,
        name: roleDef.name,
        description: roleDef.description,
        level: roleDef.level,
        isSystem: roleDef.isSystem,
        isActive: true,
      },
    });

    // Delete existing permissions and re-insert (idempotent)
    await prisma.rolePermission.deleteMany({ where: { roleId: roleDef.id } });
    for (const perm of roleDef.permissions) {
      await prisma.rolePermission.create({
        data: { roleId: roleDef.id, permission: perm },
      });
    }
  }

  // Seed SUPER_ADMIN user for local development
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin123!";
  const hashedPassword = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });

  const adminUser = await prisma.adminUser.upsert({
    where: { email: "admin@omnipost.local" },
    update: { passwordHash: hashedPassword },
    create: {
      email: "admin@omnipost.local",
      passwordHash: hashedPassword,
      name: "SuperAdmin",
      roleId: "role-super-admin",
      isActive: true,
    },
  });

  // Seed provider pricing tiers
  const providerTiers = [
    { minProviders: 1, maxProviders: 3, pricePerProviderMonth: 10.0 },
    { minProviders: 4, maxProviders: 7, pricePerProviderMonth: 8.0 },
    { minProviders: 8, maxProviders: null, pricePerProviderMonth: 6.0 },
  ];
  for (const tier of providerTiers) {
    await prisma.providerPricingTier.upsert({
      where: {
        minProviders_isActive: { minProviders: tier.minProviders, isActive: true },
      },
      update: {
        maxProviders: tier.maxProviders,
        pricePerProviderMonth: tier.pricePerProviderMonth,
      },
      create: { ...tier, isActive: true, effectiveFrom: new Date() },
    });
  }

  // Seed account pricing tiers (volume discounts)
  const accountTiers = [
    { minAccounts: 1, maxAccounts: 1, multiplier: 1.0 },
    { minAccounts: 2, maxAccounts: 5, multiplier: 0.9 },
    { minAccounts: 6, maxAccounts: null, multiplier: 0.8 },
  ];
  for (const tier of accountTiers) {
    await prisma.accountPricingTier.upsert({
      where: {
        minAccounts_isActive: { minAccounts: tier.minAccounts, isActive: true },
      },
      update: { maxAccounts: tier.maxAccounts, multiplier: tier.multiplier },
      create: { ...tier, isActive: true, effectiveFrom: new Date() },
    });
  }

  // Seed provider bundles
  const bundles = [
    {
      name: "Starter",
      slug: "starter",
      description: "X + Instagram + Facebook",
      providers: ["X", "INSTAGRAM", "FACEBOOK"],
      pricePerAccountMonth: 20.0,
      sortOrder: 1,
    },
    {
      name: "Growth",
      slug: "growth",
      description: "Starter + LinkedIn + TikTok + YouTube",
      providers: ["X", "INSTAGRAM", "FACEBOOK", "LINKEDIN", "TIKTOK", "YOUTUBE"],
      pricePerAccountMonth: 40.0,
      sortOrder: 2,
    },
    {
      name: "Agency Full",
      slug: "agency-full",
      description: "All 11 providers",
      providers: [
        "X",
        "INSTAGRAM",
        "FACEBOOK",
        "YOUTUBE",
        "TIKTOK",
        "LINKEDIN",
        "PINTEREST",
        "SNAPCHAT",
        "TELEGRAM",
        "BLUESKY",
        "THREADS",
      ],
      pricePerAccountMonth: 60.0,
      sortOrder: 3,
    },
  ];
  for (const bundle of bundles) {
    await prisma.providerBundle.upsert({
      where: { slug: bundle.slug },
      update: {
        name: bundle.name,
        description: bundle.description,
        providers: bundle.providers,
        pricePerAccountMonth: bundle.pricePerAccountMonth,
        sortOrder: bundle.sortOrder,
      },
      create: { ...bundle, isActive: true },
    });
  }

  console.log("Seed OK", {
    account,
    project,
    systemTemplates: systemTemplates.length,
    adminUser: { email: adminUser.email, roleId: adminUser.roleId },
    pricingTiers: providerTiers.length,
    accountTiers: accountTiers.length,
    bundles: bundles.length,
  });

  await seedTestAccounts();
}

/**
 * @function seedTestAccounts
 * @description Seeds 10 test client accounts with varied subscription statuses,
 *              providers, timezones, and locales for development and QA testing.
 */
async function seedTestAccounts() {
  const now = new Date();
  const daysFromNow = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const ALL_PROVIDERS: Provider[] = [
    Provider.X,
    Provider.INSTAGRAM,
    Provider.FACEBOOK,
    Provider.YOUTUBE,
    Provider.TIKTOK,
    Provider.LINKEDIN,
    Provider.PINTEREST,
    Provider.SNAPCHAT,
    Provider.TELEGRAM,
    Provider.BLUESKY,
    Provider.THREADS,
  ];

  const testAccounts = [
    {
      email: "agency-alpha@test.omnipost.local",
      name: "Agency Alpha",
      timezone: "America/New_York",
      locale: "en",
      isOnTrial: false,
      maxProjects: 5,
      providers: [Provider.X, Provider.INSTAGRAM, Provider.FACEBOOK, Provider.LINKEDIN],
      status: "ACTIVE" as const,
      price: 32,
      handle: "@agencyalpha",
    },
    {
      email: "beta-media@test.omnipost.local",
      name: "Beta Media Group",
      timezone: "America/Los_Angeles",
      locale: "en",
      isOnTrial: true,
      trialEndDate: daysFromNow(7),
      maxProjects: 3,
      providers: [Provider.X, Provider.INSTAGRAM],
      status: "TRIALING" as const,
      price: 20,
      handle: "@betamedia",
    },
    {
      email: "gamma-social@test.omnipost.local",
      name: "Gamma Social",
      timezone: "Europe/London",
      locale: "en",
      isOnTrial: false,
      maxProjects: 4,
      providers: [Provider.X, Provider.INSTAGRAM, Provider.FACEBOOK],
      status: "GRANDFATHERED" as const,
      price: 28,
      grandfatheredFrom: 35,
      handle: "@gammasocial",
    },
    {
      email: "delta-mkt@test.omnipost.local",
      name: "Delta Marketing",
      timezone: "America/Chicago",
      locale: "en",
      isOnTrial: false,
      maxProjects: 10,
      providers: ALL_PROVIDERS,
      status: "ACTIVE" as const,
      price: 55,
      handle: "@deltamkt",
    },
    {
      email: "epsilon-digital@test.omnipost.local",
      name: "Epsilon Digital",
      timezone: "America/Sao_Paulo",
      locale: "es",
      isOnTrial: false,
      maxProjects: 2,
      providers: [Provider.X],
      status: "ACTIVE" as const,
      price: 12,
      handle: "@epsilondigital",
    },
    {
      email: "zeta-creative@test.omnipost.local",
      name: "Zeta Creative Studio",
      timezone: "Europe/Madrid",
      locale: "es",
      isOnTrial: false,
      maxProjects: 3,
      providers: [Provider.INSTAGRAM, Provider.TIKTOK],
      status: "CANCELED" as const,
      price: 0,
      handle: "@zetacreative",
    },
    {
      email: "eta-brand@test.omnipost.local",
      name: "Eta Brand Agency",
      timezone: "America/Mexico_City",
      locale: "es",
      isOnTrial: true,
      trialEndDate: daysFromNow(3),
      maxProjects: 3,
      providers: [Provider.X, Provider.INSTAGRAM, Provider.YOUTUBE],
      status: "TRIALING" as const,
      price: 25,
      handle: "@etabrand",
    },
    {
      email: "theta-media@test.omnipost.local",
      name: "Theta Media",
      timezone: "Europe/Paris",
      locale: "en",
      isOnTrial: false,
      maxProjects: 5,
      providers: [Provider.X, Provider.INSTAGRAM, Provider.LINKEDIN],
      status: "ACTIVE" as const,
      price: 30,
      handle: "@thetamedia",
    },
    {
      email: "iota-social@test.omnipost.local",
      name: "Iota Social",
      timezone: "Asia/Tokyo",
      locale: "en",
      isOnTrial: false,
      maxProjects: 3,
      providers: [Provider.FACEBOOK, Provider.INSTAGRAM],
      status: "ACTIVE" as const,
      price: 20,
      handle: "@iotasocial",
    },
    {
      email: "kappa-agency@test.omnipost.local",
      name: "Kappa Agency",
      timezone: "America/Toronto",
      locale: "en",
      isOnTrial: false,
      maxProjects: 7,
      providers: [
        Provider.X,
        Provider.INSTAGRAM,
        Provider.FACEBOOK,
        Provider.LINKEDIN,
        Provider.YOUTUBE,
      ],
      status: "GRANDFATHERED" as const,
      price: 40,
      grandfatheredFrom: 50,
      handle: "@kappaagency",
    },
  ];

  for (const acct of testAccounts) {
    const slug = acct.email.split("@")[0]!;

    const account = await prisma.account.upsert({
      where: { email: acct.email },
      update: { name: acct.name },
      create: {
        email: acct.email,
        name: acct.name,
        isOnTrial: acct.isOnTrial,
        ...(acct.trialEndDate && { trialEndDate: acct.trialEndDate }),
        timezone: acct.timezone,
        locale: acct.locale,
        maxProjects: acct.maxProjects,
        slug,
      },
    });

    const projectName = `${acct.name} Project`;
    const project = await prisma.project.upsert({
      where: { accountId_name: { accountId: account.id, name: projectName } },
      update: {},
      create: {
        accountId: account.id,
        name: projectName,
        locale: acct.locale,
      },
    });

    const channelsToCreate = acct.providers.slice(0, 2);
    for (let i = 0; i < channelsToCreate.length; i++) {
      const provider = channelsToCreate[i]!;
      const channelId = `test-ch-${slug}-${i}`;
      await prisma.channel.upsert({
        where: { id: channelId },
        update: {},
        create: {
          id: channelId,
          projectId: project.id,
          provider,
          handle: `${acct.handle}-${provider.toLowerCase()}`,
          credentials: { token: "TEST_TOKEN" },
        },
      });
    }

    const periodStart = acct.status === "TRIALING" ? daysAgo(7) : daysAgo(15);
    const periodEnd =
      acct.status === "TRIALING" ? (acct.trialEndDate ?? daysFromNow(7)) : daysFromNow(15);

    const subscription = await prisma.accountSubscription.upsert({
      where: { accountId: account.id },
      update: { status: acct.status, pricePerMonth: acct.price },
      create: {
        accountId: account.id,
        providers: acct.providers,
        status: acct.status,
        pricePerMonth: acct.price,
        maxProjects: acct.maxProjects,
        billingCycle: "MONTHLY",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        ...(acct.status === "TRIALING" && {
          trialEndsAt: acct.trialEndDate ?? daysFromNow(7),
        }),
        ...(acct.status === "CANCELED" && { cancelAtPeriodEnd: true }),
      },
    });

    if (acct.status === "GRANDFATHERED" && acct.grandfatheredFrom) {
      const historyId = `history-${slug}`;
      await prisma.subscriptionPriceHistory.upsert({
        where: { id: historyId },
        update: {},
        create: {
          id: historyId,
          subscriptionId: subscription.id,
          previousPrice: acct.grandfatheredFrom,
          newPrice: acct.price,
          reason: "Grandfathering: loyal customer discount",
          effectiveAt: daysAgo(30),
          notifiedAt: daysAgo(35),
        },
      });
    }
  }

  console.log(`Test accounts seeded: ${testAccounts.length}`);

  // ─── Compliance Settings (Sprint C) ───────────────────────────────────────
  await prisma.gdprSettings.upsert({
    where: { id: "gdpr-singleton" },
    update: {},
    create: {
      id: "gdpr-singleton",
      dpoType: "INTERNAL",
      dataRetentionDays: 365,
      auditLogRetentionDays: 90,
      dsarResponseDays: 30,
      defaultJurisdiction: "GDPR",
      enableRightToErasure: true,
      enableDataExport: true,
      enableDataAccess: true,
      enableBreachNotification: true,
    },
  });
  console.log("GdprSettings seeded");

  await prisma.securitySettings.upsert({
    where: { id: "security-singleton" },
    update: {},
    create: {
      id: "security-singleton",
      sessionTimeoutMinutes: 1440,
      maxLoginAttempts: 5,
      passwordMinLength: 8,
    },
  });
  console.log("SecuritySettings seeded");
}

main().finally(() => prisma.$disconnect());
