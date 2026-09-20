/**
 * @file ExternalNotificationDispatcher.ts
 * @description Infrastructure service that orchestrates external notification
 *   delivery. Queries active configs for a given event, then dispatches to
 *   the appropriate channel adapter (Slack or Teams).
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import { type DomainError, InvariantViolationError } from "@core/domain/errors/index.js";
import { type ExternalNotificationConfigRepository } from "@core/domain/repositories/ExternalNotificationConfigRepository.js";
import {
  type BroadcastFailure,
  type BroadcastOptions,
  type BroadcastReport,
  type ExternalNotifierPort,
  type NotificationPayload,
} from "@core/domain/repositories/ExternalNotifierPort.js";

/**
 * @class ExternalNotificationDispatcher
 * @description Implements ExternalNotifierPort by routing notifications
 *   to the correct channel adapter (Slack or Teams).
 *   Also provides a broadcast method to fan-out notifications for a project event.
 */
export class ExternalNotificationDispatcher implements ExternalNotifierPort {
  constructor(
    private readonly configRepository: ExternalNotificationConfigRepository,
    private readonly slackAdapter: {
      send(url: string, payload: NotificationPayload): Promise<Result<void, DomainError>>;
    },
    private readonly teamsAdapter: {
      send(url: string, payload: NotificationPayload): Promise<Result<void, DomainError>>;
    }
  ) {}

  /**
   * @method send
   * @description Sends a notification to a single webhook URL via the correct channel adapter.
   */
  async send(
    webhookUrl: string,
    channel: "slack" | "teams",
    payload: NotificationPayload
  ): Promise<Result<void, DomainError>> {
    if (channel === "slack") {
      return this.slackAdapter.send(webhookUrl, payload);
    }
    if (channel === "teams") {
      return this.teamsAdapter.send(webhookUrl, payload);
    }
    return err(
      new InvariantViolationError(`Unsupported notification channel: ${channel as string}`)
    );
  }

  /**
   * @method broadcast
   * @description Finds the project's destinations and dispatches to each. Collects
   *   errors but does not stop on individual failures.
   *
   *   Which destinations depends on `options`. By DEFAULT the config's own `events`
   *   filter decides. With `toConfigIds` the caller names them and the filter is not
   *   consulted: an event type introduced after a config was created is named by no
   *   filter, so filtering would make it invisible on every destination that exists
   *   today. Deactivating a config stays the only off switch either way, so a NAMED
   *   config that is no longer active is not a destination — it appears in neither
   *   returned list, and the caller reads that as "not reached".
   * @param projectId - The project to broadcast for
   * @param event - The event name that triggered the notification
   * @param payload - The notification content
   * @param options - Names the destinations; omitted means the `events` filter decides
   * @returns Result naming the destinations that took it and those that refused
   */
  async broadcast(
    projectId: string,
    event: string,
    payload: NotificationPayload,
    options?: BroadcastOptions
  ): Promise<Result<BroadcastReport, DomainError>> {
    const configsResult =
      options === undefined
        ? await this.configRepository.findActiveByProjectAndEvent(projectId, event)
        : await this.configRepository.findByProjectId(projectId);

    if (!configsResult.ok) {
      return err(configsResult.error);
    }

    // `findByProjectId` returns inactive configs too; `findActiveByProjectAndEvent`
    // has already filtered. Filtering again is cheap and keeps the invariant in one
    // place: an inactive config is never a destination, whichever query found it.
    // The caller's list narrows it further — a destination it did not name is not one,
    // which is what lets a retry reach the one that was missed and nobody else.
    const named = options?.toConfigIds;
    const destinations = configsResult.value.filter(
      (config) => config.isActive && (named === undefined || named.includes(config.id))
    );

    // Named, not merely counted, on BOTH sides: a caller that claimed a row per
    // destination has to know which ones were reached (keep the claim) and which
    // refused (release it). A config it named that appears in neither was never a
    // destination at all — deactivated or deleted since the caller read it — and the
    // caller reads that absence as "not reached" without a third list to keep in step.
    //
    // A refusal carries the channel adapter's own message. This is the ONLY place it
    // exists: the webhook's answer dies here otherwise, and every caller downstream is
    // left writing the same generic sentence over a revoked token, a deleted channel
    // and a provider outage alike.
    const sentConfigIds: string[] = [];
    const failedConfigs: BroadcastFailure[] = [];

    for (const config of destinations) {
      const result = await this.send(config.webhookUrl, config.channel, payload);
      if (result.ok) {
        sentConfigIds.push(config.id);
      } else {
        failedConfigs.push({ id: config.id, reason: result.error.message });
      }
    }

    return ok({ sentConfigIds, failedConfigs });
  }
}
