/**
 * @file ThreadReadRepository.ts
 * @description Re-export shim — the thread read-model repository port moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/repositories/ThreadReadRepository.js";
