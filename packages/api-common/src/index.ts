/**
 * @file index.ts
 * @description Barrel exports for the api-common package — framework-neutral
 *              shared utilities: Zod schema helpers, HMAC webhook signature
 *              verification, and CSV export. Framework-coupled route handler
 *              base class lives app-local in `apps/api/src/lib/route-handler/`
 *              so this package stays free of Fastify.
 * @layer infrastructure
 */

// Common Zod schemas (framework-neutral)
export {
  IdSchema,
  PaginationQuerySchema,
  IsoDateSchema,
  OptionalIsoDateSchema,
  EmailSchema,
  NonEmptyStringSchema,
  UrlSchema,
  PositiveIntSchema,
  ProviderSchema,
  PostStatusSchema,
  PasswordSchema,
  UserRoleSchema,
} from "./schemas";

// Framework-neutral webhook signature helpers (no Fastify dependency)
export { verifyWebhookSignature, constantTimeCompare } from "./webhookSignature";
export type { WebhookVerificationOptions } from "./webhookSignature";

// CSV Export utility — pure RFC 4180 serializer; canonical home is the shared
// kernel (cross-cutting: API + workers + frontend). Re-exported here for the
// HTTP/admin consumers that already import from api-common.
export { exportToCSV, generateCSVFilename } from "@shared/types";
export type { ColumnDefinition, CSVExportOptions } from "@shared/types";
