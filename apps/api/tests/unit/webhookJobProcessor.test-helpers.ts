import type { WebhookJobData } from "../../src/webhooks/webhookJobProcessor.js";
import type { Provider, WebhookEventType } from "@infra/prisma";

export function createTestJobData(overrides: Partial<WebhookJobData> = {}): WebhookJobData {
  return {
    eventId: "event-123",
    provider: "X" as Provider,
    eventType: "POST_PUBLISHED" as WebhookEventType,
    payload: { test: "data" },
    headers: { "x-signature": "test-sig" },
    signature: "test-signature",
    retryCount: 0,
    originalReceivedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function calculateJobPriority(jobData: WebhookJobData): number {
  if (
    jobData.eventType === "LIKE_RECEIVED" ||
    jobData.eventType === "COMMENT_RECEIVED" ||
    jobData.eventType === "SHARE_RECEIVED"
  ) {
    return 10;
  }

  if (jobData.eventType === "POST_PUBLISHED" || jobData.eventType === "POST_UPDATED") {
    return 5;
  }

  return 1;
}

export function calculateInitialDelay(jobData: WebhookJobData): number {
  if (jobData.retryCount === 0) {
    return 0;
  }

  return Math.min(300000, 5000 * Math.pow(2, jobData.retryCount - 1));
}

export function generateJobId(jobData: WebhookJobData): string {
  return `webhook-${jobData.provider}-${jobData.eventId}`;
}
