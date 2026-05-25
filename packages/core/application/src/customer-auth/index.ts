/**
 * @file index.ts
 * @description Barrel export for customer authentication use cases.
 * @layer application
 */

export {
  RegisterCustomerUseCase,
  type RegisterCustomerInput,
  type RegisterCustomerOutput,
  type RegisterCustomerError,
} from "./RegisterCustomerUseCase.js";

export {
  LoginCustomerUseCase,
  type LoginCustomerInput,
  type LoginCustomerOutput,
  type LoginCustomerError,
} from "./LoginCustomerUseCase.js";

export {
  RefreshCustomerTokenUseCase,
  type RefreshCustomerTokenInput,
  type RefreshCustomerTokenOutput,
  type RefreshCustomerTokenError,
} from "./RefreshCustomerTokenUseCase.js";

export { LogoutCustomerUseCase, type LogoutCustomerError } from "./LogoutCustomerUseCase.js";

export {
  RequestPasswordResetUseCase,
  type RequestPasswordResetInput,
  type RequestPasswordResetError,
} from "./RequestPasswordResetUseCase.js";

export {
  ResetPasswordUseCase,
  type ResetPasswordInput,
  type ResetPasswordError,
} from "./ResetPasswordUseCase.js";
