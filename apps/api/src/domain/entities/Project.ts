/**
 * @file Project.ts
 * @description Re-export shim — the Project aggregate moved to `@core/domain`.
 *              Kept here so existing import sites keep resolving during the @core
 *              migration (strangler-fig); removed in the burn-down phase (P8).
 * @layer domain
 */

export * from "@core/domain/entities/Project.js";
