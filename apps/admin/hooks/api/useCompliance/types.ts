/**
 * @file types.ts
 * @description Public types for the compliance hook module — covers the
 *              compliance overview (metrics + audit logs), GDPR/security
 *              settings, the compliance score, DSAR (data subject access
 *              request) workflow, and breach reports.
 * @layer infrastructure
 */

// ---------------------------------------------------------------------------
// Compliance overview
// ---------------------------------------------------------------------------

export type ComplianceStatus = "compliant" | "warning" | "non-compliant";

export interface ComplianceMetric {
  id: string;
  category: string;
  name: string;
  status: ComplianceStatus;
  score: number;
  description: string;
  lastChecked: string;
  requirements: string[];
  actions?: string[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  resource: string;
  result: "success" | "failure";
  details: string;
}

export interface ComplianceData {
  metrics: ComplianceMetric[];
  auditLogs: AuditEvent[];
}

// ---------------------------------------------------------------------------
// Backend wire shapes — used by api.ts mappers
// ---------------------------------------------------------------------------

export interface BackendComplianceMetrics {
  summary: {
    complianceScore: number;
    totalAuditLogs: number;
    auditLogsLast30Days: number;
    auditLogsLast7Days: number;
    failedActionsLast30Days: number;
    successRate: number;
  };
  userActivity: { uniqueUsersLast30Days: number };
  topActions: Array<{ action: string; count: number }>;
  topResources: Array<{ resource: string; count: number }>;
  gdpr: {
    totalDataSubjects: number;
    exportRequests: number;
    deletionRequests: number;
  };
  generatedAt: string;
}

export interface BackendAuditLog {
  id: string;
  userId: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
  action: string;
  resource: string | null;
  resourceId: string | null;
  details: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  error: string | null;
  createdAt: string;
}

export interface BackendAuditLogsResponse {
  ok: true;
  data: BackendAuditLog[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

// ---------------------------------------------------------------------------
// GDPR
// ---------------------------------------------------------------------------

export interface GdprSettings {
  privacyPolicyUrl: string;
  termsOfServiceUrl: string;
  cookiePolicyUrl: string;
  dpoType: "internal" | "external";
  dpoEmail: string;
  dpoUrl: string;
  dataRetentionDays: number;
  auditLogRetentionDays: number;
  autoDeleteExpiredData: boolean;
  dsarResponseDays: number;
  defaultJurisdiction: string;
  enableErasure: boolean;
  enableExport: boolean;
  enableBreachNotification: boolean;
  updatedBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export interface SecuritySettings {
  require2FA: boolean;
  sessionTimeoutMinutes: number;
  maxLoginAttempts: number;
  passwordMinLength: number;
  requireUppercase: boolean;
  requireSpecialChar: boolean;
  ipAllowlistEnabled: boolean;
  ipAllowlist: string[];
  updatedBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Compliance score
// ---------------------------------------------------------------------------

export interface ComplianceCheck {
  key: string;
  label: string;
  weight: number;
  passing: boolean;
  detail?: string;
}

export interface ComplianceScoreData {
  score: number;
  checks: ComplianceCheck[];
}

// ---------------------------------------------------------------------------
// DSAR (Data Subject Access Request)
// ---------------------------------------------------------------------------

export type DsarStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "EXPIRED";

export interface DsarRequest {
  id: string;
  email: string;
  type: string;
  jurisdiction: string;
  status: DsarStatus;
  deadline: string;
  createdAt: string;
  completedAt: string | null;
  exportUrl: string | null;
  rejectionReason: string | null;
}

export interface DsarFilters {
  status?: string;
  type?: string;
  page?: number;
  limit?: number;
}

export interface DsarResponse {
  requests: DsarRequest[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Breach reports
// ---------------------------------------------------------------------------

export type BreachSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface BreachReport {
  id: string;
  title: string;
  description: string;
  severity: BreachSeverity;
  discoveredAt: string;
  affectedUsers: number;
  dataTypes: string[];
  notificationsSent: boolean;
  resolved: boolean;
  createdAt: string;
}

export interface BreachFilters {
  resolved?: boolean;
  page?: number;
  limit?: number;
}

export interface BreachResponse {
  reports: BreachReport[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateBreachInput {
  title: string;
  description: string;
  severity: BreachSeverity;
  discoveredAt: string;
  affectedUsers: number;
  dataTypes: string[];
}
