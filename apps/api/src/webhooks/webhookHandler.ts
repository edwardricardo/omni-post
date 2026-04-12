/**
 * @file webhookHandler.ts
 * @description Webhook handler facade re-exporting UniversalWebhookHandler and shared
 *              interfaces for backward-compatible consumption by external modules.
 * @layer infrastructure
 */

// Re-export shared interfaces (unchanged public API)
export type {
  WebhookEventInput,
  WebhookProcessingResult,
  WebhookProcessor,
} from "./webhookTypes.js";

// Re-export implementation from sub-modules
export { UniversalWebhookHandler } from "./webhookHandlerCore.js";
