/**
 * @file index.ts
 * @description Barrel export for the billing module — preserves the public
 *              import path `@/hooks/api/useBilling` after the file split.
 * @layer infrastructure
 */

export type {
  BillingPlan,
  GatewayProvider,
  GatewayStatusDto,
  InitiateGatewaySwitchResult,
  InvoiceDto,
  InvoicesPage,
  PendingSwitch,
  PendingSwitchStatus,
} from "./types.js";

export { useAvailablePlans, useGatewayStatus, useMyInvoices } from "./queries.js";

export {
  useBillingPortal,
  useCancelGatewaySwitch,
  useCheckout,
  useInitiateGatewaySwitch,
} from "./mutations.js";
