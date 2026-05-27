/**
 * @file PrismaWebhookDeadLetterArchivalRepository.ts
 * @description Prisma adapter implementing `WebhookDeadLetterArchivalPort`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  StaleDeadLetterSummary,
  WebhookDeadLetterArchivalError,
  WebhookDeadLetterArchivalPort,
} from "@core/domain/repositories/WebhookDeadLetterArchivalPort.js";

export class PrismaWebhookDeadLetterArchivalRepository implements WebhookDeadLetterArchivalPort {
  constructor(private readonly prisma: PrismaClient) {}

  async archiveResolvedBefore(
    cutoff: Date
  ): Promise<Result<number, WebhookDeadLetterArchivalError>> {
    try {
      const result = await this.prisma.webhookDeadLetter.updateMany({
        where: {
          resolvedAt: { not: null, lt: cutoff },
          archivedAt: null,
        },
        data: { archivedAt: new Date() },
      });
      return ok(result.count);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findStaleUnresolved(
    cutoff: Date
  ): Promise<Result<StaleDeadLetterSummary[], WebhookDeadLetterArchivalError>> {
    try {
      const rows = await this.prisma.webhookDeadLetter.findMany({
        where: {
          resolvedAt: null,
          archivedAt: null,
          firstFailedAt: { lt: cutoff },
        },
        select: { id: true, provider: true, eventType: true, firstFailedAt: true },
      });
      return ok(rows);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
