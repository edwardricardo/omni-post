/**
 * @file Repository.ts
 * @description Re-export shim — base repository ports + UnitOfWork moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/repositories/Repository.js";
