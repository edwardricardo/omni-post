/**
 * @file SecuritySettingsForm.tsx
 * @description Form for managing security compliance settings including 2FA requirements,
 *   session timeouts, password policies, and IP allowlisting.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useEffect, useId } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  useSecuritySettings,
  useUpdateSecuritySettings,
  type SecuritySettings,
} from "@/hooks/api/useCompliance";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

const SESSION_TIMEOUT_OPTIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 480, label: "8 hours" },
  { value: 1440, label: "24 hours" },
] as const;

/**
 * @component SecuritySettingsForm
 * @description Form for managing security compliance settings including 2FA requirements,
 *   session timeouts, password policies, and IP allowlisting.
 */
export function SecuritySettingsForm() {
  const t = useTranslations("compliance.security");
  const tc = useTranslations("common");
  const { data, isLoading } = useSecuritySettings();
  const updateMutation = useUpdateSecuritySettings();

  const [form, setForm] = useState<Partial<SecuritySettings>>({});
  const [ipText, setIpText] = useState("");
  const [dirty, setDirty] = useState(false);

  const sessionTimeoutId = useId();
  const maxLoginAttemptsId = useId();
  const passwordMinLengthId = useId();

  useEffect(() => {
    if (data) {
      setForm({
        require2FA: data.require2FA,
        sessionTimeoutMinutes: data.sessionTimeoutMinutes,
        maxLoginAttempts: data.maxLoginAttempts,
        passwordMinLength: data.passwordMinLength,
        requireUppercase: data.requireUppercase,
        requireSpecialChar: data.requireSpecialChar,
        ipAllowlistEnabled: data.ipAllowlistEnabled,
        ipAllowlist: data.ipAllowlist,
      });
      setIpText((data.ipAllowlist ?? []).join("\n"));
      setDirty(false);
    }
  }, [data]);

  const updateField = useCallback(
    <K extends keyof SecuritySettings>(field: K, value: SecuritySettings[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setDirty(true);
    },
    []
  );

  const handleIpTextChange = useCallback((text: string) => {
    setIpText(text);
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    setForm((prev) => ({ ...prev, ipAllowlist: lines }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    try {
      await updateMutation.mutateAsync(form);
      toast({ title: tc("success"), description: t("settingsSaved") });
      setDirty(false);
    } catch {
      toast({ title: tc("error"), variant: "destructive" });
    }
  }, [form, updateMutation, t, tc]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <LoadingSpinner size="md" label={t("require2FA")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 2FA Toggle */}
      <ToggleField
        label={t("require2FA")}
        checked={form.require2FA ?? false}
        onChange={(v) => updateField("require2FA", v)}
      />

      {/* Session & Login */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor={sessionTimeoutId}
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
          >
            {t("sessionTimeout")}
          </label>
          <select
            id={sessionTimeoutId}
            value={form.sessionTimeoutMinutes ?? 60}
            onChange={(e) => updateField("sessionTimeoutMinutes", Number(e.target.value))}
            className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            {SESSION_TIMEOUT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor={maxLoginAttemptsId}
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
          >
            {t("maxLoginAttempts")}
          </label>
          <input
            id={maxLoginAttemptsId}
            type="number"
            min={1}
            max={20}
            value={form.maxLoginAttempts ?? 5}
            onChange={(e) => updateField("maxLoginAttempts", Number(e.target.value))}
            className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      {/* Password Policy */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {t("passwordMinLength")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor={passwordMinLengthId}
              className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
            >
              {t("passwordMinLength")}
            </label>
            <input
              id={passwordMinLengthId}
              type="number"
              min={6}
              max={128}
              value={form.passwordMinLength ?? 8}
              onChange={(e) => updateField("passwordMinLength", Number(e.target.value))}
              className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
        <ToggleField
          label={t("requireUppercase")}
          checked={form.requireUppercase ?? false}
          onChange={(v) => updateField("requireUppercase", v)}
        />
        <ToggleField
          label={t("requireSpecialChar")}
          checked={form.requireSpecialChar ?? false}
          onChange={(v) => updateField("requireSpecialChar", v)}
        />
      </div>

      {/* IP Allowlist */}
      <div className="space-y-2">
        <ToggleField
          label={t("ipAllowlistEnabled")}
          checked={form.ipAllowlistEnabled ?? false}
          onChange={(v) => updateField("ipAllowlistEnabled", v)}
        />
        {form.ipAllowlistEnabled && (
          <div>
            <p className="text-[10px] text-[var(--text-tertiary)] mb-1">{t("ipAllowlistHelper")}</p>
            <textarea
              value={ipText}
              onChange={(e) => handleIpTextChange(e.target.value)}
              rows={4}
              placeholder="192.168.1.0/24&#10;10.0.0.1"
              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] font-mono focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
            />
          </div>
        )}
      </div>

      {/* Save + Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
        <div className="text-xs text-[var(--text-tertiary)]">
          {data?.updatedBy &&
            data?.updatedAt &&
            `Last updated by ${data.updatedBy} at ${new Date(data.updatedAt).toLocaleString()}`}
        </div>
        <ActionButton
          variant="primary"
          size="md"
          loading={updateMutation.isPending}
          disabled={!dirty}
          onClick={handleSave}
        >
          {tc("save")}
        </ActionButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle sub-component
// ---------------------------------------------------------------------------

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
          checked
            ? "bg-[var(--accent)]"
            : "bg-[var(--bg-elevated)] border border-[var(--border-default)]",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
            "mt-[1px]",
          ].join(" ")}
        />
      </button>
      <span className="text-sm text-[var(--text-primary)]">{label}</span>
    </div>
  );
}
