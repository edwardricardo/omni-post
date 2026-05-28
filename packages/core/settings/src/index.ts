/**
 * @file index.ts
 * @description Per-context barrel for settings. Exposes the `SettingsService`
 *   facade alongside the canonical credential-key catalog.
 * @layer application
 */

export { SettingsService } from "./SettingsService.js";
export { CREDENTIAL_KEYS, NON_SECRET_KEYS } from "./credentialKeys.js";
