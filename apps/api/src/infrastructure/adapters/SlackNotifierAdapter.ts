/**
 * @file SlackNotifierAdapter.ts
 * @description Infrastructure adapter for sending Slack webhook notifications
 *   using Block Kit message format. Delegates HTTP transport to HttpClientPort
 *   (canon T4-X — Result-based outbound HTTP, AbortSignal.timeout, error union
 *   TIMEOUT/NETWORK/BAD_RESPONSE).
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import { type DomainError, InvariantViolationError } from "../../domain/errors/index.js";
import { type NotificationPayload } from "../../domain/repositories/ExternalNotifierPort.js";
import type { HttpClientPort } from "../../domain/repositories/HttpClientPort.js";

/**
 * @class SlackNotifierAdapter
 * @description Sends formatted notifications to Slack via incoming webhooks.
 */
export class SlackNotifierAdapter {
  constructor(private readonly httpClient: HttpClientPort) {}

  /**
   * @method send
   * @description Posts a Block Kit formatted message to a Slack webhook URL.
   * @param webhookUrl - Slack incoming webhook URL
   * @param payload - Notification content to deliver
   */
  async send(webhookUrl: string, payload: NotificationPayload): Promise<Result<void, DomainError>> {
    const body = this.buildSlackPayload(payload);

    const result = await this.httpClient.post(webhookUrl, JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      timeoutMs: 10_000,
    });

    if (!result.ok) {
      const reason =
        result.error === "TIMEOUT"
          ? "timed out after 10s"
          : result.error === "NETWORK"
            ? "network error"
            : "bad response";
      return err(new InvariantViolationError(`Slack webhook delivery failed: ${reason}`));
    }

    if (result.value.status >= 400) {
      return err(
        new InvariantViolationError(
          `Slack webhook returned HTTP ${result.value.status}: ${result.value.body ?? "unknown error"}`
        )
      );
    }

    return ok(undefined);
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
