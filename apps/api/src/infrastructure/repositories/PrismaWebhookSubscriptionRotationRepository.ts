/**
 * @file PrismaWebhookSubscriptionRotationRepository.ts
 * @description Prisma adapter for the webhook secret rotation port. Reads the
 *              current secretKey for fingerprinting + writes the new triple
 *              (secretKey, previousSecretKey, previousSecretKeyExpiresAt) in
 *              a single update.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  RotateWebhookSecretArgs,
  WebhookSubscriptionForRotation,
  WebhookSubscriptionRotationRepository,
} from "@core/webhooks/WebhookSubscriptionRotationRepository.js";

export class PrismaWebhookSubscriptionRotationRepository implements WebhookSubscriptionRotationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<WebhookSubscriptionForRotation | null> {
    const row = await this.prisma.webhookSubscription.findUnique({
      where: { id },
      select: { id: true, secretKey: true },
    });
    return row;
  }

  async rotateSecret(args: RotateWebhookSecretArgs): Promise<boolean> {
    try {
      await this.prisma.webhookSubscription.update({
        where: { id: args.id },
        data: {
          secretKey: args.newSecretKey,
          previousSecretKey: args.previousSecretKey,
          previousSecretKeyExpiresAt: args.previousSecretKeyExpiresAt,
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}
