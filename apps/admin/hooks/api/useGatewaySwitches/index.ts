/**
 * @file index.ts
 * @description Barrel export for the gateway-switches hook module —
 *              preserves the public import path
 *              `@/hooks/api/useGatewaySwitches`.
 * @layer infrastructure
 */

export type { GatewaySwitchEvent } from "./types.js";

export { useGatewaySwitchDetail, useGatewaySwitches } from "./queries.js";

export {
  useExtendSwitchDeadline,
  useForceCompleteSwitch,
  useForceSuspendSwitch,
} from "./mutations.js";
