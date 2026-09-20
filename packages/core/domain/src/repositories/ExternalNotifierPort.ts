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
 * Options for a broadcast whose destinations the CALLER chooses.
 */
export interface BroadcastOptions {
  /**
   * Deliver to exactly these configs of the project, and to no others — the `events`
   * filter is not consulted for them.
   *
   * It exists for announcements the filter cannot know about: a config created before
   * an event type existed lists none of its names, so honouring the filter would make
   * that announcement invisible on every destination that already exists.
   *
   * It is a LIST rather than a "reach everything" flag because a caller that holds a
   * per-destination claim has to be able to reach ONE destination again without
   * reaching its siblings: re-querying every active config on a retry tells the
   * already-notified channels a second time, which is the duplicate a per-destination
   * claim exists to prevent. Deactivating a config remains the off switch, and a named
   * config that is no longer active is simply not a destination.
   */
  toConfigIds: readonly string[];
}

/**
 * What one fan-out did, per destination rather than in aggregate. Two LISTS rather than
 * two counts: a caller that claimed a row per destination has to release exactly the
 * ones nothing reached, and a count cannot say which those are.
 *
 * The two lists do not necessarily cover every destination the caller named. A config
 * that stopped being active, or stopped existing, between the caller's read and this
 * fan-out appears in NEITHER — it was never attempted, so it neither took the message
 * nor refused it. Callers derive "not reached" as `asked − sentConfigIds`, which
 * catches that case without a third list to keep in step.
 */
export interface BroadcastReport {
  sentConfigIds: readonly string[];
  failedConfigIds: readonly string[];
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
   *   The report NAMES both sides — what was reached and what refused — rather than
   *   counting them: a caller holding a per-destination claim has to know WHICH one to
   *   retry, and a count leaves it choosing between retrying all of them and retrying
   *   none. With `toConfigIds` the caller also chooses the destinations, so a retry
   *   reaches the one that was missed and leaves its siblings alone.
   * @param projectId - The project whose destinations receive the notification
   * @param event - The event name being announced
   * @param payload - The notification content
   * @param options - Names the destinations; omitted means the config's `events` filter decides
   * @returns Result naming the destinations that took it and those that refused
   */
  broadcast(
    projectId: string,
    event: string,
    payload: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<Result<BroadcastReport, DomainError>>;

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
