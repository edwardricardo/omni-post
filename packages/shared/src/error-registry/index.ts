/**
 * @file index.ts
 * @description The error registry's public names, each exported by name. `defineErrors` is not
 *   among them: only the files of `domains/` build a table, through a relative import.
 * @layer domain
 */
export {
  CATEGORY_STATUSES,
  ERROR_CATEGORY,
  ERROR_CODE_MAX_LENGTH,
  ERROR_CODE_PATTERN,
  ERROR_FRONT,
  PARAM_KIND,
  formatErrorMessage,
  titleOf,
} from "./definition.js";
export type {
  CategoryStatus,
  ErrorCategory,
  ErrorDefinition,
  ErrorEntry,
  ErrorFront,
  ErrorParams,
  ErrorTable,
  ParamKind,
  ParamSpec,
  ParamValue,
  ParamValueByKind,
  ParamsOf,
} from "./definition.js";
export { ERROR_TABLES, findErrorDefinition, listErrorDefinitions } from "./tables.js";
export type { RegisteredDefinition, RegisteredErrorCode } from "./tables.js";
export {
  RegisteredError,
  isCodedError,
  resolveError,
  resolveOccurrence,
  type CodedError,
  type ErrorCauseOption,
  type OfArgs,
  type RegisteredOccurrence,
  type ResolvedError,
} from "./registered-error.js";
export { AUTH_ERRORS } from "./domains/auth.js";
export { COMMON_ERRORS } from "./domains/common.js";
export { HTTP_ERRORS } from "./domains/http.js";
export { PLATFORM_ERRORS } from "./domains/platform.js";
