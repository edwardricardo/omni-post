/**
 * @file SlackNotifierAdapter.ts
 * @description Infrastructure adapter for sending Slack webhook notifications
 *   using Block Kit message format.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import { type DomainError, InvariantViolationError } from "../../domain/errors/index.js";
import { type NotificationPayload } from "../../domain/repositories/ExternalNotifierPort.js";

/**
 * @class SlackNotifierAdapter
 * @description Sends formatted notifications to Slack via incoming webhooks.
 */
export class SlackNotifierAdapter {
  /**
   * @method send
   * @description Posts a Block Kit formatted message to a Slack webhook URL.
   * @param webhookUrl - Slack incoming webhook URL
   * @param payload - Notification content to deliver
   */
  async send(webhookUrl: string, payload: NotificationPayload): Promise<Result<void, DomainError>> {
    const body = this.buildSlackPayload(payload);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "unknown error");
        return err(
          new InvariantViolationError(`Slack webhook returned HTTP ${response.status}: ${text}`)
        );
      }

      return ok(undefined);
    } catch (error) {
      return err(
        new InvariantViolationError(
          `Slack webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Builds a Slack Block Kit message payload.
   */
  private buildSlackPayload(payload: NotificationPayload): Record<string, unknown> {
    const metadataFields = Object.entries(payload.metadata ?? {}).map(([key, value]) => ({
      type: "mrkdwn",
      text: `*${key}:*\n${value}`,
    }));

    return {
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: payload.title, emoji: true },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: payload.message },
        },
        ...(metadataFields.length > 0 ? [{ type: "section", fields: metadataFields }] : []),
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Event: \`${payload.event}\` | Project: \`${payload.projectId}\``,
            },
          ],
        },
      ],
    };
  }
}
