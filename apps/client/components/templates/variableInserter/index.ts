/**
 * @file index.ts
 * @description Barrel for the VariableInserter side-panel sub-components
 *              and its static data catalogues.
 * @layer infrastructure
 */

export { ContextTab } from "./ContextTab";
export {
  COMMON_VARIABLES,
  HANDLEBARS_HELPERS,
  HELPER_CATEGORIES,
  type HelperInfo,
  type VariableGroup,
} from "./data";
export { HelpersTab } from "./HelpersTab";
export { VariablesTab } from "./VariablesTab";
