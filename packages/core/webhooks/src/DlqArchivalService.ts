/**
 * @file DlqArchivalService.ts
 * @description Archives resolved DLQ events and flags stale unresolved events.
 *   Soft-archive only — never deletes records. Idempotent — running twice
 *   produces the same result.
 *
 *   Framework-free: depends only on `WebhookDeadLetterArchivalPort` +
 *   @observability/logger.
 * @layer application
 */

import { createLogger } from "@observability/logger";
import type { WebhookDeadLetterArchivalPort } from "@core/domain/repositories/WebhookDeadLetterArchivalPort.js";

const logger = createLogger("dlq-archival");

export class DlqArchivalService {
  constructor(private readonly archivalRepo: WebhookDeadLetterArchivalPort) {}

  /**
   * @method archiveResolvedEvents
   * @description Soft-archives resolved WebhookDeadLetter events older than retentionDays.
   */
  async archiveResolvedEvents(retentionDays: number): Promise<{ archived: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.archivalRepo.archiveResolvedBefore(cutoff);
    const archived = result.ok ? result.value : 0;

    if (archived > 0) {
      logger.info({ archived, retentionDays }, "DLQ archival: resolved events archived");
    }

    return { archived };
  }

  /**
   * @method flagStaleEvents
   * @description Logs warnings for unresolved events older than staleAfterDays.
   */
  async flagStaleEvents(staleAfterDays: number): Promise<{ stale: number; eventIds: string[] }> {
    const cutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    const result = await this.archivalRepo.findStaleUnresolved(cutoff);
    const staleEvents = result.ok ? result.value : [];

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
