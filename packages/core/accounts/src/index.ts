/**
 * @file index.ts
 * @description Barrel export for the account lifecycle use cases: the customer-facing soft
 *              delete and the admin-only hard delete, with their caller-context types.
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
