/**
 * @file IntegrationSubscription.ts
 * @description Re-export shim — the IntegrationSubscription entity moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/entities/IntegrationSubscription.js";
