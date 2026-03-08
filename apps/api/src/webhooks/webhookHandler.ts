/**
 * Webhook Handler - Facade
 *
 * Re-exports UniversalWebhookHandler and interfaces
 * from sub-modules. External consumers continue importing from this file.
 *
 * @module webhooks/webhookHandler
 */

// Re-export shared interfaces (unchanged public API)
export type {
  WebhookEventInput,
  WebhookProcessingResult,
  WebhookProcessor,
} from "./webhookTypes.js";

// Re-export implementation from sub-modules
export { UniversalWebhookHandler } from "./webhookHandlerCore.js";
