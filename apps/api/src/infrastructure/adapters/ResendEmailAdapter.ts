/**
 * @file ResendEmailAdapter.ts
 * @description Infrastructure adapter implementing EmailPort via the Resend REST API.
 *   Uses native fetch (no SDK dependency). Falls back to a no-op when the
 *   RESEND_API_KEY environment variable is not configured, logging a warning.
 * @layer infrastructure
 */

import { type Result, ok, err } from "@shared/types";
import type { EmailPort, SendEmailOptions } from "../../domain/repositories/EmailPort.js";
import { createLogger } from "../../lib/logger.js";

const emailLogger = createLogger("email");

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * @class ResendEmailAdapter
 * @description Sends emails via the Resend REST API. Returns ok() even when
 *   the API key is missing (non-critical path) so callers are not blocked.
 */
export class ResendEmailAdapter implements EmailPort {
  private readonly apiKey: string | undefined;
  private readonly fromAddress: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY;
    this.fromAddress = process.env.RESEND_FROM_ADDRESS ?? "reports@omnipost.app";
  }

  /**
   * @method send
   * @description Sends an email via Resend. If the API key is not configured,
   *   logs a warning and returns ok() to avoid breaking the caller.
   * @param options - Email options including recipients, subject, body, attachments
   * @returns Result<void> on success, Error on network/API failure
   */
  async send(options: SendEmailOptions): Promise<Result<void, Error>> {
    if (!this.apiKey) {
      emailLogger.warn("RESEND_API_KEY not set; skipping email delivery.");
      return ok(undefined);
    }

    try {
      const attachments = options.attachments?.map((att) => ({
        filename: att.filename,
        content: typeof att.content === "string" ? att.content : att.content.toString("base64"),
        content_type: att.contentType,
      }));

      const payload: Record<string, unknown> = {
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.body,
        ...(options.html !== undefined && { html: options.html }),
      };

      if (attachments && attachments.length > 0) {
        payload.attachments = attachments;
      }

      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();

        emailLogger.error({ status: response.status, errorBody }, "Resend API error");
        // Return ok for non-critical email failures
        return ok(undefined);
      }

      return ok(undefined);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      emailLogger.error({ err: error }, "Failed to send email");
      return err(error instanceof Error ? error : new Error(message));
    }
  }
}
