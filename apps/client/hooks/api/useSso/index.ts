/**
 * @file index.ts
 * @description Barrel export for the SSO hook module — preserves the public
 *              import path `@/hooks/api/useSso` after the file split.
 * @layer infrastructure
 */

export type {
  ConfigureOidcInput,
  ConfigureSamlInput,
  OidcConfig,
  SamlConfig,
  SsoProvider,
} from "./types.js";

export { useOidcConfig, useSamlConfig } from "./queries.js";

export {
  useConfigureOidc,
  useConfigureSaml,
  useDisableSso,
  useEnableOidc,
  useEnableSaml,
} from "./mutations.js";
