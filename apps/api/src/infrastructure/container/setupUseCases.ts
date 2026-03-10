/**
 * @file setupUseCases.ts
 * @description Orchestrator that delegates use case registration to domain-specific modules.
 *              Split into sub-modules to keep each file under 800 lines.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { setupPostUseCases } from "./setupPostUseCases.js";
import { setupApiKeyUseCases } from "./setupApiKeyUseCases.js";
import { setupAnalyticsUseCases } from "./setupAnalyticsUseCases.js";
import { setupLinkUseCases } from "./setupLinkUseCases.js";
import { setupTeamUseCases } from "./setupTeamUseCases.js";
import { setupNotificationUseCases } from "./setupNotificationUseCases.js";
import { setupInboxUseCases } from "./setupInboxUseCases.js";
import { setupCrisisUseCases } from "./setupCrisisUseCases.js";
import { setupFirstCommentUseCases } from "./setupFirstCommentUseCases.js";
import { setupExternalNotificationUseCases } from "./setupExternalNotificationUseCases.js";
import { setupAIImageUseCases } from "./setupAIImageUseCases.js";
import { setupRecurringPostUseCases } from "./setupRecurringPostUseCases.js";

/**
 * @method setupUseCases
 * @description Register all use cases by delegating to domain-specific sub-modules.
 */
export function setupUseCases(container: Container): void {
  setupPostUseCases(container);
  setupApiKeyUseCases(container);
  setupAnalyticsUseCases(container);
  setupLinkUseCases(container);
  setupCrisisUseCases(container);
  setupTeamUseCases(container);
  setupNotificationUseCases(container);
  setupInboxUseCases(container);
  setupFirstCommentUseCases(container);
  setupExternalNotificationUseCases(container);
  setupAIImageUseCases(container);
  setupRecurringPostUseCases(container);
}
