/**
 * @file Notification.ts
 * @description Re-export shim — the Notification entity moved to `@core/domain`.
 *              Kept here so existing import sites keep resolving during the @core
 *              migration (strangler-fig); removed in the burn-down phase (P8).
 * @layer domain
 */

export * from "@core/domain/entities/Notification.js";
