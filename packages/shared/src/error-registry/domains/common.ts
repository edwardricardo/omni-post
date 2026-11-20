/**
 * @file common.ts
 * @description The `common` domain: the generic conditions any context answers with one shared
 *   code, never one code per context. Its codes are the strings of the application core's
 *   `USE_CASE_ERRORS`, and both portals can receive every one of them.
 * @layer domain
 */
import { ERROR_CATEGORY, ERROR_FRONT, defineErrors } from "../definition.js";

export const COMMON_ERRORS = defineErrors("common", {
  NOT_FOUND: {
    category: ERROR_CATEGORY.NOT_FOUND,
    status: 404,
    message: "The requested resource was not found",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  VALIDATION_FAILED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 400,
    message: "The request is not valid",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  UNAUTHORIZED: {
    category: ERROR_CATEGORY.AUTHENTICATION,
    status: 401,
    message: "Authentication is required",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  FORBIDDEN: {
    category: ERROR_CATEGORY.PERMISSION,
    status: 403,
    message: "The caller is not allowed to do this",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  CONFLICT: {
    category: ERROR_CATEGORY.CONFLICT,
    status: 409,
    message: "The request conflicts with the current state of the resource",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  INTERNAL_ERROR: {
    category: ERROR_CATEGORY.INTERNAL,
    status: 500,
    message: "The server could not complete the request",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  NOT_IMPLEMENTED: {
    category: ERROR_CATEGORY.NOT_IMPLEMENTED,
    status: 501,
    message: "This operation is not available",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  GUARDRAIL_REJECTED: {
    category: ERROR_CATEGORY.VALIDATION,
    status: 422,
    message: "A content guardrail rejected the request",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  OPERATION_TOO_LARGE: {
    category: ERROR_CATEGORY.TOO_LARGE,
    status: 413,
    message: "The operation is too large to run at once: reduce its scope",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
  TRANSIENT_FAILURE: {
    category: ERROR_CATEGORY.UNAVAILABLE,
    status: 503,
    message: "The operation failed for a reason that may pass: try it again",
    params: {},
    fronts: [ERROR_FRONT.ADMIN, ERROR_FRONT.CLIENT],
  },
});
