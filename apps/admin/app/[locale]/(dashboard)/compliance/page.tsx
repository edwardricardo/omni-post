/**
 * @file page.tsx
 * @description Compliance dashboard page with five tabs: Overview (metrics + checklist),
 *   GDPR (settings + DSAR), Security (settings), Breaches (reports), and Audit (logs).
 * @layer infrastructure
 */
"use client";

import { useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useCompliance, useComplianceScore } from "@/hooks/api/useCompliance";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { TabNav } from "@/components/ui/TabNav";
import { Pagination } from "@/components/ui/Pagination";
import { GdprSettingsForm } from "@/components/compliance/GdprSettingsForm";
import { DsarTable } from "@/components/compliance/DsarTable";
import { SecuritySettingsForm } from "@/components/compliance/SecuritySettingsForm";
import { BreachTable } from "@/components/compliance/BreachTable";

const TAB_KEYS = ["overview", "gdpr", "security", "breaches", "audit"] as const;

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  compliant: "success",
  warning: "warning",
  "non-compliant": "error",
};

const RESULT_VARIANT: Record<string, "success" | "error"> = {
  success: "success",
  failure: "error",
};

/** Maps compliance check categories to tab keys for click navigation. */
const SECURITY_KEYS = new Set(["session_timeout", "login_protection"]);

function checkKeyToTab(key: string): string {
  if (SECURITY_KEYS.has(key)) return "security";
  return "gdpr";
}

function CompliancePageContent() {
  const tco = useTranslations("compliance");
  const tc = useTranslations("common");
  const { data, isLoading, error } = useCompliance();
  const { data: scoreData } = useComplianceScore();
  const [activeTab, setActiveTab] = useState("overview");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPerPage, setAuditPerPage] = useState(25);

  const tabs = useMemo(
    () =>
      TAB_KEYS.map((key) => ({
        key,
        label: tco(`tabs.${key}`),
      })),
    [tco]
  );

  const metrics = useMemo(() => data?.metrics ?? [], [data?.metrics]);
  const auditLogs = useMemo(() => data?.auditLogs ?? [], [data?.auditLogs]);
  const auditTotalPages = Math.max(1, Math.ceil(auditLogs.length / auditPerPage));
  const paginatedAuditLogs = useMemo(
    () => auditLogs.slice((auditPage - 1) * auditPerPage, auditPage * auditPerPage),
    [auditLogs, auditPage, auditPerPage]
  );

  const overallScore = useMemo(() => {
    if (metrics.length === 0) return 0;
    return Math.round(metrics.reduce((acc, m) => acc + m.score, 0) / metrics.length);
  }, [metrics]);

  const handleCheckClick = useCallback((key: string) => {
    setActiveTab(checkKeyToTab(key));
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={tco("title")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={tco("title")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={tco("title")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={tco("title")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">{tco("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{getErrorMessage(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={tco("title")} description={tco("description")} />

      {/* Overall Score */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {tco("overallScore")}
          </h2>
          <span className="text-2xl font-bold text-[var(--text-primary)]">{overallScore}%</span>
        </div>
        <div className="w-full bg-[var(--bg-elevated)] rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              overallScore >= 90
                ? "bg-[var(--success)]"
                : overallScore >= 75
                  ? "bg-[var(--warning)]"
                  : "bg-[var(--error)]"
            }`}
            style={{ width: `${overallScore}%` }}
          />
        </div>
      </div>

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Metric Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {metrics.map((metric) => (
                <div
                  key={metric.id}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {metric.name}
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)]">{metric.description}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[metric.status] ?? "neutral"}>
                      {metric.status === "compliant"
                        ? tc("healthy")
                        : metric.status === "warning"
                          ? tc("warning")
                          : metric.status === "non-compliant"
                            ? tc("critical")
                            : metric.status}
                    </Badge>
                  </div>
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-[var(--text-secondary)]">
                        {tco("complianceScore")}
                      </span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {metric.score}%
                      </span>
                    </div>
                    <div className="w-full bg-[var(--bg-elevated)] rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          metric.score >= 90
                            ? "bg-[var(--success)]"
                            : metric.score >= 75
                              ? "bg-[var(--warning)]"
                              : "bg-[var(--error)]"
                        }`}
                        style={{ width: `${metric.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    {tco("lastChecked", { date: new Date(metric.lastChecked).toLocaleString() })}
                  </div>
                </div>
              ))}
            </div>

            {/* Compliance Checklist */}
            {scoreData && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {tco("score.title")}
                  </h3>
                  <div className="flex gap-3 text-xs">
                    <span className="text-[var(--success)]">
                      {tco("score.passing")}: {scoreData.checks.filter((c) => c.passing).length}
                    </span>
                    <span className="text-[var(--error)]">
                      {tco("score.failing")}: {scoreData.checks.filter((c) => !c.passing).length}
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {scoreData.checks.map((check) => (
                    <button
                      key={check.key}
                      type="button"
                      onClick={() => handleCheckClick(check.key)}
                      disabled={check.passing}
                      className={[
                        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm transition-colors",
                        check.passing
                          ? "text-[var(--text-secondary)] cursor-default"
                          : "text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center text-[10px]",
                          check.passing
                            ? "bg-[var(--success-subtle)] text-[var(--success)]"
                            : "bg-[var(--error-subtle)] text-[var(--error)]",
                        ].join(" ")}
                      >
                        {check.passing ? "\u2713" : "\u2717"}
                      </span>
                      <span>{check.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "gdpr" && (
          <div className="space-y-6">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {tco("gdprTitle")}
              </h2>
              <GdprSettingsForm />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <DsarTable />
            </div>
          </div>
        )}

        {activeTab === "security" && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
              {tco("securityTitle")}
            </h2>
            <SecuritySettingsForm />
          </div>
        )}

        {activeTab === "breaches" && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
            <BreachTable />
          </div>
        )}

        {activeTab === "audit" && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="p-4 border-b border-[var(--border-subtle)]">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {tco("audit.title")}
              </h2>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {paginatedAuditLogs.map((log) => (
                <div key={log.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Badge variant={RESULT_VARIANT[log.result] ?? "neutral"}>
                          {log.result === "success"
                            ? tc("success")
                            : log.result === "failure"
                              ? tc("error")
                              : log.result}
                        </Badge>
                        <span className="font-medium text-[var(--text-primary)]">
                          {log.action.replace("_", " ")}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-[var(--text-secondary)]">
                        <span className="font-medium">{log.user}</span> → {log.resource}
                      </div>
                    </div>
                    <div className="text-sm text-[var(--text-tertiary)]">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-[var(--border-subtle)]">
              <Pagination
                page={auditPage}
                totalPages={auditTotalPages}
                totalItems={auditLogs.length}
                perPage={auditPerPage}
                onPageChange={setAuditPage}
                onPerPageChange={(n) => {
                  setAuditPerPage(n);
                  setAuditPage(1);
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * @component CompliancePage
 * @description Displays the compliance dashboard with GDPR settings, DSAR requests, security controls, breach reports, and audit logs.
 */
export default function Page() {
  return <CompliancePageContent />;
}
