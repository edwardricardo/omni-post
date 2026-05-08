/**
 * @file index.ts
 * @description Barrel export for the gateway-switches hook module —
 *              preserves the public import path
 *              `@/hooks/api/useGatewaySwitches`.
 * @layer infrastructure
 */

export type {
  ExtendDeadlineResponse,
  GatewayName,
  GatewaySwitchAccount,
  GatewaySwitchDetailResponse,
  GatewaySwitchEvent,
  GatewaySwitchFilters,
  GatewaySwitchListData,
  GatewaySwitchListResponse,
  GatewaySwitchStats,
  GatewaySwitchStatus,
} from "./types";

export { useGatewaySwitchDetail, useGatewaySwitches } from "./queries";

export {
  useExtendSwitchDeadline,
  useForceCompleteSwitch,
  useForceSuspendSwitch,
} from "./mutations";
