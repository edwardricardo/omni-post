/**
 * @file AccountNotificationReader.ts
 * @description Read-only port that lists the email addresses of every
 *   currently-active account. Used by `ComplianceService.sendBreachNotifications`
 *   to fan out a breach-notification email without coupling to Prisma.
 *
 *   Port-level error type is a string union (canon for @core/domain
 *   repository ports).
 * @layer domain
 */

import { type Result } from "@shared/types";

export type AccountNotificationReadError = "DATABASE_ERROR";

export interface AccountNotificationReader {
  /** Return the email address of every active account. */
  listActiveEmails(): Promise<Result<string[], AccountNotificationReadError>>;
}
