/**
 * @file NotificationMailer.ts
 * @description Role port for sending an email tied to an in-app notification.
 *              The use case supplies the notification context (after gating on
 *              user preferences); the infrastructure adapter maps the type to a
 *              template, builds links, renders, and sends.
 * @layer domain
 */

import type { Result } from "@shared/types";
import type { NotificationTypeValue } from "../value-objects/NotificationType.js";

/** Context describing the notification email to send. */
export interface EmailNotificationContext {
  recipientId: string;
  recipientEmail: string;
  type: NotificationTypeValue;
  title: string;
  body: string;
  accountName: string;
  metadata?: Record<string, unknown>;
}

/** Sends the email for an in-app notification. */
export interface NotificationMailer {
  sendNotification(ctx: EmailNotificationContext): Promise<Result<void, Error>>;
}
