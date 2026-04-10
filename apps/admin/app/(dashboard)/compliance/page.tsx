/**
 * @file page.tsx
 * @description Compliance dashboard page presenting GDPR, security, and audit status metrics.
 *   Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { useCompliance } from "@/hooks/api/useCompliance";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { TabNav } from "@/components/ui/TabNav";
import { ActionButton } from "@/components/ui/ActionButton";

const TAB_KEYS = ["overview", "gdpr", "security", "audit"] as const;

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "neutral"> = {
  compliant: "success",
  warning: "warning",
  "non-compliant": "error",
};

const RESULT_VARIANT: Record<string, "success" | "error"> = {
  success: "success",
  failure: "error",
};

function CompliancePageContent() {
  const tco = useTranslations("compliance");
  const tc = useTranslations("common");
  const { data, isLoading, error } = useCompliance();
  const [activeTab, setActiveTab] = useState("overview");

  const tabs = useMemo(
    () =>
      TAB_KEYS.map((key) => ({
        key,
        label: tco(`tabs.${key}`),
      })),
    [tco]
  );

  const metrics = useMemo(() => data?.metrics ?? [], [data?.metrics]);
  const auditLogs = data?.auditLogs ?? [];

  const overallScore = useMemo(() => {
    if (metrics.length === 0) return 0;
    return Math.round(metrics.reduce((acc, m) => acc + m.score, 0) / metrics.length);
  }, [metrics]);

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
    return (
      <div>
        <PageHeader title={tco("title")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">{tco("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error.message}</p>
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
        )}

        {activeTab === "audit" && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="p-4 border-b border-[var(--border-subtle)]">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {tco("audit.title")}
              </h2>
            </div>
            <div className="divide-y divide-[var(--border-subtle)]">
              {auditLogs.map((log) => (
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
          </div>
        )}

        {(activeTab === "gdpr" || activeTab === "security") && (
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
            <div className="text-center py-8">
              <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
                {activeTab === "gdpr" ? tco("gdprTitle") : tco("securityTitle")}
              </h3>
              <p className="text-[var(--text-secondary)] mb-4">
                {tco("comingSoon", { tab: activeTab })}
              </p>
              <ActionButton variant="primary" size="sm">
                {tco("configureSettings", { tab: activeTab.toUpperCase() })}
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <CompliancePageContent />;
}
