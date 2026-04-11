/**
 * @file useCompliance.ts
 * @description TanStack Query hooks for compliance metrics, GDPR/security settings,
 *   DSAR requests, and breach reports. All mutations invalidate the ["compliance"] query family.
 * @layer hooks
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

interface ComplianceMetric {
  id: string;
  category: string;
  name: string;
  status: "compliant" | "warning" | "non-compliant";
  score: number;
  description: string;
  lastChecked: string;
  requirements: string[];
  actions?: string[];
}

interface AuditEvent {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  resource: string;
  result: "success" | "failure";
  details: string;
}

interface ComplianceData {
  metrics: ComplianceMetric[];
  auditLogs: AuditEvent[];
}

interface BackendComplianceMetrics {
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

interface BackendAuditLog {
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

interface BackendAuditLogsResponse {
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

function scoreToStatus(score: number): "compliant" | "warning" | "non-compliant" {
  if (score >= 80) return "compliant";
  if (score >= 60) return "warning";
  return "non-compliant";
}

export function useCompliance() {
  return useQuery({
    queryKey: ["compliance", "overview"],
    queryFn: async (): Promise<ComplianceData> => {
      const [metricsResponse, auditLogsResponse] = await Promise.all([
        fetch("/api/backend/api/admin/compliance/metrics"),
        fetch("/api/backend/api/admin/compliance/audit-logs"),
      ]);

      if (!metricsResponse.ok) {
        const body = await metricsResponse.text().catch(() => "");
        throw ApiError.fromResponse(metricsResponse.status, body);
      }

      if (!auditLogsResponse.ok) {
        const body = await auditLogsResponse.text().catch(() => "");
        throw ApiError.fromResponse(auditLogsResponse.status, body);
      }

      const metricsBody = (await metricsResponse.json()) as {
        ok: boolean;
        data: BackendComplianceMetrics;
      };

      const auditLogsBody = (await auditLogsResponse.json()) as {
        ok: boolean;
        data: BackendAuditLogsResponse;
      };

      if (!metricsBody.ok || !metricsBody.data) {
        throw new Error("Failed to fetch compliance metrics");
      }

      if (!auditLogsBody.ok || !auditLogsBody.data) {
        throw new Error("Failed to fetch compliance audit logs");
      }

      const { summary, generatedAt } = metricsBody.data;
      const { successRate } = summary;

      const metrics: ComplianceMetric[] = [
        {
          id: "compliance-score",
          category: "Overall",
          name: "Compliance Score",
          status: scoreToStatus(summary.complianceScore),
          score: summary.complianceScore,
          description:
            "Overall platform compliance score based on audit activity and success rates.",
          lastChecked: generatedAt,
          requirements: [],
        },
        {
          id: "success-rate",
          category: "Audit",
          name: "Action Success Rate",
          status: scoreToStatus(successRate),
          score: successRate,
          description:
            "Percentage of audited actions that completed successfully in the last 30 days.",
          lastChecked: generatedAt,
          requirements: [],
        },
        {
          id: "gdpr-compliance",
          category: "GDPR",
          name: "GDPR Compliance",
          status: "compliant",
          score: 100,
          description: "Data subject records are tracked and auditable.",
          lastChecked: generatedAt,
          requirements: [],
        },
      ];

      const auditLogs: AuditEvent[] = auditLogsBody.data.data.map((log) => ({
        id: log.id,
        timestamp: log.createdAt,
        action: log.action,
        user: log.user?.name ?? log.userId ?? "Unknown",
        resource: log.resource ?? "Unknown",
        result: log.success ? "success" : "failure",
        details: typeof log.details === "string" ? log.details : JSON.stringify(log.details ?? {}),
      }));

      return { metrics, auditLogs };
    },
    staleTime: 60000, // 1 minute
  });
}

// ---------------------------------------------------------------------------
// GDPR Settings
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

export function useGdprSettings() {
  return useQuery({
    queryKey: ["compliance", "gdpr-settings"],
    queryFn: async (): Promise<GdprSettings> => {
      const res = await fetch("/api/backend/api/admin/compliance/settings/gdpr", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: GdprSettings };
      if (!json.ok) throw new Error("Failed to fetch GDPR settings");
      return json.data;
    },
    staleTime: 60000,
  });
}

export function useUpdateGdprSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<GdprSettings>): Promise<GdprSettings> => {
      const res = await fetch("/api/backend/api/admin/compliance/settings/gdpr", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: GdprSettings };
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Security Settings
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

export function useSecuritySettings() {
  return useQuery({
    queryKey: ["compliance", "security-settings"],
    queryFn: async (): Promise<SecuritySettings> => {
      const res = await fetch("/api/backend/api/admin/compliance/settings/security", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: SecuritySettings };
      if (!json.ok) throw new Error("Failed to fetch security settings");
      return json.data;
    },
    staleTime: 60000,
  });
}

export function useUpdateSecuritySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<SecuritySettings>): Promise<SecuritySettings> => {
      const res = await fetch("/api/backend/api/admin/compliance/settings/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: SecuritySettings };
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Compliance Score
// ---------------------------------------------------------------------------

export interface ComplianceCheck {
  id: string;
  label: string;
  passed: boolean;
  category: string;
}

export interface ComplianceScoreData {
  score: number;
  checks: ComplianceCheck[];
}

export function useComplianceScore() {
  return useQuery({
    queryKey: ["compliance", "score"],
    queryFn: async (): Promise<ComplianceScoreData> => {
      const res = await fetch("/api/backend/api/admin/compliance/score", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: ComplianceScoreData };
      if (!json.ok) throw new Error("Failed to fetch compliance score");
      return json.data;
    },
    refetchInterval: 60000,
  });
}

// ---------------------------------------------------------------------------
// DSAR Requests
// ---------------------------------------------------------------------------

export interface DsarRequest {
  id: string;
  email: string;
  type: string;
  jurisdiction: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "EXPIRED";
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

interface DsarResponse {
  requests: DsarRequest[];
  total: number;
  page: number;
  limit: number;
}

export function useDsarRequests(filters: DsarFilters) {
  return useQuery({
    queryKey: ["compliance", "dsar", filters],
    queryFn: async (): Promise<DsarResponse> => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.type) params.set("type", filters.type);
      if (filters.page) params.set("page", String(filters.page));
      if (filters.limit) params.set("limit", String(filters.limit));
      const res = await fetch(`/api/backend/api/admin/compliance/dsar?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: DsarResponse };
      if (!json.ok) throw new Error("Failed to fetch DSAR requests");
      return json.data;
    },
    staleTime: 30000,
  });
}

export function useAcknowledgeDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/backend/api/admin/compliance/dsar/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

export function useCompleteDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; exportUrl?: string }): Promise<void> => {
      const res = await fetch(`/api/backend/api/admin/compliance/dsar/${params.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...(params.exportUrl !== undefined && { exportUrl: params.exportUrl }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

export function useRejectDsar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; reason: string }): Promise<void> => {
      const res = await fetch(`/api/backend/api/admin/compliance/dsar/${params.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reason: params.reason }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Breach Reports
// ---------------------------------------------------------------------------

export interface BreachReport {
  id: string;
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
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

interface BreachResponse {
  reports: BreachReport[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateBreachInput {
  title: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  discoveredAt: string;
  affectedUsers: number;
  dataTypes: string[];
}

export function useBreachReports(filters: BreachFilters) {
  return useQuery({
    queryKey: ["compliance", "breaches", filters],
    queryFn: async (): Promise<BreachResponse> => {
      const params = new URLSearchParams();
      if (filters.resolved !== undefined) params.set("resolved", String(filters.resolved));
      if (filters.page) params.set("page", String(filters.page));
      if (filters.limit) params.set("limit", String(filters.limit));
      const res = await fetch(`/api/backend/api/admin/compliance/breaches?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: BreachResponse };
      if (!json.ok) throw new Error("Failed to fetch breach reports");
      return json.data;
    },
    staleTime: 30000,
  });
}

export function useCreateBreachReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBreachInput): Promise<BreachReport> => {
      const res = await fetch("/api/backend/api/admin/compliance/breaches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = (await res.json()) as { ok: boolean; data: BreachReport };
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}

export function useSendBreachNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await fetch(`/api/backend/api/admin/compliance/breaches/${id}/notify`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["compliance"] });
    },
  });
}
