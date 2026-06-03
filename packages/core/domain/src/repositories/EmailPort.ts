/**
 * @file EmailPort.ts
 * @description Domain port for sending emails with optional attachments.
 *   Infrastructure adapters implement this interface to integrate with
 *   email providers such as Resend, SendGrid, or SES.
 * @layer domain
 */

import { type Result } from "@shared/types";

/**
 * Attachment to include in an outgoing email.
 */
export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType: string;
}

/**
 * Options for sending an email message.
 */
export interface SendEmailOptions {
  to: string[];
  subject: string;
  body: string;
  html?: string;
  attachments?: EmailAttachment[];
}

/**
 * @interface EmailPort
 * @description Port for email delivery. Implementations must handle
 *   transient failures gracefully and return Result rather than throwing.
 */
export interface EmailPort {
  /**
   * Send one email. Implementations MUST surface transient transport errors
   * via the Result channel so callers can retry idempotently.
   */
  send(options: SendEmailOptions): Promise<Result<void, Error>>;
}
