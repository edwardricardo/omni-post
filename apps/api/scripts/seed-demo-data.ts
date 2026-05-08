/**
 * @file seed-demo-data.ts
 * @description Development seed script that populates the database with demo accounts, projects,
 *              channels, posts, and analytics using Faker for local testing.
 * @layer infrastructure
 */
import { createTestPrismaClient } from "@infra/prisma";
import { faker } from "@faker-js/faker";

const prisma = createTestPrismaClient();

async function main() {
  console.log("🌱 Seeding demo data...");

  // Generate demo accounts with faker
  faker.seed(
    new Date()
      .toDateString()
      .split("")
      .reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0)
  );

  const subscriptionTiers = ["BASIC", "PRO", "ENTERPRISE"] as const;
  const billingCycles = ["monthly", "yearly"] as const;

  const demoAccounts = Array.from({ length: 6 }, (_, _index) => {
    const subscription = faker.helpers.arrayElement(subscriptionTiers);
    const maxProjects = subscription === "BASIC" ? 1 : subscription === "PRO" ? 5 : 50;
    const isOnTrial = faker.datatype.boolean({ probability: 0.3 }); // 30% chance of being on trial
    const billingCycle = faker.helpers.arrayElement(billingCycles);

    let trialData = {};
    if (isOnTrial) {
      const trialStartDays = faker.number.int({ min: 1, max: 10 });
      const trialDuration = faker.number.int({ min: 7, max: 14 });
      const trialStartDate = new Date(Date.now() - trialStartDays * 24 * 60 * 60 * 1000);
      const trialEndDate = new Date(trialStartDate.getTime() + trialDuration * 24 * 60 * 60 * 1000);

      trialData = {
        trialStartDate,
        trialEndDate,
      };
    }

    return {
      email: faker.internet.email().toLowerCase(),
      name: faker.person.fullName(),
      subscription,
      maxProjects,
      isOnTrial,
      autoRenewal: faker.datatype.boolean({ probability: 0.7 }), // 70% have auto-renewal
      billingCycle,
      ...trialData,
    };
  });

  for (const accountData of demoAccounts) {
    try {
      const account = await prisma.account.create({
        data: accountData,
      });

      // Create realistic projects for each account (within their limits)
      const projectCount = Math.min(
        faker.number.int({ min: 1, max: Math.max(1, Math.floor(accountData.maxProjects * 0.8)) }),
        accountData.maxProjects
      );

      for (let i = 0; i < projectCount; i++) {
        await prisma.project.create({
          data: {
            name: faker.company.buzzPhrase() || `Project ${i + 1}`,
            locale: faker.helpers.arrayElement(["en", "es", "fr", "de", "it"]),
            accountId: account.id,
          },
        });
      }

      console.log(`✅ Created account: ${accountData.email} with ${projectCount} projects`);
    } catch {
      if (error instanceof Error && error.message.includes("Unique constraint")) {
        console.log(`⚠️ Account ${accountData.email} already exists, skipping...`);
      } else {
        console.error(`❌ Failed to create account ${accountData.email}:`, error);
      }
    }
  }

  // Generate expired trial accounts with faker
  const expiredTrialAccounts = Array.from({ length: 3 }, () => {
    const subscription = faker.helpers.arrayElement(subscriptionTiers);
    const maxProjects = subscription === "BASIC" ? 1 : subscription === "PRO" ? 5 : 50;
    const trialStartDays = faker.number.int({ min: 10, max: 30 }); // Started 10-30 days ago
    const expiredDays = faker.number.int({ min: 1, max: 10 }); // Expired 1-10 days ago

    const trialStartDate = new Date(Date.now() - trialStartDays * 24 * 60 * 60 * 1000);
    const trialEndDate = new Date(Date.now() - expiredDays * 24 * 60 * 60 * 1000);

    return {
      email: `expired-trial-${faker.string.alphanumeric(6).toLowerCase()}@${faker.internet.domainName()}`,
      name: `${faker.person.fullName()} (Expired Trial)`,
      subscription,
      maxProjects,
      isOnTrial: true,
      trialStartDate,
      trialEndDate,
      autoRenewal: faker.datatype.boolean({ probability: 0.3 }), // 30% have auto-renewal
      billingCycle: faker.helpers.arrayElement(billingCycles),
    };
  });

  for (const accountData of expiredTrialAccounts) {
    try {
      await prisma.account.create({
        data: accountData,
      });
      console.log(`✅ Created expired trial account: ${accountData.email}`);
    } catch {
      if (error instanceof Error && error.message.includes("Unique constraint")) {
        console.log(`⚠️ Account ${accountData.email} already exists, skipping...`);
      } else {
        console.error(`❌ Failed to create account ${accountData.email}:`, error);
      }
    }
  }

  const accountCount = await prisma.account.count();
  const projectCount = await prisma.project.count();
  const trialsActive = await prisma.account.count({
    where: {
      isOnTrial: true,
      trialEndDate: { gte: new Date() },
    },
  });

  console.log(`\n📊 Demo data summary:`);
  console.log(`   • Total accounts: ${accountCount}`);
  console.log(`   • Total projects: ${projectCount}`);
  console.log(`   • Active trials: ${trialsActive}`);
  console.log(`\n🎉 Demo data seeding completed!`);
}

main()
  .catch((e) => {
    console.error("❌ Demo data seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
