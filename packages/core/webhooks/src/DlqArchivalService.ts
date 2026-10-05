/**
 * @file DlqArchivalService.ts
 * @description Archives resolved DLQ events and flags stale unresolved events.
 *   Soft-archive only — never deletes records. Idempotent — running twice
 *   produces the same result.
 *
 *   Framework-free: depends only on `WebhookDeadLetterArchivalPort` + the
 *   `LoggerPort` its composition root injects.
 * @layer application
 */

import type { LoggerPort } from "@ports/core";
import type { WebhookDeadLetterArchivalPort } from "@core/domain/repositories/WebhookDeadLetterArchivalPort.js";

export class DlqArchivalService {
  constructor(
    private readonly archivalRepo: WebhookDeadLetterArchivalPort,
    private readonly logger: LoggerPort
  ) {}

  /**
   * @method archiveResolvedEvents
   * @description Soft-archives resolved WebhookDeadLetter events older than retentionDays.
   *   The count is returned, not logged: a routine sweep asks nothing of an operator.
   */
  async archiveResolvedEvents(retentionDays: number): Promise<{ archived: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const result = await this.archivalRepo.archiveResolvedBefore(cutoff);
    const archived = result.ok ? result.value : 0;

    return { archived };
  }

  /**
   * @method flagStaleEvents
   * @description Warns through the injected logger about unresolved events older than staleAfterDays.
   */
  async flagStaleEvents(staleAfterDays: number): Promise<{ stale: number; eventIds: string[] }> {
    const cutoff = new Date(Date.now() - staleAfterDays * 24 * 60 * 60 * 1000);

    const result = await this.archivalRepo.findStaleUnresolved(cutoff);
    const staleEvents = result.ok ? result.value : [];

    if (staleEvents.length > 0) {
      this.logger.warn(
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
