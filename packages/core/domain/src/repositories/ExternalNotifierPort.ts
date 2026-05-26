/**
 * @file ExternalNotifierPort.ts
 * @description Domain port for sending notifications to external channels
 *   (Slack, Microsoft Teams). Infrastructure adapters implement this interface
 *   to deliver webhook payloads.
 * @layer domain
 */

import { type Result } from "@shared/types";
import { type DomainError } from "../errors/index.js";
import { type NotificationChannel } from "./ExternalNotificationConfigRepository.js";

/**
 * Payload for an external notification message
 */
export interface NotificationPayload {
  title: string;
  message: string;
  event: string;
  projectId: string;
  metadata?: Record<string, string>;
}

/**
 * @interface ExternalNotifierPort
 * @description Port for delivering notifications to external webhook endpoints.
 *   Implementations handle channel-specific payload formatting.
 */
export interface ExternalNotifierPort {
  /**
   * @method send
   * @description Sends a notification payload to the specified webhook URL.
   * @param webhookUrl - The destination webhook URL
   * @param channel - The notification channel type (slack or teams)
   * @param payload - The notification content
   */
  send(
    webhookUrl: string,
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<Result<void, DomainError>>;
}
