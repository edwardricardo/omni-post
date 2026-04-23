/**
 * @file webhookHandler.test-helpers.ts
 * @description Shared helpers for webhookHandler unit tests.
 *              Provides signature creation and mock data factories
 *              that work with the in-memory mock prisma stores.
 * @layer infrastructure
 */

import { createHmac, randomUUID } from "crypto";

export function createSignature(
  payload: string,
  secret: string,
  format: "sha256" | "hex" = "sha256"
): string {
  const hmac = createHmac("sha256", secret).update(payload, "utf8");
  const signature = format === "sha256" ? hmac.digest("hex") : hmac.digest("hex");
  return `sha256=${signature}`;
}

/**
 * Creates a test webhook subscription in the mock prisma stores.
 * Returns account, project, and subscription objects with generated IDs.
 */
export function createTestSubscriptionData(
  provider: "X" | "INSTAGRAM" | "FACEBOOK" | "YOUTUBE" | "TIKTOK"
) {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);

  const account = {
    id: randomUUID(),
    email: `test-${provider.toLowerCase()}-${timestamp}-${randomId}@example.com`,
    name: `Test Account ${provider} ${timestamp}`,
    subscription: "PRO",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const project = {
    id: randomUUID(),
    accountId: account.id,
    name: `Test Project ${provider} ${timestamp}`,
    locale: "en",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const subscription = {
    id: randomUUID(),
    accountId: account.id,
    provider,
    webhookUrl: `https://example.com/webhooks/${provider.toLowerCase()}`,
    secretKey: "test-secret-key",
    isActive: true,
    eventsReceived: 0,
    eventsProcessed: 0,
    lastEventAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return { account, project, subscription };
}
