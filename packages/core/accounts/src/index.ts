/**
 * @file index.ts
 * @description Barrel export for account lifecycle use cases (soft delete and the separate,
 *              admin-only hard delete) and their caller-context types.
 * @layer application
 */

export {
  DeleteAccountUseCase,
  type DeleteAccountCaller,
  type DeleteAccountInput,
} from "./DeleteAccountUseCase.js";
export {
  HardDeleteAccountUseCase,
  type HardDeleteAccountCaller,
  type HardDeleteAccountInput,
} from "./HardDeleteAccountUseCase.js";
export {
  RestoreAccountUseCase,
  type RestoreAccountCaller,
  type RestoreAccountInput,
} from "./RestoreAccountUseCase.js";
