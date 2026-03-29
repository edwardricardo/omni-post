/**
 * Shared Webhook Types
 *
 * Interfaces shared across webhookHandler, webhookHandlerCore, and all
 * webhook processors. Extracted here to break circular import cycles.
 *
 * @module webhooks/webhookTypes
 */

import type { WebhookEventType } from "@infra/prisma";
import type { Provider } from "@infra/prisma";

/**
 * Input data for storing/processing a webhook event
 */
export interface WebhookEventInput {
  provider: Provider;
  eventType: string;
  eventId: string;
  signature: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  accountId?: string;
  projectId?: string;
  postId?: string;
  channelId?: string;
}

/**
 * Result returned from processing a webhook event
 */
export interface WebhookProcessingResult {
  success: boolean;
  eventId: string;
  normalizedData?: Record<string, unknown>;
  error?: string;
  retryAfter?: number;
}

/**
 * Contract that every provider webhook processor must implement
 */
export interface WebhookProcessor {
  verify(
    payload: string,
    signature: string,
    secret: string,
    headers?: Record<string, string>
  ): boolean;
  parse(payload: Record<string, unknown>): Promise<{
    eventType: WebhookEventType;
    normalizedData: Record<string, unknown>;
    relatedEntities: {
      accountId?: string;
      projectId?: string;
      postId?: string;
      channelId?: string;
    };
  }>;
  process(
    normalizedData: Record<string, unknown>,
    relatedEntities: Record<string, unknown>
  ): Promise<void>;
}
