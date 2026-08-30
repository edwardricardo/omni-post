/**
 * @file index.ts
 * @description Barrel export for project lifecycle use cases (soft delete and the separate,
 *              admin-only hard delete) and their caller-context types.
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
