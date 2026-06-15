/**
 * @file index.ts
 * @description Barrel for the VariableInserter side-panel sub-components
 *              and its static data catalogues.
 * @layer infrastructure
 */

export { ContextTab } from "./ContextTab.js";
export {
  COMMON_VARIABLES,
  HANDLEBARS_HELPERS,
  HELPER_CATEGORIES,
  type HelperInfo,
  type VariableGroup,
} from "./data.js";
export { HelpersTab } from "./HelpersTab.js";
export { VariablesTab } from "./VariablesTab.js";
