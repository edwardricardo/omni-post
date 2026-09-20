/**
 * @file PrismaRetractionAlertDeliveryLedger.ts
 * @description Persists which retraction-alert deliveries were already claimed.
 *
 *   The whole idempotency of the alert rests on one line of this file: `claim` INSERTs
 *   and reads a unique-constraint violation as "an earlier delivery already owns this
 *   target". The database decides, not a read-then-write in the consumer — two
 *   deliveries of the same event racing each other would both pass a read and both
 *   send, which is exactly the duplicate this ledger exists to prevent.
 *
 *   Any OTHER database failure is rethrown deliberately. Reporting `claimed: true` for
 *   a write that never landed would send the alert and record nothing, so a redelivery
 *   would send it again; reporting `claimed: false` would drop the alert silently.
 *
 *   The table carries no `accountId`: it holds an opaque alert hash, member ids and
 *   config ids, and every read is keyed by an alertKey only a tenant-bound event can
 *   produce. It is not enrolled in the tenant guard, exactly as `Notification` and
 *   `NotificationPreference` are not.
 * @layer infrastructure
 */

import type { PrismaClient, RetractionAlertMedium } from "@infra/prisma";
import type {
  RetractionAlertDeliveryClaim,
  RetractionAlertDeliveryLedger,
  RetractionAlertDeliveryRow,
} from "@core/domain/repositories/RetractionAlertDeliveryLedger.js";
import { ALERT_MEDIA, type AlertMedium } from "@core/domain/value-objects/AlertMedium.js";

/**
 * The stored spelling of each medium, CHECKED against the generated enum rather than
 * merely resembling it. The annotation closes both drifts at compile time: a domain
 * medium with no mapping leaves `Record<AlertMedium, …>` missing a key, and a label the
 * database does not hold is not a member of `RetractionAlertMedium`. Untyped, either
 * one compiled cleanly and failed at the INSERT the whole idempotency rests on.
 *
 * The enum is imported as a TYPE, not a value: the generated client's runtime is not
 * loaded by the unit tier, and importing it for a string would make this adapter
 * unloadable there while proving nothing the type does not already prove.
 */
const STORED_MEDIUM: Record<AlertMedium, RetractionAlertMedium> = {
  [ALERT_MEDIA.IN_APP]: "IN_APP",
  [ALERT_MEDIA.EMAIL]: "EMAIL",
  [ALERT_MEDIA.SLACK_TEAMS]: "SLACK_TEAMS",
  [ALERT_MEDIA.SMS]: "SMS",
  [ALERT_MEDIA.PUSH]: "PUSH",
};

const toStored = (medium: AlertMedium): RetractionAlertMedium => STORED_MEDIUM[medium];

/**
 * @function isUniqueViolation
 * @description True when the write lost the race on the `(alertKey, medium, target)`
 *   unique index. Narrowed by code alone: this table has exactly one unique index, so
 *   there is no second constraint a P2002 here could mean.
 * @param error - The thrown value
 * @returns Whether this is the duplicate-claim case
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

export class PrismaRetractionAlertDeliveryLedger implements RetractionAlertDeliveryLedger {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method claim
   * @description Claims one (alert, medium, target) by INSERT.
   * @param input - The alert, the medium and the target being claimed
   * @returns `{ claimed: false }` when an earlier delivery already owned it
   */
  async claim(input: RetractionAlertDeliveryClaim): Promise<{ claimed: boolean }> {
    try {
      await this.prisma.retractionAlertDelivery.create({
        data: {
          alertKey: input.alertKey,
          medium: toStored(input.medium),
          target: input.target,
        },
      });
      return { claimed: true };
    } catch (error: unknown) {
      if (isUniqueViolation(error)) return { claimed: false };
      throw error;
    }
  }

  /**
   * @method release
   * @description Deletes the ONE claimed row, so a redelivery may retry that target.
   *   `deleteMany` on the natural key rather than `delete` on the id: a row already
   *   gone is the same outcome, not an error worth raising during a failure path.
   * @param input - The alert, the medium and the target whose claim is returned
   */
  async release(input: RetractionAlertDeliveryClaim): Promise<void> {
    await this.prisma.retractionAlertDelivery.deleteMany({
      where: {
        alertKey: input.alertKey,
        medium: toStored(input.medium),
        target: input.target,
      },
    });
  }

  /**
   * @method attachNotification
   * @description Records the in-app notification a claimed row produced, so resolution
   *   can delete exactly it. `updateMany` rather than `update` because the row is
   *   addressed by its natural key and a row already gone is not an error.
   * @param input - The alert, the target and the notification id
   */
  async attachNotification(input: {
    alertKey: string;
    target: string;
    notificationId: string;
  }): Promise<void> {
    await this.prisma.retractionAlertDelivery.updateMany({
      where: {
        alertKey: input.alertKey,
        medium: toStored(ALERT_MEDIA.IN_APP),
        target: input.target,
      },
      data: { notificationId: input.notificationId },
    });
  }

  /**
   * @method listByAlertKey
   * @description Lists the claimed rows of one alert on one medium.
   * @param alertKey - The alert's deterministic identity
   * @param medium - The medium whose rows are wanted
   * @returns The claimed targets, each with the notification it produced when it made one
   */
  async listByAlertKey(
    alertKey: string,
    medium: AlertMedium
  ): Promise<readonly RetractionAlertDeliveryRow[]> {
    const rows = await this.prisma.retractionAlertDelivery.findMany({
      where: { alertKey, medium: toStored(medium) },
      select: { target: true, notificationId: true },
    });

    return rows.map((row) => ({
      target: row.target,
      ...(row.notificationId !== null && { notificationId: row.notificationId }),
    }));
  }

  /**
   * @method deleteByAlertKey
   * @description Removes every row of an alert. Idempotent by construction.
   * @param alertKey - The alert's deterministic identity
   */
  async deleteByAlertKey(alertKey: string): Promise<void> {
    await this.prisma.retractionAlertDelivery.deleteMany({ where: { alertKey } });
  }
}
