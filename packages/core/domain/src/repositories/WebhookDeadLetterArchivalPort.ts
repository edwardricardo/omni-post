/**
 * @file WebhookDeadLetterArchivalPort.ts
 * @description Port over the retention/archival operations on the
 *   `WebhookDeadLetter` table. Used by `DlqArchivalService` to soft-archive
 *   resolved events past their retention window and to surface unresolved
 *   events that have aged past the stale threshold.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type WebhookDeadLetterArchivalError = "DATABASE_ERROR";

export interface StaleDeadLetterSummary {
  id: string;
  provider: string;
  eventType: string;
  firstFailedAt: Date;
}

export interface WebhookDeadLetterArchivalPort {
  /**
   * Soft-archive every resolved row whose `resolvedAt < cutoff` and that
   * has not yet been archived. Returns the number of rows touched.
   */
  archiveResolvedBefore(cutoff: Date): Promise<Result<number, WebhookDeadLetterArchivalError>>;

  /**
   * Return unresolved rows whose `firstFailedAt < cutoff` (i.e. those that
   * have been stuck longer than the stale threshold). Excludes already-
   * archived rows so the same record isn't surfaced twice.
   */
  findStaleUnresolved(
    cutoff: Date
  ): Promise<Result<StaleDeadLetterSummary[], WebhookDeadLetterArchivalError>>;
}
