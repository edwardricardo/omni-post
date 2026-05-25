/**
 * @file DomainEvent.ts
 * @description Re-export shim — the base domain event infrastructure moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/events/DomainEvent.js";
