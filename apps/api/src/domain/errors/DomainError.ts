/**
 * @file DomainError.ts
 * @description Re-export shim — the domain error hierarchy moved to `@core/domain`.
 *              Kept here so existing import sites keep resolving during the @core
 *              migration (strangler-fig); removed in the burn-down phase (P8).
 * @layer domain
 */

export * from "@core/domain/errors/DomainError.js";
