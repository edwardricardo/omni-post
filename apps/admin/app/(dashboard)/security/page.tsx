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

import { useSecurityOverview } from "@/hooks/api/useSecurity";
import { useChangePassword } from "@/hooks/api/useChangePassword";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";

function SecurityPageContent() {
  const t = useTranslations("nav");
  const { data, isLoading, error } = useSecurityOverview();

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("security")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label="Loading security data..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("security")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">Error Loading Security Dashboard</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <PageHeader title={t("security")} />
        <div className="text-center text-[var(--text-secondary)]">No security data available</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t("security")} description="Monitor and manage system security settings" />

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        <StatCard label="Security Status" value={data.securityStats.status.toUpperCase()} />
        <StatCard
          label="MFA Adoption"
          value={`${Number(data.mfaOverview.enablementRate).toFixed(0)}%`}
        />
        <StatCard label="Active Roles" value={String(data.securityStats.statistics.totalRoles)} />
      </div>

      {/* Role Distribution */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Role Distribution</h2>
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
                {role.userCount} users
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Permission Hierarchy */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mb-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          Permission Hierarchy
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Role Levels</h3>
            <div className="space-y-2">
              {Object.entries(data.rbacOverview.hierarchy)
                .sort(([, a], [, b]) => b.level - a.level)
                .map(([role, info]) => (
                  <div
                    key={role}
                    className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] rounded-md"
                  >
                    <span className="font-medium text-[var(--text-primary)]">{info.name}</span>
                    <span className="text-sm text-[var(--text-secondary)]">Level {info.level}</span>
                  </div>
                ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
              Permission Categories
            </h3>
            <div className="space-y-2">
              {Object.entries(data.rbacOverview.permissionCategories).map(([category, perms]) => (
                <div
                  key={category}
                  className="flex items-center justify-between p-2 bg-[var(--bg-elevated)] rounded-md"
                >
                  <span className="font-medium text-[var(--text-primary)]">{category}</span>
                  <span className="text-sm text-[var(--text-secondary)]">
                    {perms.length} permissions
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/security/rbac"
            className="p-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-center hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text-primary)]">Manage User Roles</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              View and modify user permissions
            </div>
          </Link>
          <Link
            href="/security/mfa"
            className="p-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-center hover:border-[var(--success)] hover:bg-[var(--success-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text-primary)]">MFA Settings</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              Configure multi-factor authentication
            </div>
          </Link>
          <Link
            href="/compliance"
            className="p-3 border-2 border-dashed border-[var(--border-default)] rounded-lg text-center hover:border-[var(--info)] hover:bg-[var(--info-subtle)] transition-colors"
          >
            <div className="text-sm font-medium text-[var(--text-primary)]">Security Audit</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">
              Review security logs and events
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
        setValidationError("Passwords do not match");
        return;
      }
      if (newPassword.length < 12) {
        setValidationError("Password must be at least 12 characters");
        return;
      }
      if (!/[A-Z]/.test(newPassword)) {
        setValidationError("Password must contain at least one uppercase letter");
        return;
      }
      if (!/[0-9]/.test(newPassword)) {
        setValidationError("Password must contain at least one number");
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
    [currentPassword, newPassword, confirmPassword, changePassword]
  );

  const inputClass =
    "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 mt-4">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Change Password</h2>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label
            htmlFor="current-password"
            className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
          >
            Current Password
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
            New Password
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
            Confirm New Password
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
            {changePassword.error instanceof Error
              ? changePassword.error.message
              : "Failed to change password"}
          </p>
        )}
        <ActionButton variant="primary" size="sm" loading={changePassword.isPending} type="submit">
          Change Password
        </ActionButton>
      </form>
    </div>
  );
}

export default function Page() {
  return <SecurityPageContent />;
}
