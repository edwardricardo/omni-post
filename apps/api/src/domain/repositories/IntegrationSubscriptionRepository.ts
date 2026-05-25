/**
 * @file IntegrationSubscriptionRepository.ts
 * @description Re-export shim — the IntegrationSubscription repository port moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/repositories/IntegrationSubscriptionRepository.js";
