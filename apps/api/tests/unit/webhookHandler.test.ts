/**
 * DEPRECATED: This monolithic test file has been split into focused files.
 * Tests have been moved to:
 *   - webhookHandler.init.test.ts     (Initialization, Event ID Extraction)
 *   - webhookHandler.processing.test.ts (Duplicate Detection, Signature, Provider Routing, Edge Cases, Subscription Stats)
 *   - webhookHandler.errors.test.ts   (Error Handling, Retry Logic, Dead Letter Queue)
 *   - webhookHandler.stats.test.ts    (Processing Statistics, Failed Event Retry)
 *
 * DO NOT add tests here. This file is intentionally empty.
 */
