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
} from "./types";

export { useOidcConfig, useSamlConfig } from "./queries";

export {
  useConfigureOidc,
  useConfigureSaml,
  useDisableSso,
  useEnableOidc,
  useEnableSaml,
} from "./mutations";
