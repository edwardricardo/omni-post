/**
 * @file platform.ts
 * @description The `platform` domain: the failures of the environment a process starts in and of the
 *   services it needs to run. A refused environment is named by its variables, never by a value.
 * @layer domain
 */
import { ERROR_CATEGORY, PARAM_KIND, defineErrors } from "../definition.js";

export const PLATFORM_ERRORS = defineErrors("platform", {
  ENV_VARIABLES_REFUSED: {
    category: ERROR_CATEGORY.CONFIGURATION,
    status: 500,
    message: "The environment was refused: these variables are missing or not valid: {variables}",
    params: { variables: PARAM_KIND.STRING_LIST },
    fronts: [],
  },
  DATABASE_UNREACHABLE: {
    category: ERROR_CATEGORY.UNAVAILABLE,
    status: 503,
    message:
      "The database cannot be reached: no connection could be opened, and nothing was read or written",
    params: {},
    fronts: [],
  },
});
