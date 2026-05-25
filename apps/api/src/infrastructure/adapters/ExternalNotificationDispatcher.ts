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
   * @description Finds all active configs for the given project + event and dispatches
   *   notifications to each. Collects errors but does not stop on individual failures.
   * @param projectId - The project to broadcast for
   * @param event - The event name that triggered the notification
   * @param payload - The notification content
   * @returns Result with the number of successful deliveries
   */
  async broadcast(
    projectId: string,
    event: string,
    payload: NotificationPayload
  ): Promise<Result<{ sent: number; failed: number }, DomainError>> {
    const configsResult = await this.configRepository.findActiveByProjectAndEvent(projectId, event);

    if (!configsResult.ok) {
      return err(configsResult.error);
    }

    let sent = 0;
    let failed = 0;

    for (const config of configsResult.value) {
      const result = await this.send(config.webhookUrl, config.channel, payload);
      if (result.ok) {
        sent++;
      } else {
        failed++;
      }
    }

    return ok({ sent, failed });
  }
}
