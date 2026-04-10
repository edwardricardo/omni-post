/**
 * @file page.tsx
 * @description Security overview page displaying security stats, MFA adoption rate, and RBAC
 *   hierarchy summary. Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useSecurityOverview } from "@/hooks/api/useSecurity";
import { useChangePassword } from "@/hooks/api/useChangePassword";
import RbacManager from "@/components/security/RbacManager";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";

function SecurityPageContent() {
  const t = useTranslations("nav");
  const ts = useTranslations("security");
  const tc = useTranslations("common");
  const { data, isLoading, error } = useSecurityOverview();

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("security")} />
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
          <PageHeader title={t("security")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("security")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">{ts("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{getErrorMessage(error)}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title={t("security")} />
        <div className="text-center text-[var(--text-secondary)]">{ts("noData")}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("security")} description={ts("description")} />

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        <StatCard
          label={ts("overview.securityStatus")}
          value={
            data.securityStats.status === "healthy"
              ? tc("healthy")
              : data.securityStats.status === "warning"
                ? tc("warning")
                : tc("critical")
          }
        />
        <StatCard
          label={ts("overview.mfaAdoption")}
          value={`${Number(data.mfaOverview.enablementRate).toFixed(0)}%`}
        />
        <StatCard
          label={ts("overview.activeRoles")}
          value={String(data.securityStats.statistics.totalRoles)}
        />
      </div>

      {/* Role Distribution */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {ts("roleDistribution")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {data.securityStats.statistics.roleDistribution.map((role) => (
            <div key={role.role} className="border border-[var(--border-subtle)] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[var(--text-primary)]">{role.role}</span>
                <span className="text-sm text-[var(--text-secondary)]">
                  {Number(role.percentage).toFixed(1)}%
                </span>
              </div>
              <div className="w-full bg-[var(--bg-elevated)] rounded-full h-2">
                <div
                  className="bg-[var(--accent)] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${role.percentage}%` }}
                />
              </div>
              <div className="text-sm text-[var(--text-secondary)] mt-1">
                {ts("rbac.userCount", { count: role.userCount })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Role-Based Access Control */}
      <div className="mb-3">
        <RbacManager />
      </div>

      {/* Quick Actions */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          {ts("quickActions.title")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/security/mfa"
            className="p-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-center hover:border-[var(--success)] hover:bg-[var(--success-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text-primary)]">
              {ts("quickActions.mfaSettings")}
            </div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              {ts("quickActions.mfaSettingsDesc")}
            </div>
          </Link>
          <Link
            href="/compliance"
            className="p-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-center hover:border-[var(--info)] hover:bg-[var(--info-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text-primary)]">
              {ts("quickActions.securityAudit")}
            </div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              {ts("quickActions.securityAuditDesc")}
            </div>
          </Link>
        </div>
      </div>

      {/* Change Password */}
      <ChangePasswordSection />
    </div>
  );
}

function ChangePasswordSection() {
  const ts = useTranslations("security");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState("");
  const changePassword = useChangePassword();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setValidationError("");

      if (newPassword !== confirmPassword) {
        setValidationError(ts("changePassword.passwordsMismatch"));
        return;
      }
      if (newPassword.length < 12) {
        setValidationError(ts("changePassword.minLength"));
        return;
      }
      if (!/[A-Z]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireUppercase"));
        return;
      }
      if (!/[0-9]/.test(newPassword)) {
        setValidationError(ts("changePassword.requireNumber"));
        return;
      }

      changePassword.mutate(
        { currentPassword, newPassword },
        {
          onSuccess: () => {
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
          },
        }
      );
    },
    [currentPassword, newPassword, confirmPassword, changePassword, ts]
  );

  const inputClass =
    "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mt-4">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
        {ts("changePassword.title")}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label
            htmlFor="current-password"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            {ts("changePassword.currentPassword")}
          </label>
          <input
            id="current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="new-password"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            {ts("changePassword.newPassword")}
          </label>
          <input
            id="new-password"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            {ts("changePassword.confirmPassword")}
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        {validationError && (
          <p className="text-sm text-[var(--error)]" role="alert">
            {validationError}
          </p>
        )}
        {changePassword.isError && (
          <p className="text-sm text-[var(--error)]" role="alert">
            {getErrorMessage(changePassword.error)}
          </p>
        )}
        <ActionButton variant="primary" size="sm" loading={changePassword.isPending} type="submit">
          {ts("changePassword.button")}
        </ActionButton>
      </form>
    </div>
  );
}

export default function Page() {
  return <SecurityPageContent />;
}
