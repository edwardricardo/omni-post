/**
 * @file index.ts
 * @description Barrel export for the admin-only hard-delete account use case and its
 *              caller-context types.
 * @layer application
 */

export {
  HardDeleteAccountUseCase,
  type HardDeleteAccountCaller,
  type HardDeleteAccountInput,
} from "./HardDeleteAccountUseCase.js";
