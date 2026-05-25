/**
 * @file MentionParser.ts
 * @description Re-export shim — the MentionParser domain service moved to
 *              `@core/domain`. Kept here so existing import sites keep resolving
 *              during the @core migration (strangler-fig); removed at P8.
 * @layer domain
 */

export * from "@core/domain/services/MentionParser.js";
