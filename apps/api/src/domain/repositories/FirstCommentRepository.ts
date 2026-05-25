/**
 * @file FirstCommentRepository.ts
 * @description Re-export shim — the first-comment repository port moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/repositories/FirstCommentRepository.js";
