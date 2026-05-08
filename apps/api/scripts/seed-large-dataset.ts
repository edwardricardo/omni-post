/**
 * @file seed-large-dataset.ts
 * @description Seed script generating a large dataset (500+ accounts with varying subscription tiers)
 *              for performance and load testing scenarios.
 * @layer infrastructure
 */
import { prisma } from "@infra/prisma";
import { faker } from "@faker-js/faker";

// Configuration
const TOTAL_ACCOUNTS = 500;
const SUBSCRIPTION_DISTRIBUTION = {
  BASIC: 0.6, // 60% Basic
  PRO: 0.3, // 30% Pro
  ENTERPRISE: 0.1, // 10% Enterprise
};
const TRIAL_PERCENTAGE = 0.15; // 15% on trial
const _SUSPENDED_PERCENTAGE = 0.05; // 5% suspended accounts

// Helper functions
function getRandomSubscription(): "BASIC" | "PRO" | "ENTERPRISE" {
  const rand = Math.random();
  if (rand < SUBSCRIPTION_DISTRIBUTION.BASIC) return "BASIC";
  if (rand < SUBSCRIPTION_DISTRIBUTION.BASIC + SUBSCRIPTION_DISTRIBUTION.PRO) return "PRO";
  return "ENTERPRISE";
}

function getMaxProjects(subscription: string): number {
  switch (subscription) {
    case "BASIC":
      return 1;
    case "PRO":
      return 5;
    case "ENTERPRISE":
      return 50;
    default:
      return 1;
  }
}

function getRandomBillingCycle(): "monthly" | "yearly" {
  return Math.random() < 0.7 ? "monthly" : "yearly"; // 70% monthly, 30% yearly
}

function generateTrialDates(daysFromNow: number) {
  const now = new Date();
  const trialStart = new Date(now.getTime() - (7 - daysFromNow) * 24 * 60 * 60 * 1000);
  const trialEnd = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  return { trialStart, trialEnd };
}

function generateRandomDateInPast(daysAgo: number): Date {
  const now = new Date();
  const randomDays = Math.floor(Math.random() * daysAgo);
  return new Date(now.getTime() - randomDays * 24 * 60 * 60 * 1000);
}

async function clearExistingData() {
  console.log("🧹 Clearing existing data...");

  // Delete in correct order due to foreign key constraints
  await prisma.tweet.deleteMany();
  await prisma.thread.deleteMany();
  await prisma.analytics.deleteMany();
  await prisma.publishLog.deleteMany();
  await prisma.postMedia.deleteMany();
  await prisma.postContent.deleteMany();
  await prisma.post.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.project.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.adminSession.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.account.deleteMany();

  console.log("✅ Existing data cleared");
}

