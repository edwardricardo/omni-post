import { createHmac } from "crypto";
import { prisma } from "@infra/prisma";

export function createSignature(
  payload: string,
  secret: string,
  format: "sha256" | "hex" = "sha256"
): string {
  const hmac = createHmac("sha256", secret).update(payload, "utf8");
  const signature = format === "sha256" ? hmac.digest("hex") : hmac.digest("hex");
  return `sha256=${signature}`;
}

export async function cleanupTestData(): Promise<void> {
  try {
    await prisma.webhookDeadLetter.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    await prisma.webhookSubscription.deleteMany({});
    await prisma.instagramAnalytics.deleteMany({});
    await prisma.analytics.deleteMany({});
    await prisma.publishLog.deleteMany({});
    await prisma.channel.deleteMany({});
    await prisma.postContent.deleteMany({});
    await prisma.postMedia.deleteMany({});
    await prisma.post.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.account.deleteMany({});
  } catch (error) {
    console.warn("Cleanup warning:", error);
  }
}

export async function createTestSubscription(
  provider: "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK"
) {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);

  const account = await prisma.account.create({
    data: {
      email: `test-${provider.toLowerCase()}-${timestamp}-${randomId}@example.com`,
      name: `Test Account ${provider} ${timestamp}`,
      subscription: "PRO",
    },
  });

  const project = await prisma.project.create({
    data: {
      accountId: account.id,
      name: `Test Project ${provider} ${timestamp}`,
      locale: "en",
    },
  });

  const subscription = await prisma.webhookSubscription.create({
    data: {
      accountId: account.id,
      provider,
      webhookUrl: `https://example.com/webhooks/${provider.toLowerCase()}`,
      secretKey: "test-secret-key",
      isActive: true,
      eventsReceived: 0,
      eventsProcessed: 0,
    },
  });

  return { account, project, subscription };
}
