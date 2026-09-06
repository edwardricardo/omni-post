/**
 * @file index.ts
 * @description Barrel export for the project lifecycle use cases: the customer-facing soft
 *              delete and the admin-only hard delete, with their caller-context types.
 * @layer application
 */

export {
  DeleteProjectUseCase,
  type DeleteProjectCaller,
  type DeleteProjectInput,
} from "./DeleteProjectUseCase.js";
export {
  HardDeleteProjectUseCase,
  type HardDeleteProjectCaller,
  type HardDeleteProjectInput,
} from "./HardDeleteProjectUseCase.js";
