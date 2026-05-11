/**
 * @file page.tsx
 * @description Platform settings page for superadmin. Manages encrypted credentials
 *   for payment gateways, email, AI providers, storage, social platforms, and monitoring.
 * @layer infrastructure
 */
"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";

import { useCurrentUser } from "@/providers/AuthProvider";
import { useSettingsStatus } from "@/hooks/api/useSettings";
import { isPermissionDenied, getErrorMessage } from "@packages/api-errors";

import { PageHeader } from "@/components/ui/PageHeader";
import { TabNav } from "@/components/ui/TabNav";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { ActionButton } from "@/components/ui/ActionButton";

import { OverviewTab } from "@/components/settings/OverviewTab";
import { GatewaysTab } from "@/components/settings/GatewaysTab";
import { EmailTab } from "@/components/settings/EmailTab";
import { AiTab } from "@/components/settings/AiTab";
import { StorageTab } from "@/components/settings/StorageTab";
import { SocialTab } from "@/components/settings/SocialTab";
import { PlatformTab } from "@/components/settings/PlatformTab";
import { MonitoringTab } from "@/components/settings/MonitoringTab";
import { SecurityTab } from "@/components/settings/SecurityTab";

const TAB_KEYS = [
  "overview",
  "gateways",
  "email",
  "ai",
  "storage",
  "social",
  "platform",
  "monitoring",
  "security",
] as const;

/**
 * @component SettingsPage
 * @description Platform settings page with tabs for each credential group.
 *   Requires superadmin role. Shows AccessDenied for regular admins.
 */
export default function SettingsPage() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const { isSuperAdmin } = useCurrentUser();

  const [activeTab, setActiveTab] = useState<string>("overview");
  const { data: status, isLoading, error, refetch } = useSettingsStatus();

  const tabs = useMemo(() => TAB_KEYS.map((key) => ({ key, label: t(`tabs.${key}`) })), [t]);

  if (!isSuperAdmin) {
    return (
      <div>
        <PageHeader title={t("title")} />
        <AccessDenied requiredRole="SUPER_ADMIN" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("title")} description={t("description")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={tc("loading")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("title")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("title")} />
        <div className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3">
          <h3 className="text-[var(--error)] font-medium">{t("errorTitle")}</h3>
          <p className="text-[var(--error)] text-sm mt-1">{getErrorMessage(error)}</p>
          <ActionButton variant="danger" size="sm" onClick={() => refetch()} className="mt-2">
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "overview" && status && (
          <OverviewTab status={status} onNavigate={setActiveTab} />
        )}
        {activeTab === "gateways" && <GatewaysTab />}
        {activeTab === "email" && <EmailTab />}
        {activeTab === "ai" && <AiTab />}
        {activeTab === "storage" && <StorageTab />}
        {activeTab === "social" && (
          <SocialTab {...(status?.groups !== undefined && { groupStatus: status.groups })} />
        )}
        {activeTab === "platform" && <PlatformTab />}
        {activeTab === "monitoring" && <MonitoringTab />}
        {activeTab === "security" && <SecurityTab />}
      </div>
    </div>
  );
}
