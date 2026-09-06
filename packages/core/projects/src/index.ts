/**
 * @file index.ts
 * @description Barrel export for the project lifecycle use cases: the customer-facing soft
 *              delete, its reversal, and the admin-only hard delete, with their caller-context
 *              types.
 * @layer application
 */

export {
  DeleteProjectUseCase,
  type DeleteProjectCaller,
  type DeleteProjectInput,
} from "./DeleteProjectUseCase.js";
export {
  RestoreProjectUseCase,
  type RestoreProjectCaller,
  type RestoreProjectInput,
} from "./RestoreProjectUseCase.js";
export {
  HardDeleteProjectUseCase,
  type HardDeleteProjectCaller,
  type HardDeleteProjectInput,
} from "./HardDeleteProjectUseCase.js";
