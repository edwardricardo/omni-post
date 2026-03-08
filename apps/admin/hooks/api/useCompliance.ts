/**
 * @file useCompliance.ts
 * @description TanStack Query hook for fetching compliance metrics and audit event records.
 * Transforms backend compliance data into frontend-ready ComplianceMetric and AuditEvent shapes.
 */
import { useQuery } from "@tanstack/react-query";

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
        const text = await metricsResponse.text().catch(() => "Unknown error");
        throw new Error(`HTTP ${metricsResponse.status}: ${text}`);
      }

      if (!auditLogsResponse.ok) {
        const text = await auditLogsResponse.text().catch(() => "Unknown error");
        throw new Error(`HTTP ${auditLogsResponse.status}: ${text}`);
      }

      const metricsBody = (await metricsResponse.json()) as {
        ok: boolean;
        value: BackendComplianceMetrics;
      };

      const auditLogsBody = (await auditLogsResponse.json()) as {
        ok: boolean;
        value: BackendAuditLogsResponse;
      };

      if (!metricsBody.ok) {
        throw new Error("Failed to fetch compliance metrics");
      }

      if (!auditLogsBody.ok) {
        throw new Error("Failed to fetch compliance audit logs");
      }

      const { summary, generatedAt } = metricsBody.value;
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

      const auditLogs: AuditEvent[] = auditLogsBody.value.data.map((log) => ({
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
