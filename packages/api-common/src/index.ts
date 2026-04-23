/**
 * @file index.ts
 * @description Barrel exports for the api-common package — BaseRouteHandler, shared Zod schemas,
 *              and the CSV export utility.
 * @layer infrastructure
 */
// Base handler
export { BaseRouteHandler } from "./BaseRouteHandler";
export type {
  RouteContext,
  ValidationOptions,
  ErrorResponse,
  SuccessResponse,
  OAuthErrorContext,
} from "./BaseRouteHandler";

// Common Zod schemas
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
} from "./BaseRouteHandler";

// CSV Export utility
export { exportToCSV, generateCSVFilename } from "./utils/csvExport";
export type { ColumnDefinition, CSVExportOptions } from "./utils/csvExport";
