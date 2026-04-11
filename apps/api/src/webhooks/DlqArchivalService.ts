/**
 * @file DlqArchivalService.ts
 * @description Archives resolved DLQ events and flags stale unresolved events.
 *   Soft-archive only — never deletes records.
 *   Idempotent — running twice produces the same result.
 * @layer application
 */

import type { PrismaClient } from "@infra/prisma";
import { logger } from "../lib/logger.js";

export class DlqArchivalService {
  constructor(private readonly prisma: PrismaClient) {}
  /**
   * @method archiveResolvedEvents
   * @description Soft-archives resolved WebhookDeadLetter events older than retentionDays.
   */
  async archiveResolvedEvents(retentionDays: number): Promise<{ archived: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.webhookDeadLetter.updateMany({
      where: {
        resolvedAt: { not: null, lt: cutoff },
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });

    if (result.count > 0) {
      logger.info(
        { archived: result.count, retentionDays },
        "DLQ archival: resolved events archived"
      );
    }

    return { archived: result.count };
  }

  /**
   * @method flagStaleEvents
   * @description Logs warnings for unresolved events older than staleAfterDays.
   */
  async flagStaleEvents(staleAfterDays: number): Promise<{ stale: number; eventIds: string[] }> {
    const cutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    const staleEvents = await this.prisma.webhookDeadLetter.findMany({
      where: {
        resolvedAt: null,
        archivedAt: null,
        firstFailedAt: { lt: cutoff },
      },
      select: { id: true, provider: true, eventType: true, firstFailedAt: true },
    });

    if (staleEvents.length > 0) {
      logger.warn(
        {
          stale: staleEvents.length,
          eventIds: staleEvents.map((e) => e.id),
          staleAfterDays,
        },
        "DLQ archival: stale unresolved events detected"
      );
    }

    return {
      stale: staleEvents.length,
      eventIds: staleEvents.map((e) => e.id),
    };
  }
}
