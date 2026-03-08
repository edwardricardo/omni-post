import { prisma } from "@infra/prisma";
import { WebhookManager } from "../../src/webhooks/webhookManager.js";
import Redis from "ioredis";

export interface WebhookManagerTestState {
  testAccountId: string;
  testAccount2Id: string;
  testProjectId: string;
  testProject2Id: string;
  webhookManager: WebhookManager;
  redis: Redis;
}

export const state: WebhookManagerTestState = {
  testAccountId: "",
  testAccount2Id: "",
  testProjectId: "",
  testProject2Id: "",
  webhookManager: null as unknown as WebhookManager,
  redis: null as unknown as Redis,
};

export async function setupWebhookManagerTestData(): Promise<void> {
  state.redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: null,
  });

  state.webhookManager = new WebhookManager(state.redis);

  await prisma.webhookSubscription.deleteMany({
    where: {
      OR: [{ webhookUrl: { contains: "test-webhook" } }, { accountId: { startsWith: "test-" } }],
    },
  });

  await prisma.webhookEvent.deleteMany({
    where: {
      OR: [{ eventId: { startsWith: "test-event-" } }, { accountId: { startsWith: "test-" } }],
    },
  });

  await prisma.webhookDeadLetter.deleteMany({
    where: {
      originalEventId: { startsWith: "test-event-" },
    },
  });

  await prisma.project.deleteMany({
    where: {
      name: { in: ["Test Webhook Project", "Test Webhook Project 2"] },
    },
  });

  await prisma.account.deleteMany({
    where: {
      email: { in: ["webhook-test@example.com", "webhook-test2@example.com"] },
    },
  });

  const account1 = await prisma.account.create({
    data: {
      email: "webhook-test@example.com",
      name: "Webhook Test Account",
      subscription: "PRO",
    },
  });
  state.testAccountId = account1.id;

  const account2 = await prisma.account.create({
    data: {
      email: "webhook-test2@example.com",
      name: "Webhook Test Account 2",
      subscription: "PRO",
    },
  });
  state.testAccount2Id = account2.id;

  const project1 = await prisma.project.create({
    data: {
      accountId: state.testAccountId,
      name: "Test Webhook Project",
      locale: "en",
    },
  });
  state.testProjectId = project1.id;

  const project2 = await prisma.project.create({
    data: {
      accountId: state.testAccount2Id,
      name: "Test Webhook Project 2",
      locale: "en",
    },
  });
  state.testProject2Id = project2.id;
}

export async function teardownWebhookManagerTestData(): Promise<void> {
  try {
    await prisma.webhookSubscription.deleteMany({
      where: {
        OR: [
          { accountId: state.testAccountId },
          { accountId: state.testAccount2Id },
          { webhookUrl: { contains: "test-webhook" } },
        ],
      },
    });

    await prisma.webhookEvent.deleteMany({
      where: {
        OR: [
          { accountId: state.testAccountId },
          { accountId: state.testAccount2Id },
          { eventId: { startsWith: "test-event-" } },
        ],
      },
    });

    await prisma.webhookDeadLetter.deleteMany({
      where: {
        originalEventId: { startsWith: "test-event-" },
      },
    });

    await prisma.project.deleteMany({
      where: { id: { in: [state.testProjectId, state.testProject2Id] } },
    });

    await prisma.account.deleteMany({
      where: { id: { in: [state.testAccountId, state.testAccount2Id] } },
    });

    await state.webhookManager.shutdown();

    await state.redis.quit();
  } catch (error) {
    console.error("Cleanup error:", error);
  }

  try {
    await prisma.$disconnect();
  } catch (err) {
    console.warn("Prisma disconnect warning:", err);
  }
}
