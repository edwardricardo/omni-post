/**
 * @file rotationStatusRules.ts
 * @description Pure domain function that derives a rotation status (`OK` /
 *              `DUE_SOON` / `OVERDUE`) from a last-rotated timestamp and the
 *              category cadence. No I/O, no logger — caller controls `now`
 *              for testability.
 * @layer domain
 */

export const ROTATION_STATUS_VALUES = ["OK", "DUE_SOON", "OVERDUE"] as const;
export type RotationStatus = (typeof ROTATION_STATUS_VALUES)[number];

/**
 * Window before `nextRotationAt` during which a secret is flagged DUE_SOON.
 * 30 days matches the typical lead time for ops to schedule a rotation
 * window without surprise.
 */
export const DUE_SOON_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RotationStatusResult {
  readonly status: RotationStatus;
  readonly nextRotationAt: Date;
  readonly daysUntilDue: number;
}

/**
 * @function calculateStatus
 * @description Returns the rotation status for a secret given its last rotation
 *              timestamp and its category cadence.
 * @param rotatedAt - Timestamp of the last recorded rotation event.
 * @param cadenceDays - Cadence window in days (e.g. 90 for JWT, 365 for KEK).
 * @param now - Reference time. Caller-provided for deterministic tests.
 * @returns `RotationStatusResult` with status, computed next rotation time, and
 *          days until due (negative when overdue).
 */
export function calculateStatus(
  rotatedAt: Date,
  cadenceDays: number,
  now: Date
): RotationStatusResult {
  const nextRotationAt = new Date(rotatedAt.getTime() + cadenceDays * MS_PER_DAY);
  const daysUntilDue = Math.floor((nextRotationAt.getTime() - now.getTime()) / MS_PER_DAY);

  let status: RotationStatus;
  if (daysUntilDue < 0) {
    status = "OVERDUE";
  } else if (daysUntilDue <= DUE_SOON_WINDOW_DAYS) {
    status = "DUE_SOON";
  } else {
    status = "OK";
  }

  return { status, nextRotationAt, daysUntilDue };
}
