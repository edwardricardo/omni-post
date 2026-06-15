/**
 * @file index.ts
 * @description Barrel export for the platform-settings hook module —
 *              preserves the public import path `@/hooks/api/useSettings`.
 * @layer infrastructure
 */

export type { SettingsStatus, TestResult } from "./types.js";

export { useGroupSettings, useSettingsStatus } from "./queries.js";

export {
  useDeleteCredential,
  useRotateEncryption,
  useTestConnection,
  useUpdateGroupSettings,
} from "./mutations.js";
