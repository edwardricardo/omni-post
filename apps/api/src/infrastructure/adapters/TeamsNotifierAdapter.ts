/**
 * @file TeamsNotifierAdapter.ts
 * @description Infrastructure adapter for sending Microsoft Teams
 *   webhook notifications using the Adaptive Card format. Delegates
 *   HTTP transport to `HttpClientPort` — Result-based outbound HTTP
 *   with `AbortSignal.timeout` and the error union TIMEOUT / NETWORK /
 *   BAD_RESPONSE.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import { type DomainError, InvariantViolationError } from "../../domain/errors/index.js";
import { type NotificationPayload } from "../../domain/repositories/ExternalNotifierPort.js";
import type { HttpClientPort } from "../../domain/repositories/HttpClientPort.js";

/**
 * @class TeamsNotifierAdapter
 * @description Sends formatted notifications to Microsoft Teams via incoming webhooks.
 */
export class TeamsNotifierAdapter {
  constructor(private readonly httpClient: HttpClientPort) {}

  /**
   * @method send
   * @description Posts an Adaptive Card formatted message to a Teams webhook URL.
   * @param webhookUrl - Teams incoming webhook URL
   * @param payload - Notification content to deliver
   */
  async send(webhookUrl: string, payload: NotificationPayload): Promise<Result<void, DomainError>> {
    const body = this.buildTeamsPayload(payload);

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
      return err(new InvariantViolationError(`Teams webhook delivery failed: ${reason}`));
    }

    if (result.value.status >= 400) {
      return err(
        new InvariantViolationError(
          `Teams webhook returned HTTP ${result.value.status}: ${result.value.body ?? "unknown error"}`
        )
      );
    }

    return ok(undefined);
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
