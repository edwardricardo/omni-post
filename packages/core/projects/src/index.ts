/**
 * @file index.ts
 * @description Barrel export for the admin-only hard-delete project use case and its
 *              caller-context types.
 * @layer application
 */

export {
  HardDeleteProjectUseCase,
  type HardDeleteProjectCaller,
  type HardDeleteProjectInput,
} from "./HardDeleteProjectUseCase.js";
