/**
 * @file index.ts
 * @description Application layer exports for SAML and OIDC SSO use cases.
 * @layer application
 */

export { ConfigureSamlUseCase, type ConfigureSamlInput } from "./ConfigureSamlUseCase.js";
export { EnableSsoUseCase, type EnableSsoInput } from "./EnableSsoUseCase.js";
export { DisableSsoUseCase, type DisableSsoInput } from "./DisableSsoUseCase.js";
export {
  GetSamlConfigurationQuery,
  type GetSamlConfigurationInput,
  type GetSamlConfigurationOutput,
} from "./GetSamlConfigurationQuery.js";

// OIDC SSO use cases
export { ConfigureOidcUseCase, type ConfigureOidcInput } from "./ConfigureOidcUseCase.js";
export { EnableOidcSsoUseCase, type EnableOidcSsoInput } from "./EnableOidcSsoUseCase.js";
export { DisableOidcSsoUseCase, type DisableOidcSsoInput } from "./DisableOidcSsoUseCase.js";
export {
  GetOidcConfigurationQuery,
  type GetOidcConfigurationInput,
  type GetOidcConfigurationOutput,
} from "./GetOidcConfigurationQuery.js";
