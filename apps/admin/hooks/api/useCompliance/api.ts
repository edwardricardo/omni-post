/**
 * @file api.ts
 * @description Internal fetch helpers for the compliance endpoints — covers
 *              metrics, GDPR/security settings, score, DSAR workflow, and
 *              breach reports. All errors flow through `ApiError.fromResponse`
 *              so callers see structured admin error messages.
 * @layer infrastructure
 */

import { ApiError } from "@/lib/parseApiError";
import type {
  BackendAuditLogsResponse,
  BackendComplianceMetrics,
  BreachFilters,
  BreachReport,
  BreachResponse,
  ComplianceData,
  ComplianceScoreData,
  CreateBreachInput,
  DsarFilters,
  DsarResponse,
  GdprSettings,
  SecuritySettings,
} from "./types";

function scoreToStatus(score: number): "compliant" | "warning" | "non-compliant" {
  if (score >= 80) return "compliant";
  if (score >= 60) return "warning";
  return "non-compliant";
}

// ---------------------------------------------------------------------------
// Compliance overview
// ---------------------------------------------------------------------------

export async function fetchComplianceOverview(): Promise<ComplianceData> {
  const [metricsResponse, auditLogsResponse] = await Promise.all([
    fetch("/api/backend/admin/compliance/metrics", { credentials: "include" }),
    fetch("/api/backend/admin/compliance/audit-logs", { credentials: "include" }),
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

  const metrics = [
    {
      id: "compliance-score",
      category: "Overall",
      name: "Compliance Score",
      status: scoreToStatus(summary.complianceScore),
      score: summary.complianceScore,
      description: "Overall platform compliance score based on audit activity and success rates.",
      lastChecked: generatedAt,
      requirements: [],
    },
    {
      id: "success-rate",
      category: "Audit",
      name: "Action Success Rate",
      status: scoreToStatus(successRate),
      score: successRate,
      description: "Percentage of audited actions that completed successfully in the last 30 days.",
      lastChecked: generatedAt,
      requirements: [],
    },
    {
      id: "gdpr-compliance",
      category: "GDPR",
      name: "GDPR Compliance",
      status: "compliant" as const,
      score: 100,
      description: "Data subject records are tracked and auditable.",
      lastChecked: generatedAt,
      requirements: [],
    },
  ];

  const auditLogs = auditLogsBody.data.data.map((log) => ({
    id: log.id,
    timestamp: log.createdAt,
    action: log.action,
    user: log.user?.name ?? log.userId ?? "Unknown",
    resource: log.resource ?? "Unknown",
    result: log.success ? ("success" as const) : ("failure" as const),
    details: typeof log.details === "string" ? log.details : JSON.stringify(log.details ?? {}),
  }));

  return { metrics, auditLogs };
}

// ---------------------------------------------------------------------------
// GDPR settings
// ---------------------------------------------------------------------------

export async function fetchGdprSettings(): Promise<GdprSettings> {
  const res = await fetch("/api/backend/admin/compliance/settings/gdpr", {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: GdprSettings };
  if (!json.ok) throw new Error("Failed to fetch GDPR settings");
  return json.data;
}

export async function updateGdprSettings(settings: Partial<GdprSettings>): Promise<GdprSettings> {
  const res = await fetch("/api/backend/admin/compliance/settings/gdpr", {
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
}

// ---------------------------------------------------------------------------
// Security settings
// ---------------------------------------------------------------------------

export async function fetchSecuritySettings(): Promise<SecuritySettings> {
  const res = await fetch("/api/backend/admin/compliance/settings/security", {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: SecuritySettings };
  if (!json.ok) throw new Error("Failed to fetch security settings");
  return json.data;
}

export async function updateSecuritySettings(
  settings: Partial<SecuritySettings>
): Promise<SecuritySettings> {
  const res = await fetch("/api/backend/admin/compliance/settings/security", {
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
}

// ---------------------------------------------------------------------------
// Compliance score
// ---------------------------------------------------------------------------

export async function fetchComplianceScore(): Promise<ComplianceScoreData> {
  const res = await fetch("/api/backend/admin/compliance/score", {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: ComplianceScoreData };
  if (!json.ok) throw new Error("Failed to fetch compliance score");
  return json.data;
}

// ---------------------------------------------------------------------------
// DSAR workflow
// ---------------------------------------------------------------------------

export async function fetchDsarRequests(filters: DsarFilters): Promise<DsarResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.type) params.set("type", filters.type);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const res = await fetch(`/api/backend/admin/compliance/dsar?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: DsarResponse };
  if (!json.ok) throw new Error("Failed to fetch DSAR requests");
  return json.data;
}

export async function acknowledgeDsar(id: string): Promise<void> {
  const res = await fetch(`/api/backend/admin/compliance/dsar/${id}/acknowledge`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
}

export async function completeDsar(params: { id: string; exportUrl?: string }): Promise<void> {
  const res = await fetch(`/api/backend/admin/compliance/dsar/${params.id}/complete`, {
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
}

export async function rejectDsar(params: { id: string; reason: string }): Promise<void> {
  const res = await fetch(`/api/backend/admin/compliance/dsar/${params.id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ reason: params.reason }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
}

// ---------------------------------------------------------------------------
// Breach reports
// ---------------------------------------------------------------------------

export async function fetchBreachReports(filters: BreachFilters): Promise<BreachResponse> {
  const params = new URLSearchParams();
  if (filters.resolved !== undefined) params.set("resolved", String(filters.resolved));
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  const res = await fetch(`/api/backend/admin/compliance/breaches?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data: BreachResponse };
  if (!json.ok) throw new Error("Failed to fetch breach reports");
  return json.data;
}

export async function createBreachReport(input: CreateBreachInput): Promise<BreachReport> {
  const res = await fetch("/api/backend/admin/compliance/breaches", {
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
}

export async function sendBreachNotification(id: string): Promise<void> {
  const res = await fetch(`/api/backend/admin/compliance/breaches/${id}/notify`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
}
