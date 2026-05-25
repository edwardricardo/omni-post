/**
 * @file EntityId.ts
 * @description Re-export shim — strongly-typed entity identifiers moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/value-objects/EntityId.js";
