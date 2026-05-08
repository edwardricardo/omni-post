/**
 * @file index.ts
 * @description Barrel for the canonical `ApiError` shared package — exports the
 *              class, parsing helpers, and shortcut predicates consumed by both
 *              the admin and client apps.
 * @layer infrastructure
 */

export {
  ApiError,
  parseApiError,
  getErrorMessage,
  isPermissionDenied,
  isNotFoundError,
} from "./ApiError";
