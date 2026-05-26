/**
 * @file WebhookSubscriptionRotationRepository.ts
 * @description Port for the webhook secret rotation feature. Inline interface
 *              (single consumer); promote to packages/ports/core/ if a second
 *              consumer appears.
 * @layer application
 */

export interface WebhookSubscriptionForRotation {
  id: string;
  secretKey: string;
}

export interface RotateWebhookSecretArgs {
  id: string;
  newSecretKey: string;
  previousSecretKey: string;
  previousSecretKeyExpiresAt: Date;
}

export interface WebhookSubscriptionRotationRepository {
  findById(id: string): Promise<WebhookSubscriptionForRotation | null>;
  rotateSecret(args: RotateWebhookSecretArgs): Promise<boolean>;
}
