/**
 * @file RetractionAlertDeliveryLedger.ts
 * @description Port for the record of which alert deliveries were already claimed.
 *   It is the SINGLE idempotency mechanism of the retraction alert: the consumer
 *   claims a row before it delivers, so a redelivered event collides instead of
 *   sending twice, and resolution deletes exactly the notifications the ledger names
 *   rather than guessing from today's membership.
 *
 *   `claim` returns a BOOLEAN rather than a Result because a collision is not a
 *   failure — it is the answer the caller asked for, and the only correct response to
 *   it (skip this target) is the same every time.
 * @layer domain
 */

import type { AlertMedium } from "../value-objects/AlertMedium.js";

/** The identity of one delivery attempt: an alert, a medium, and who it was for. */
export interface RetractionAlertDeliveryClaim {
  alertKey: string;
  medium: AlertMedium;
  target: string;
}

/** A claimed row, as resolution reads it back. */
export interface RetractionAlertDeliveryRow {
  target: string;
  notificationId?: string;
}

/**
 * @interface RetractionAlertDeliveryLedger
 * @description Persistence port for claimed alert deliveries.
 */
export interface RetractionAlertDeliveryLedger {
  /**
   * @method claim
   * @description Records the intent to deliver, atomically. Implementations INSERT on
   *   the unique (alertKey, medium, target) index and report a uniqueness violation as
   *   `claimed: false` — that is what makes a redelivered event silent instead of
   *   duplicated.
   * @param input - The alert, the medium and the target being claimed
   * @returns `{ claimed: true }` when this caller owns the delivery, `false` when an
   *   earlier one already did
   */
  claim(input: RetractionAlertDeliveryClaim): Promise<{ claimed: boolean }>;

  /**
   * @method attachNotification
   * @description Completes a claimed row with the notification it produced, so
   *   resolution can delete precisely that notification later. Safe to call twice.
   * @param input - The alert, the target, and the created notification's id
   */
  attachNotification(input: {
    alertKey: string;
    target: string;
    notificationId: string;
  }): Promise<void>;

  /**
   * @method listByAlertKey
   * @description Lists the rows claimed for one alert on one medium.
   * @param alertKey - The alert's deterministic identity
   * @param medium - The medium whose rows are wanted
   * @returns The claimed targets, each with the notification it produced when it made one
   */
  listByAlertKey(
    alertKey: string,
    medium: AlertMedium
  ): Promise<readonly RetractionAlertDeliveryRow[]>;

  /**
   * @method deleteByAlertKey
   * @description Removes every row of an alert. Idempotent: an alert already resolved
   *   deletes nothing and is not an error.
   * @param alertKey - The alert's deterministic identity
   */
  deleteByAlertKey(alertKey: string): Promise<void>;
}
