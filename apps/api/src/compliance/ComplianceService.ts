/**
 * @file ComplianceService.ts
 * @description Central compliance service for GDPR/LGPD/CCPA/PIPEDA.
 *   Manages settings, compliance score, DSAR requests, and breach reports.
 *   All public methods return Result<T, E> — no throws.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import crypto from "crypto";
import type { EmailPort } from "../domain/repositories/EmailPort.js";
import { logger } from "../lib/logger.js";

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
  constructor(private readonly emailPort: EmailPort) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings (singleton upsert)
  // ═══════════════════════════════════════════════════════════════════════════

  async getGdprSettings() {
    const settings = await prisma.gdprSettings.findFirst();
    if (settings) return settings;
    return prisma.gdprSettings.create({
      data: { id: "gdpr-singleton" },
    });
  }

  async updateGdprSettings(
    data: Record<string, unknown>,
    updatedBy: string
  ): Promise<Result<unknown, ComplianceError>> {
    try {
      const dpoType = (data.dpoType as string) ?? undefined;
      if (dpoType === "INTERNAL" && !data.dpoEmail) {
        return err("VALIDATION_ERROR");
      }
      if (dpoType === "EXTERNAL" && !data.dpoUrl) {
        return err("VALIDATION_ERROR");
      }

      const retentionDays = data.dataRetentionDays as number | undefined;
      if (retentionDays !== undefined && (retentionDays < 30 || retentionDays > 3650)) {
        return err("VALIDATION_ERROR");
      }

      const dsarDays = data.dsarResponseDays as number | undefined;
      if (dsarDays !== undefined && (dsarDays < 15 || dsarDays > 45)) {
        return err("VALIDATION_ERROR");
      }

      const existing = await this.getGdprSettings();
      const updated = await prisma.gdprSettings.update({
        where: { id: existing.id },
        data: { ...data, updatedBy, updatedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: "GDPR_SETTINGS_UPDATED",
          resource: "gdpr_settings",
          resourceId: updated.id,
          userId: updatedBy,
          details: data as object,
          success: true,
        },
      });

      return ok(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update GDPR settings");
      return err("DATABASE_ERROR");
    }
  }

  async getSecuritySettings() {
    const settings = await prisma.securitySettings.findFirst();
    if (settings) return settings;
    return prisma.securitySettings.create({
      data: { id: "security-singleton" },
    });
  }

  async updateSecuritySettings(
    data: Record<string, unknown>,
    updatedBy: string
  ): Promise<Result<unknown, ComplianceError>> {
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
      const updated = await prisma.securitySettings.update({
        where: { id: existing.id },
        data: { ...data, updatedBy, updatedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: "SECURITY_SETTINGS_UPDATED",
          resource: "security_settings",
          resourceId: updated.id,
          userId: updatedBy,
          details: data as object,
          success: true,
        },
      });

      return ok(updated);
    } catch (error) {
      logger.error({ err: error }, "Failed to update security settings");
      return err("DATABASE_ERROR");
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Compliance Score (11 checks, weights sum to 100)
  // ═══════════════════════════════════════════════════════════════════════════

  async getComplianceScore(): Promise<ComplianceScoreResult> {
    const [gdpr, security, recentAuditCount] = await Promise.all([
      this.getGdprSettings(),
      this.getSecuritySettings(),
      prisma.auditLog.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

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

  async getDsarRequests(filters: DsarFilters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;

    const [requests, total] = await Promise.all([
      prisma.dsarRequest.findMany({
        where,
        include: { account: { select: { id: true, name: true, email: true } } },
        orderBy: { requestedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.dsarRequest.count({ where }),
    ]);

    return { requests, total, page, limit };
  }

  async getDsarById(id: string) {
    return prisma.dsarRequest.findUnique({
      where: { id },
      include: { account: { select: { id: true, name: true, email: true } } },
    });
  }

  async acknowledgeDsar(id: string, adminId: string): Promise<Result<unknown, ComplianceError>> {
    try {
      const dsar = await prisma.dsarRequest.findUnique({ where: { id } });
      if (!dsar) return err("NOT_FOUND");

      const updated = await prisma.dsarRequest.update({
        where: { id },
        data: { status: "IN_PROGRESS", acknowledgedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: "DSAR_ACKNOWLEDGED",
          resource: "dsar_request",
          resourceId: id,
          userId: adminId,
          success: true,
        },
      });

      return ok(updated);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to acknowledge DSAR");
      return err("DATABASE_ERROR");
    }
  }

  async completeDsar(
    id: string,
    adminId: string,
    exportUrl?: string
  ): Promise<Result<unknown, ComplianceError>> {
    try {
      const dsar = await prisma.dsarRequest.findUnique({ where: { id } });
      if (!dsar) return err("NOT_FOUND");

      const updated = await prisma.dsarRequest.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedBy: adminId,
          ...(exportUrl !== undefined && {
            exportUrl,
            exportExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }),
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "DSAR_COMPLETED",
          resource: "dsar_request",
          resourceId: id,
          userId: adminId,
          success: true,
        },
      });

      return ok(updated);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to complete DSAR");
      return err("DATABASE_ERROR");
    }
  }

  async rejectDsar(
    id: string,
    adminId: string,
    reason: string
  ): Promise<Result<unknown, ComplianceError>> {
    try {
      const dsar = await prisma.dsarRequest.findUnique({ where: { id } });
      if (!dsar) return err("NOT_FOUND");

      const updated = await prisma.dsarRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectedAt: new Date(),
          rejectedBy: adminId,
          rejectionReason: reason,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "DSAR_REJECTED",
          resource: "dsar_request",
          resourceId: id,
          userId: adminId,
          details: { reason } as object,
          success: true,
        },
      });

      return ok(updated);
    } catch (error) {
      logger.error({ err: error, id }, "Failed to reject DSAR");
      return err("DATABASE_ERROR");
    }
  }

  async submitDsarRequest(data: {
    requestorEmail: string;
    requestorName?: string;
    type: string;
    accountId?: string;
    jurisdiction?: string;
    ipAddress?: string;
  }): Promise<Result<{ id: string; deadlineAt: Date; message: string }, ComplianceError>> {
    try {
      // Rate limit: max 3 pending per email
      const pendingCount = await prisma.dsarRequest.count({
        where: {
          requestorEmail: data.requestorEmail,
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
      });
      if (pendingCount >= 3) return err("RATE_LIMITED");

      const gdprSettings = await this.getGdprSettings();
      const jurisdiction = data.jurisdiction ?? gdprSettings.defaultJurisdiction;
      const daysToRespond = JURISDICTION_DAYS[jurisdiction] ?? gdprSettings.dsarResponseDays;
      const deadlineAt = new Date(Date.now() + daysToRespond * 24 * 60 * 60 * 1000);

      const request = await prisma.dsarRequest.create({
        data: {
          requestorEmail: data.requestorEmail,
          ...(data.requestorName !== undefined && {
            requestorName: data.requestorName,
          }),
          type: data.type as "EXPORT" | "DELETION" | "ACCESS",
          jurisdiction: jurisdiction as "GDPR" | "LGPD" | "CCPA" | "PIPEDA" | "OTHER",
          deadlineAt,
          verificationToken: crypto.randomUUID(),
          ...(data.accountId !== undefined && { accountId: data.accountId }),
          ...(data.ipAddress !== undefined && { ipAddress: data.ipAddress }),
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "DSAR_SUBMITTED",
          resource: "dsar_request",
          resourceId: request.id,
          details: {
            type: data.type,
            jurisdiction,
            email: data.requestorEmail,
          } as object,
          success: true,
        },
      });

      return ok({
        id: request.id,
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

  async getBreachReports(filters: BreachFilters) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const where: Record<string, unknown> = {};
    if (filters.resolved !== undefined) where.resolved = filters.resolved;

    const [reports, total] = await Promise.all([
      prisma.dataBreachReport.findMany({
        where,
        orderBy: { reportedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.dataBreachReport.count({ where }),
    ]);

    return { reports, total, page, limit };
  }

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
  ): Promise<Result<unknown, ComplianceError>> {
    try {
      const report = await prisma.dataBreachReport.create({
        data: {
          title: data.title,
          description: data.description,
          discoveredAt: new Date(data.discoveredAt),
          severity: data.severity,
          dataTypesAffected: data.dataTypesAffected,
          reportedBy,
          ...(data.affectedUserCount !== undefined && {
            affectedUserCount: data.affectedUserCount,
          }),
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "BREACH_REPORTED",
          resource: "data_breach",
          resourceId: report.id,
          userId: reportedBy,
          details: { title: data.title, severity: data.severity } as object,
          success: true,
        },
      });

      return ok(report);
    } catch (error) {
      logger.error({ err: error }, "Failed to create breach report");
      return err("DATABASE_ERROR");
    }
  }

  async sendBreachNotifications(
    breachId: string,
    adminId: string
  ): Promise<Result<{ notified: number; errors: number }, ComplianceError>> {
    try {
      const breach = await prisma.dataBreachReport.findUnique({
        where: { id: breachId },
      });
      if (!breach) return err("NOT_FOUND");

      const accounts = await prisma.account.findMany({
        where: { isActive: true },
        select: { email: true },
      });

      let notified = 0;
      let errors = 0;

      for (const account of accounts) {
        const result = await this.emailPort.send({
          to: [account.email],
          subject: `Security Notice: ${breach.title}`,
          body: `We are writing to inform you of a data security incident: ${breach.description}. Data types potentially affected: ${breach.dataTypesAffected.join(", ")}. If you have questions, please contact our Data Protection Officer.`,
        });
        if (result.ok) {
          notified++;
        } else {
          errors++;
        }
      }

      await prisma.dataBreachReport.update({
        where: { id: breachId },
        data: {
          notificationSentAt: new Date(),
          notificationSentBy: adminId,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: "BREACH_NOTIFICATIONS_SENT",
          resource: "data_breach",
          resourceId: breachId,
          userId: adminId,
          details: { notified, errors } as object,
          success: true,
        },
      });

      return ok({ notified, errors });
    } catch (error) {
      logger.error({ err: error }, "Failed to send breach notifications");
      return err("DATABASE_ERROR");
    }
  }
}
