/**
 * @file webhooksAdminClient.ts
 * @description Admin client for webhook subscription rotation actions.
 * @layer infrastructure
 */

import { http } from "./http";

export interface RotateWebhookSecretInput {
  webhookSubscriptionId: string;
  graceWindowHours?: number;
}

export interface WebhookSecretRotationResult {
  webhookSubscriptionId: string;
  newSecretKey: string;
  previousSecretKeyExpiresAt: string;
  graceWindowHours: number;
}

export const webhooksAdminClient = {
  rotateSecret: ({ webhookSubscriptionId, graceWindowHours }: RotateWebhookSecretInput) =>
    http<{ rotation: WebhookSecretRotationResult }>(
      `/admin/webhooks/${encodeURIComponent(webhookSubscriptionId)}/rotate-secret`,
      {
        method: "POST",
        body: JSON.stringify(graceWindowHours !== undefined ? { graceWindowHours } : {}),
      }
    ),
};
