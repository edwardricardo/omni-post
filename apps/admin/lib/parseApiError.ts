/**
 * @file parseApiError.ts
 * @description Re-exports the canonical `ApiError` class and helpers from the
 *              shared `@packages/api-errors` package. Existing import paths are
 *              preserved so call-sites do not need to migrate.
 * @layer infrastructure
 */

export {
  ApiError,
  parseApiError,
  getErrorMessage,
  isPermissionDenied,
  isNotFoundError,
} from "@packages/api-errors";
