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
 * Options for a project-wide broadcast.
 */
export interface BroadcastOptions {
  /**
   * Reach EVERY active config of the project instead of only those whose `events`
   * filter names this event. Set by announcements the filter cannot know about: a
   * config created before an event type existed lists none of its names, so honouring
   * the filter would make that announcement invisible on every destination that
   * already exists. Deactivating the config remains the off switch.
   */
  toEveryActiveConfig: boolean;
}

/**
 * @interface ExternalNotifierPort
 * @description Port for delivering notifications to external webhook endpoints.
 *   Implementations handle channel-specific payload formatting.
 */
export interface ExternalNotifierPort {
  /**
   * @method broadcast
   * @description Fans a notification out to a project's configured destinations.
   *   Collects per-destination outcomes rather than stopping at the first failure — a
   *   shared channel that is unreachable must not silence the others.
   * @param projectId - The project whose destinations receive the notification
   * @param event - The event name being announced
   * @param payload - The notification content
   * @param options - Broadcast options; omitted means the config's `events` filter decides
   * @returns Result with how many destinations were reached and how many refused
   */
  broadcast(
    projectId: string,
    event: string,
    payload: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<Result<{ sent: number; failed: number }, DomainError>>;

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
