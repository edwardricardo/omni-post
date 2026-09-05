/**
 * @file index.ts
 * @description Barrel for the shared application core (`@core/application`):
 *   use cases, command/query handlers, and use-case-contract DTOs. Exposes the
 *   base UseCase interfaces + UseCaseError + USE_CASE_ERRORS.
 * @layer application
 */

export * from "./UseCase.js";
export * from "./hardDeletePolicy.js";
export * from "./retryOnWriteConflict.js";
