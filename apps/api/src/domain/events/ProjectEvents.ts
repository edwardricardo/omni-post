/**
 * @file ProjectEvents.ts
 * @description Re-export shim — the Project domain events (crisis mode) moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/events/ProjectEvents.js";
