/**
 * @file index.ts
 * @description Per-context barrel for compliance. Exposes the
 *   `ComplianceService` (GDPR/LGPD/CCPA/PIPEDA settings + DSAR + breach
 *   reports) alongside the `DataRetentionService` (scheduled cleanup).
 * @layer application
 */

export {
  ComplianceService,
  type ComplianceError,
  type ComplianceCheck,
  type ComplianceScoreResult,
} from "./ComplianceService.js";
export { DataRetentionService } from "./DataRetentionService.js";
