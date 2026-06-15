/**
 * @file index.ts
 * @description Barrel export for the compliance hook module — preserves the
 *              public import path `@/hooks/api/useCompliance` after the file
 *              split.
 * @layer infrastructure
 */

export type {
  BreachReport,
  CreateBreachInput,
  DsarRequest,
  GdprSettings,
  SecuritySettings,
} from "./types";

export {
  useBreachReports,
  useCompliance,
  useComplianceScore,
  useDsarRequests,
  useGdprSettings,
  useSecuritySettings,
} from "./queries";

export {
  useAcknowledgeDsar,
  useCompleteDsar,
  useCreateBreachReport,
  useRejectDsar,
  useSendBreachNotification,
  useUpdateGdprSettings,
  useUpdateSecuritySettings,
} from "./mutations";
