/**
 * @file ResolveRetractionAlertUseCase.ts
 * @description Takes down a standing retraction alert when it no longer stands — the
 *   content came down, the customer confirmed the removal, or the action window
 *   closed. It deletes exactly the notifications the LEDGER names rather than
 *   everything that looks like this alert: membership drifts between a raise and its
 *   resolution, and a query by recipient would either miss the alerts of a member who
 *   left or delete an unrelated one belonging to a member who joined.
 *
 *   Idempotent on purpose: an event delivered twice, or an alert already resolved,
 *   deletes nothing the second time and is not an error.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { NotificationRepository } from "@core/domain/repositories/NotificationRepository.js";
import type { RetractionAlertDeliveryLedger } from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import { ALERT_MEDIA } from "@core/domain/value-objects/AlertMedium.js";

/** Which alert to take down, and why it stopped standing. */
export interface ResolveRetractionAlertInput {
  alertKey: string;
  cause?: string;
}

/** How much was actually taken down, so the caller can log a real number. */
export interface ResolveRetractionAlertOutput {
  deletedNotifications: number;
}

/**
 * @class ResolveRetractionAlertUseCase
 * @description Deletes the in-app notifications a retraction alert created, then the
 *   ledger rows that named them.
 */
export class ResolveRetractionAlertUseCase implements UseCase<
  ResolveRetractionAlertInput,
  ResolveRetractionAlertOutput,
  UseCaseError
> {
  constructor(
    private readonly ledger: RetractionAlertDeliveryLedger,
    private readonly notifications: NotificationRepository
  ) {}

  /**
   * @method execute
   * @description Resolves one alert: every in-app notification the ledger recorded for
   *   it is deleted, then every ledger row of that alert.
   * @param input - The alert key and the cause it is being resolved for
   * @returns The number of notifications deleted, or an internal error
   */
  async execute(
    input: ResolveRetractionAlertInput
  ): Promise<Result<ResolveRetractionAlertOutput, UseCaseError>> {
    try {
      const rows = await this.ledger.listByAlertKey(input.alertKey, ALERT_MEDIA.IN_APP);

      let deletedNotifications = 0;
      for (const row of rows) {
        if (row.notificationId === undefined) continue;
        await this.notifications.delete(row.notificationId);
        deletedNotifications += 1;
      }

      // The ledger rows go LAST. If the process dies between the two, the surviving
      // rows make the redelivered resolution try the same deletes again — which is
      // harmless — whereas dropping the rows first would strand notifications nothing
      // names any more.
      await this.ledger.deleteByAlertKey(input.alertKey);

      return ok({ deletedNotifications });
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          `Failed to resolve retraction alert ${input.alertKey}`,
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
