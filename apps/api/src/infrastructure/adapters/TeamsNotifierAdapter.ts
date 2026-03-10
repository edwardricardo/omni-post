/**
 * @file TeamsNotifierAdapter.ts
 * @description Infrastructure adapter for sending Microsoft Teams webhook
 *   notifications using Adaptive Card format.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import { type DomainError, InvariantViolationError } from "../../domain/errors/index.js";
import { type NotificationPayload } from "../../domain/repositories/ExternalNotifierPort.js";

/**
 * @class TeamsNotifierAdapter
 * @description Sends formatted notifications to Microsoft Teams via incoming webhooks.
 */
export class TeamsNotifierAdapter {
  /**
   * @method send
   * @description Posts an Adaptive Card formatted message to a Teams webhook URL.
   * @param webhookUrl - Teams incoming webhook URL
   * @param payload - Notification content to deliver
   */
  async send(webhookUrl: string, payload: NotificationPayload): Promise<Result<void, DomainError>> {
    const body = this.buildTeamsPayload(payload);

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
          new InvariantViolationError(`Teams webhook returned HTTP ${response.status}: ${text}`)
        );
      }

      return ok(undefined);
    } catch (error) {
      return err(
        new InvariantViolationError(
          `Teams webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  /**
   * Builds a Microsoft Teams Adaptive Card payload.
   */
  private buildTeamsPayload(payload: NotificationPayload): Record<string, unknown> {
    const facts = [
      { title: "Event", value: payload.event },
      { title: "Project", value: payload.projectId },
      ...Object.entries(payload.metadata ?? {}).map(([key, value]) => ({
        title: key,
        value,
      })),
    ];

    return {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                text: payload.title,
                weight: "Bolder",
                size: "Medium",
              },
              {
                type: "TextBlock",
                text: payload.message,
                wrap: true,
              },
              {
                type: "FactSet",
                facts,
              },
            ],
          },
        },
      ],
    };
  }
}