async function main() {
  console.log("🌱 Starting large dataset seeding...");
  console.log(`📊 Will create ${TOTAL_ACCOUNTS} accounts with projects`);

  // Clear existing data if needed
  await clearExistingData();

  const accounts = [];
  const projects = [];
  let totalProjects = 0;

  // Generate accounts with realistic distribution
  for (let i = 0; i < TOTAL_ACCOUNTS; i++) {
    const subscription = getRandomSubscription();
    const maxProjects = getMaxProjects(subscription);
    const isOnTrial = Math.random() < TRIAL_PERCENTAGE;
    const billingCycle = getRandomBillingCycle();

    // Generate realistic dates
    const createdAt = generateRandomDateInPast(365); // Up to 1 year ago

    // Trial dates
    let trialStartDate = createdAt; // Trial starts when account is created
    let trialEndDate = null;
    let trialDaysRemaining = 0;

    if (isOnTrial) {
      trialDaysRemaining = Math.floor(Math.random() * 7) + 1; // 1-7 days remaining
      const dates = generateTrialDates(trialDaysRemaining);
      trialStartDate = dates.trialStart;
      trialEndDate = dates.trialEnd;
    } else if (Math.random() < 0.1) {
      // 10% had trials that expired
      const daysAgo = Math.floor(Math.random() * 30) + 1;
      trialStartDate = new Date(Date.now() - (daysAgo + 7) * 24 * 60 * 60 * 1000);
      trialEndDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    } else {
      // Not on trial - set trial end date to 7 days after start
      trialEndDate = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Billing dates for non-trial accounts
    let nextBillingDate = null;
    let lastBillingDate = null;

    if (!isOnTrial) {
      const daysInCycle = billingCycle === "monthly" ? 30 : 365;
      const daysSinceLastBilling = Math.floor(Math.random() * daysInCycle);
      lastBillingDate = new Date(Date.now() - daysSinceLastBilling * 24 * 60 * 60 * 1000);
      nextBillingDate = new Date(lastBillingDate.getTime() + daysInCycle * 24 * 60 * 60 * 1000);
    }

    const accountData = {
      email: faker.internet.email().toLowerCase(),
      name: faker.person.fullName(),
      subscription,
      maxProjects,
      isOnTrial,
      trialStartDate,
      trialEndDate,
      autoRenewal: Math.random() < 0.85, // 85% have auto-renewal
      billingCycle,
      nextBillingDate,
      lastBillingDate,
      createdAt,
    };

    accounts.push(accountData);

    // Generate projects for each account (random within limits)
    const projectCount = Math.min(Math.floor(Math.random() * maxProjects) + 1, maxProjects);

    for (let j = 0; j < projectCount; j++) {
      projects.push({
        name: faker.helpers.arrayElement([
          `${faker.company.name()} Social`,
          `${faker.commerce.department()} Campaign`,
          `${faker.company.buzzPhrase()}`,
          `Project ${faker.color.human()}`,
          `${faker.company.name()} ${new Date().getFullYear()}`,
        ]),
        locale: faker.helpers.arrayElement(["en", "es", "fr", "de", "pt", "it"]),
        accountIndex: i, // Track which account this belongs to
      });
      totalProjects++;
    }
  }

  console.log(`📝 Generated data for ${accounts.length} accounts and ${totalProjects} projects`);

  // Batch insert accounts
  console.log("💾 Inserting accounts...");
  const createdAccounts = [];

  for (let i = 0; i < accounts.length; i++) {
    try {
      const account = await prisma.account.create({
        data: accounts[i],
      });
      createdAccounts.push(account);

      // Progress indicator
      if ((i + 1) % 50 === 0) {
        console.log(`   Inserted ${i + 1}/${accounts.length} accounts...`);
      }
    } catch {
      console.error(`Failed to create account ${accounts[i].email}:`, error);
    }
  }

  console.log(`✅ Created ${createdAccounts.length} accounts`);

  // Insert projects
  console.log("💾 Inserting projects...");
  let createdProjects = 0;

  for (const project of projects) {
    const account = createdAccounts[project.accountIndex];
    if (account) {
      try {
        await prisma.project.create({
          data: {
            name: project.name,
            locale: project.locale,
            accountId: account.id,
          },
        });
        createdProjects++;

        // Progress indicator
        if (createdProjects % 100 === 0) {
          console.log(`   Inserted ${createdProjects}/${projects.length} projects...`);
        }
      } catch {
        console.error(`Failed to create project for account ${account.email}:`, error);
      }
    }
  }

  console.log(`✅ Created ${createdProjects} projects`);

  // Final statistics
  const stats = await prisma.account.groupBy({
    by: ["subscription"],
    _count: { id: true },
  });

  const trialStats = await prisma.account.count({
    where: { isOnTrial: true },
  });

  const expiredTrials = await prisma.account.count({
    where: {
      isOnTrial: false,
      trialEndDate: { lte: new Date() },
    },
  });

  console.log("\n📊 Final Statistics:");
  console.log("═══════════════════════════════════════");
  console.log(`Total Accounts: ${createdAccounts.length}`);
  console.log(`Total Projects: ${createdProjects}`);
  console.log(`Total Audit Logs: ${auditCount}`);
  console.log("\nSubscription Distribution:");
  stats.forEach((stat) => {
    const percentage = ((stat._count.id / createdAccounts.length) * 100).toFixed(1);
    console.log(`  ${stat.subscription}: ${stat._count.id} (${percentage}%)`);
  });
  console.log(`\nTrials Active: ${trialStats}`);
  console.log(`Expired Trials: ${expiredTrials}`);
  console.log("\n🎉 Large dataset seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
