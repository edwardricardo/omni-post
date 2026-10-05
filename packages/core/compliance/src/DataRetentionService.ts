/**
 * @file DataRetentionService.ts
 * @description Automated data retention cleanup. Deletes expired audit logs
 *   and marks overdue DSAR requests as EXPIRED. Only runs when
 *   enableAutoDataDeletion is true.
 *
 *   Framework-free: depends only on @core/domain ports + AuditEmitterPort. Each
 *   run's counts are recorded by the `auditEmitter.emit({ action: "DATA_RETENTION_CLEANUP" })`
 *   call that closes the sweep below (pinned by
 *   apps/api/tests/unit/compliance/DataRetentionService.test.ts), so the service writes no
 *   log line of its own; the application layer logs WARN and ERROR only, and a run that
 *   completes is neither.
 * @layer application
 */

import type { GdprSettingsRepository } from "@core/domain/repositories/GdprSettingsRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import type { DsarRequestRepository } from "@core/domain/repositories/DsarRequestRepository.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";

export class DataRetentionService {
  constructor(
    private readonly gdprRepo: GdprSettingsRepository,
    private readonly auditLogRetention: AuditLogRetentionPort,
    private readonly dsarRepo: DsarRequestRepository,
    private readonly auditEmitter: AuditEmitterPort
  ) {}

  /**
   * @method runRetentionCleanup
   * @description Deletes expired audit logs beyond the retention period and marks overdue DSAR requests as EXPIRED.
   */
  async runRetentionCleanup(): Promise<{
    auditLogsDeleted: number;
    expiredDsarRequests: number;
  }> {
    const settingsResult = await this.gdprRepo.findSingleton();
    const settings = settingsResult.ok ? settingsResult.value : null;
    if (!settings?.enableAutoDataDeletion) {
      return { auditLogsDeleted: 0, expiredDsarRequests: 0 };
    }

    const now = new Date();
    const auditCutoff = new Date(
      now.getTime() - settings.auditLogRetentionDays * 24 * 60 * 60 * 1000
    );

    const deletedAuditResult = await this.auditLogRetention.deleteOlderThan(auditCutoff);
    const expiredDsarResult = await this.dsarRepo.markOverdueAsExpired(now);

    const result = {
      auditLogsDeleted: deletedAuditResult.ok ? deletedAuditResult.value : 0,
      expiredDsarRequests: expiredDsarResult.ok ? expiredDsarResult.value : 0,
    };

    await this.auditEmitter.emit({
      action: "DATA_RETENTION_CLEANUP",
      category: "SYSTEM",
      resourceType: "system",
      details: result,
      success: true,
    });

    return result;
  }
}
