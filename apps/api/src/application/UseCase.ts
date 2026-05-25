/**
 * @file UseCase.ts
 * @description Re-export shim — base UseCase interfaces + UseCaseError + error
 *              codes moved to `@core/application`. Kept here so existing import
 *              sites keep resolving during the @core migration (strangler-fig);
 *              removed in the burn-down phase (P8).
 * @layer application
 */

export * from "@core/application/UseCase.js";
