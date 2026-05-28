/**
 * @file ComplianceService.ts
 * @description Central compliance service for GDPR/LGPD/CCPA/PIPEDA.
 *   Manages settings, compliance score, DSAR requests, and breach reports.
 *   All public methods return Result<T, E> — no throws.
 *
 *   Framework-free: depends only on @core/domain ports + AuditEmitterPort +
 *   @observability/logger.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import crypto from "crypto";
import { createLogger } from "@observability/logger";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import type { AuditEmitterPort } from "@core/domain/repositories/AuditEmitterPort.js";
import type {
  GdprSettings,
  GdprSettingsRepository,
  JurisdictionType,
} from "@core/domain/repositories/GdprSettingsRepository.js";
import type {
  SecuritySettings,
  SecuritySettingsRepository,
} from "@core/domain/repositories/SecuritySettingsRepository.js";
import type {
  DsarListFilters,
  DsarRequestRepository,
  DsarRequestRow,
  DsarRequestRowWithAccount,
  DsarRequestType,
  DsarStatus,
} from "@core/domain/repositories/DsarRequestRepository.js";
import type {
  DataBreachListFilters,
  DataBreachReport,
  DataBreachReportRepository,
} from "@core/domain/repositories/DataBreachReportRepository.js";
import type { AuditLogRetentionPort } from "@core/domain/repositories/AuditLogRetentionPort.js";
import type { AccountNotificationReader } from "@core/domain/repositories/AccountNotificationReader.js";

const logger = createLogger("compliance");

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComplianceError = "NOT_FOUND" | "VALIDATION_ERROR" | "RATE_LIMITED" | "DATABASE_ERROR";

export interface ComplianceCheck {
  key: string;
  label: string;
  weight: number;
  passing: boolean;
  detail?: string;
}

export interface ComplianceScoreResult {
  score: number;
  checks: ComplianceCheck[];
}

interface DsarFilters {
  status?: string;
  type?: string;
  page?: number;
  limit?: number;
}

interface BreachFilters {
  resolved?: boolean;
  page?: number;
  limit?: number;
}

// ─── Jurisdiction deadline mapping ──────────────────────────────────────────

const JURISDICTION_DAYS: Record<string, number> = {
  LGPD: 15,
  CCPA: 45,
  GDPR: 30,
  PIPEDA: 30,
  OTHER: 30,
};

// ─── Service ────────────────────────────────────────────────────────────────

export class ComplianceService {
  constructor(
    private readonly gdprRepo: GdprSettingsRepository,
    private readonly securityRepo: SecuritySettingsRepository,
    private readonly dsarRepo: DsarRequestRepository,
    private readonly breachRepo: DataBreachReportRepository,
    private readonly auditLogRetention: AuditLogRetentionPort,
    private readonly accountNotifications: AccountNotificationReader,
    private readonly emailPort: EmailPort,
    private readonly auditEmitter: AuditEmitterPort
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings (singleton upsert)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getGdprSettings
   * @description Retrieves the singleton GDPR settings record, creating defaults if none exist.
   */
  async getGdprSettings(): Promise<GdprSettings> {
    const existing = await this.gdprRepo.findSingleton();
    if (existing.ok && existing.value) return existing.value;
    const created = await this.gdprRepo.createDefault("gdpr-singleton");
    if (!created.ok) {
      throw new Error("Failed to create default GDPR settings");
    }
    return created.value;
  }

  /**
   * @method updateGdprSettings
   * @description Validates and persists changes to GDPR settings with audit logging.
   */
  async updateGdprSettings(
    data: Record<string, unknown>,
    updatedBy: string
  ): Promise<Result<GdprSettings, ComplianceError>> {
    try {
      const dpoType = (data.dpoType as string) ?? undefined;
      if (dpoType === "INTERNAL" && !data.dpoEmail) return err("VALIDATION_ERROR");
      if (dpoType === "EXTERNAL" && !data.dpoUrl) return err("VALIDATION_ERROR");

      const retentionDays = data.dataRetentionDays as number | undefined;
      if (retentionDays !== undefined && (retentionDays < 30 || retentionDays > 3650)) {
        return err("VALIDATION_ERROR");
      }

      const dsarDays = data.dsarResponseDays as number | undefined;
      if (dsarDays !== undefined && (dsarDays < 15 || dsarDays > 45)) {
        return err("VALIDATION_ERROR");
      }

      const existing = await this.getGdprSettings();
      const updated = await this.gdprRepo.update(existing.id, {
        ...(data as Partial<Omit<GdprSettings, "id" | "updatedAt">>),
        updatedBy,
      });
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "GDPR_SETTINGS_UPDATED",
        category: "COMPLIANCE",
        resourceType: "gdpr_settings",
        resourceId: updated.value.id,
        userId: updatedBy,
        details: data as Record<string, unknown>,
        success: true,
      });

      return ok(updated.value);
    } catch (error) {
      logger.error({ err: error }, "Failed to update GDPR settings");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method getSecuritySettings
   * @description Retrieves the singleton security settings record, creating defaults if none exist.
   */
  async getSecuritySettings(): Promise<SecuritySettings> {
    const existing = await this.securityRepo.findSingleton();
    if (existing.ok && existing.value) return existing.value;
    const created = await this.securityRepo.createDefault("security-singleton");
    if (!created.ok) {
      throw new Error("Failed to create default security settings");
    }
    return created.value;
  }

  /**
   * @method updateSecuritySettings
   * @description Validates and persists changes to security settings with audit logging.
   */
  async updateSecuritySettings(
    data: Record<string, unknown>,
    updatedBy: string
  ): Promise<Result<SecuritySettings, ComplianceError>> {
    try {
      const timeout = data.sessionTimeoutMinutes as number | undefined;
      if (timeout !== undefined && (timeout < 15 || timeout > 10080)) {
        return err("VALIDATION_ERROR");
      }

      const attempts = data.maxLoginAttempts as number | undefined;
      if (attempts !== undefined && (attempts < 3 || attempts > 20)) {
        return err("VALIDATION_ERROR");
      }

      const pwLen = data.passwordMinLength as number | undefined;
      if (pwLen !== undefined && (pwLen < 6 || pwLen > 128)) {
        return err("VALIDATION_ERROR");
      }

      const existing = await this.getSecuritySettings();
      const updated = await this.securityRepo.update(existing.id, {
        ...(data as Partial<Omit<SecuritySettings, "id" | "updatedAt">>),
        updatedBy,
      });
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "SECURITY_SETTINGS_UPDATED",
        category: "SECURITY",
        resourceType: "security_settings",
        resourceId: updated.value.id,
        userId: updatedBy,
        details: data as Record<string, unknown>,
        success: true,
      });

      return ok(updated.value);
    } catch (error) {
      logger.error({ err: error }, "Failed to update security settings");
      return err("DATABASE_ERROR");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Compliance Score (11 checks, weights sum to 100)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getComplianceScore
   * @description Evaluates 11 weighted compliance checks across GDPR, security, and audit settings and returns an aggregate score.
   */
  async getComplianceScore(): Promise<ComplianceScoreResult> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [gdpr, security, recentAuditResult] = await Promise.all([
      this.getGdprSettings(),
      this.getSecuritySettings(),
      this.auditLogRetention.countSince(since24h),
    ]);

    const recentAuditCount = recentAuditResult.ok ? recentAuditResult.value : 0;

    const checks: ComplianceCheck[] = [
      {
        key: "privacy_policy_url",
        label: "Privacy Policy URL configured",
        weight: 12,
        passing: gdpr.privacyPolicyUrl !== null,
      },
      {
        key: "terms_of_service_url",
        label: "Terms of Service URL configured",
        weight: 8,
        passing: gdpr.termsOfServiceUrl !== null,
      },
      {
        key: "dpo_configured",
        label: "Data Protection Officer configured",
        weight: 12,
        passing:
          (gdpr.dpoType === "INTERNAL" && gdpr.dpoEmail !== null) ||
          (gdpr.dpoType === "EXTERNAL" && gdpr.dpoUrl !== null),
      },
      {
        key: "data_retention_set",
        label: "Data retention policy active",
        weight: 10,
        passing: gdpr.dataRetentionDays > 0 && gdpr.enableAutoDataDeletion,
      },
      {
        key: "right_to_erasure",
        label: "Right to erasure enabled",
        weight: 10,
        passing: gdpr.enableRightToErasure,
      },
      {
        key: "data_export",
        label: "Data export enabled",
        weight: 10,
        passing: gdpr.enableDataExport,
      },
      {
        key: "audit_logs_active",
        label: "Audit logs active (last 24h)",
        weight: 8,
        passing: recentAuditCount > 0,
      },
      {
        key: "session_timeout",
        label: "Session timeout within 8 hours",
        weight: 8,
        passing: security.sessionTimeoutMinutes <= 480,
      },
      {
        key: "login_protection",
        label: "Login attempts limited to 10 or fewer",
        weight: 8,
        passing: security.maxLoginAttempts <= 10,
      },
      {
        key: "breach_notification",
        label: "Breach notification enabled",
        weight: 7,
        passing: gdpr.enableBreachNotification,
      },
      {
        key: "dsar_response_time",
        label: "DSAR response within 30 days",
        weight: 7,
        passing: gdpr.dsarResponseDays <= 30,
      },
    ];

    const score = checks.reduce((total, check) => total + (check.passing ? check.weight : 0), 0);

    return { score, checks };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DSAR Requests
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getDsarRequests
   * @description Retrieves a paginated list of DSAR requests with optional status and type filters.
   */
  async getDsarRequests(filters: DsarFilters): Promise<{
    requests: DsarRequestRowWithAccount[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const portFilters: DsarListFilters = {
      page,
      limit,
      ...(filters.status !== undefined && { status: filters.status as DsarStatus }),
      ...(filters.type !== undefined && { type: filters.type as DsarRequestType }),
    };
    const result = await this.dsarRepo.listWithAccount(portFilters);
    if (!result.ok) return { requests: [], total: 0, page, limit };
    return { ...result.value, page, limit };
  }

  /**
   * @method getDsarById
   * @description Retrieves a single DSAR request by its unique identifier.
   */
  async getDsarById(id: string): Promise<DsarRequestRowWithAccount | null> {
    const result = await this.dsarRepo.findByIdWithAccount(id);
    return result.ok ? result.value : null;
  }

  /**
   * @method acknowledgeDsar
   * @description Transitions a DSAR request to IN_PROGRESS status and records the acknowledgment timestamp.
   */
  async acknowledgeDsar(
    id: string,
    adminId: string
  ): Promise<Result<DsarRequestRow, ComplianceError>> {
    try {
      const dsarResult = await this.dsarRepo.findById(id);
      if (!dsarResult.ok) return err("DATABASE_ERROR");
      if (!dsarResult.value) return err("NOT_FOUND");

      const updated = await this.dsarRepo.update(id, {
        status: "IN_PROGRESS",
        acknowledgedAt: new Date(),
      });
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "DSAR_ACKNOWLEDGED",
        category: "COMPLIANCE",
        resourceType: "dsar_request",
        resourceId: id,
        userId: adminId,
        success: true,
      });

      return ok(updated.value);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to acknowledge DSAR");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method completeDsar
   * @description Marks a DSAR request as COMPLETED, optionally attaching an export URL with a 7-day expiry.
   */
  async completeDsar(
    id: string,
    adminId: string,
    exportUrl?: string
  ): Promise<Result<DsarRequestRow, ComplianceError>> {
    try {
      const dsarResult = await this.dsarRepo.findById(id);
      if (!dsarResult.ok) return err("DATABASE_ERROR");
      if (!dsarResult.value) return err("NOT_FOUND");

      const updated = await this.dsarRepo.update(id, {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: adminId,
        ...(exportUrl !== undefined && {
          exportUrl,
          exportExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }),
      });
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "DSAR_COMPLETED",
        category: "COMPLIANCE",
        resourceType: "dsar_request",
        resourceId: id,
        userId: adminId,
        success: true,
      });

      return ok(updated.value);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to complete DSAR");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method rejectDsar
   * @description Rejects a DSAR request with a stated reason and records the rejection in the audit log.
   */
  async rejectDsar(
    id: string,
    adminId: string,
    reason: string
  ): Promise<Result<DsarRequestRow, ComplianceError>> {
    try {
      const dsarResult = await this.dsarRepo.findById(id);
      if (!dsarResult.ok) return err("DATABASE_ERROR");
      if (!dsarResult.value) return err("NOT_FOUND");

      const updated = await this.dsarRepo.update(id, {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectedBy: adminId,
        rejectionReason: reason,
      });
      if (!updated.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "DSAR_REJECTED",
        category: "COMPLIANCE",
        resourceType: "dsar_request",
        resourceId: id,
        userId: adminId,
        details: { reason },
        success: true,
      });

      return ok(updated.value);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to reject DSAR");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method submitDsarRequest
   * @description Creates a new DSAR request with jurisdiction-based deadline, rate limiting (max 3 pending per email), and audit trail.
   */
  async submitDsarRequest(data: {
    requestorEmail: string;
    requestorName?: string;
    type: string;
    accountId?: string;
    jurisdiction?: string;
    ipAddress?: string;
  }): Promise<Result<{ id: string; deadlineAt: Date; message: string }, ComplianceError>> {
    try {
      const pendingCountResult = await this.dsarRepo.countPendingByEmail(data.requestorEmail);
      if (!pendingCountResult.ok) return err("DATABASE_ERROR");
      if (pendingCountResult.value >= 3) return err("RATE_LIMITED");

      const gdprSettings = await this.getGdprSettings();
      const jurisdiction = (data.jurisdiction ??
        gdprSettings.defaultJurisdiction) as JurisdictionType;
      const daysToRespond = JURISDICTION_DAYS[jurisdiction] ?? gdprSettings.dsarResponseDays;
      const deadlineAt = new Date(Date.now() + daysToRespond * 24 * 60 * 60 * 1000);

      const created = await this.dsarRepo.create({
        requestorEmail: data.requestorEmail,
        ...(data.requestorName !== undefined && { requestorName: data.requestorName }),
        type: data.type as DsarRequestType,
        jurisdiction,
        deadlineAt,
        verificationToken: crypto.randomUUID(),
        ...(data.accountId !== undefined && { accountId: data.accountId }),
        ...(data.ipAddress !== undefined && { ipAddress: data.ipAddress }),
      });
      if (!created.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "DSAR_SUBMITTED",
        category: "COMPLIANCE",
        resourceType: "dsar_request",
        resourceId: created.value.id,
        details: {
          type: data.type,
          jurisdiction,
          email: data.requestorEmail,
        },
        success: true,
      });

      return ok({
        id: created.value.id,
        deadlineAt,
        message: `Your request has been received. We will respond within ${daysToRespond} days.`,
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to submit DSAR request");
      return err("DATABASE_ERROR");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Breach Reports
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @method getBreachReports
   * @description Retrieves a paginated list of data breach reports with optional resolved-status filter.
   */
  async getBreachReports(filters: BreachFilters): Promise<{
    reports: DataBreachReport[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const portFilters: DataBreachListFilters = {
      page,
      limit,
      ...(filters.resolved !== undefined && { resolved: filters.resolved }),
    };
    const result = await this.breachRepo.list(portFilters);
    if (!result.ok) return { reports: [], total: 0, page, limit };
    return { ...result.value, page, limit };
  }

  /**
   * @method createBreachReport
   * @description Records a new data breach report with severity, affected data types, and audit logging.
   */
  async createBreachReport(
    data: {
      title: string;
      description: string;
      discoveredAt: string;
      severity: string;
      dataTypesAffected: string[];
      affectedUserCount?: number;
    },
    reportedBy: string
  ): Promise<Result<DataBreachReport, ComplianceError>> {
    try {
      const created = await this.breachRepo.create({
        title: data.title,
        description: data.description,
        discoveredAt: new Date(data.discoveredAt),
        severity: data.severity,
        dataTypesAffected: data.dataTypesAffected,
        reportedBy,
        ...(data.affectedUserCount !== undefined && {
          affectedUserCount: data.affectedUserCount,
        }),
      });
      if (!created.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "BREACH_REPORTED",
        category: "SECURITY",
        resourceType: "data_breach",
        resourceId: created.value.id,
        userId: reportedBy,
        details: { title: data.title, severity: data.severity },
        success: true,
      });

      return ok(created.value);
    } catch (error) {
      logger.error({ err: error }, "Failed to create breach report");
      return err("DATABASE_ERROR");
    }
  }

  /**
   * @method sendBreachNotifications
   * @description Sends email notifications about a breach to all active accounts and records the notification event.
   */
  async sendBreachNotifications(
    breachId: string,
    adminId: string
  ): Promise<Result<{ notified: number; errors: number }, ComplianceError>> {
    try {
      const breachResult = await this.breachRepo.findById(breachId);
      if (!breachResult.ok) return err("DATABASE_ERROR");
      const breach = breachResult.value;
      if (!breach) return err("NOT_FOUND");

      const emailsResult = await this.accountNotifications.listActiveEmails();
      if (!emailsResult.ok) return err("DATABASE_ERROR");

      let notified = 0;
      let errors = 0;

      for (const email of emailsResult.value) {
        const result = await this.emailPort.send({
          to: [email],
          subject: `Security Notice: ${breach.title}`,
          body: `We are writing to inform you of a data security incident: ${breach.description}. Data types potentially affected: ${breach.dataTypesAffected.join(", ")}. If you have questions, please contact our Data Protection Officer.`,
        });
        if (result.ok) {
          notified++;
        } else {
          errors++;
        }
      }

      const updateResult = await this.breachRepo.update(breachId, {
        notificationSentAt: new Date(),
        notificationSentBy: adminId,
      });
      if (!updateResult.ok) return err("DATABASE_ERROR");

      await this.auditEmitter.emit({
        action: "BREACH_NOTIFICATIONS_SENT",
        category: "SECURITY",
        resourceType: "data_breach",
        resourceId: breachId,
        userId: adminId,
        details: { notified, errors },
        success: true,
      });

      return ok({ notified, errors });
    } catch (error) {
      logger.error({ err: error }, "Failed to send breach notifications");
      return err("DATABASE_ERROR");
    }
  }
}
