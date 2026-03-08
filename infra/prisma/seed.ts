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

  console.log("Seed OK", { account, project });
}

main().finally(() => prisma.$disconnect());
