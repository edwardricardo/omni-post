/**
 * @file GdprSettingsForm.tsx
 * @description Form for managing GDPR/privacy settings including DPO configuration,
 *   data retention, DSAR response deadlines, and privacy feature toggles.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  useGdprSettings,
  useUpdateGdprSettings,
  type GdprSettings,
} from "@/hooks/api/useCompliance";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

const JURISDICTIONS = ["GDPR", "CCPA", "LGPD", "PIPEDA"] as const;

/**
 * @component GdprSettingsForm
 * @description Form for managing GDPR/privacy settings including DPO configuration,
 *   data retention policies, DSAR response deadlines, and privacy feature toggles.
 */
export function GdprSettingsForm() {
  const t = useTranslations("compliance.gdpr");
  const tc = useTranslations("common");
  const { data, isLoading } = useGdprSettings();
  const updateMutation = useUpdateGdprSettings();

  const [form, setForm] = useState<Partial<GdprSettings>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        privacyPolicyUrl: data.privacyPolicyUrl,
        termsOfServiceUrl: data.termsOfServiceUrl,
        cookiePolicyUrl: data.cookiePolicyUrl,
        dpoType: data.dpoType,
        dpoEmail: data.dpoEmail,
        dpoUrl: data.dpoUrl,
        dataRetentionDays: data.dataRetentionDays,
        auditLogRetentionDays: data.auditLogRetentionDays,
        autoDeleteExpiredData: data.autoDeleteExpiredData,
        dsarResponseDays: data.dsarResponseDays,
        defaultJurisdiction: data.defaultJurisdiction,
        enableErasure: data.enableErasure,
        enableExport: data.enableExport,
        enableBreachNotification: data.enableBreachNotification,
      });
      setDirty(false);
    }
  }, [data]);

  const updateField = useCallback(
    <K extends keyof GdprSettings>(field: K, value: GdprSettings[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      setDirty(true);
    },
    []
  );

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
        <LoadingSpinner size="md" label={t("privacyPolicyUrl")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* URL Fields */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FieldInput
          label={t("privacyPolicyUrl")}
          value={form.privacyPolicyUrl ?? ""}
          onChange={(v) => updateField("privacyPolicyUrl", v)}
          type="url"
          placeholder="https://..."
        />
        <FieldInput
          label={t("termsOfServiceUrl")}
          value={form.termsOfServiceUrl ?? ""}
          onChange={(v) => updateField("termsOfServiceUrl", v)}
          type="url"
          placeholder="https://..."
        />
        <FieldInput
          label={t("cookiePolicyUrl")}
          value={form.cookiePolicyUrl ?? ""}
          onChange={(v) => updateField("cookiePolicyUrl", v)}
          type="url"
          placeholder="https://..."
        />
      </div>

      {/* DPO Configuration */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("dpoType")}</h3>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
            <input
              type="radio"
              name="dpoType"
              checked={form.dpoType === "internal"}
              onChange={() => updateField("dpoType", "internal")}
              className="accent-[var(--accent)]"
            />
            {t("internal")}
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
            <input
              type="radio"
              name="dpoType"
              checked={form.dpoType === "external"}
              onChange={() => updateField("dpoType", "external")}
              className="accent-[var(--accent)]"
            />
            {t("external")}
          </label>
        </div>
        {form.dpoType === "internal" && (
          <FieldInput
            label={t("dpoEmail")}
            value={form.dpoEmail ?? ""}
            onChange={(v) => updateField("dpoEmail", v)}
            type="email"
            placeholder="dpo@example.com"
          />
        )}
        {form.dpoType === "external" && (
          <FieldInput
            label={t("dpoUrl")}
            value={form.dpoUrl ?? ""}
            onChange={(v) => updateField("dpoUrl", v)}
            type="url"
            placeholder="https://..."
          />
        )}
      </div>

      {/* Retention and DSAR */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FieldInput
          label={t("dataRetentionDays")}
          value={String(form.dataRetentionDays ?? 365)}
          onChange={(v) => updateField("dataRetentionDays", Number(v))}
          type="number"
        />
        <FieldInput
          label={t("auditLogRetentionDays")}
          value={String(form.auditLogRetentionDays ?? 90)}
          onChange={(v) => updateField("auditLogRetentionDays", Number(v))}
          type="number"
        />
        <div>
          <FieldInput
            label={t("dsarResponseDays")}
            value={String(form.dsarResponseDays ?? 30)}
            onChange={(v) => updateField("dsarResponseDays", Number(v))}
            type="number"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">{t("dsarResponseHelper")}</p>
        </div>
      </div>

      {/* Auto-delete Toggle */}
      <ToggleField
        label={t("autoDelete")}
        checked={form.autoDeleteExpiredData ?? false}
        onChange={(v) => updateField("autoDeleteExpiredData", v)}
        warning={t("autoDeleteWarning")}
      />

      {/* Jurisdiction */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
          {t("defaultJurisdiction")}
        </label>
        <select
          value={form.defaultJurisdiction ?? "GDPR"}
          onChange={(e) => updateField("defaultJurisdiction", e.target.value)}
          className="h-8 w-full max-w-xs rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          {JURISDICTIONS.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>

      {/* Feature Toggles */}
      <div className="space-y-2">
        <ToggleField
          label={t("enableErasure")}
          checked={form.enableErasure ?? false}
          onChange={(v) => updateField("enableErasure", v)}
        />
        <ToggleField
          label={t("enableExport")}
          checked={form.enableExport ?? false}
          onChange={(v) => updateField("enableExport", v)}
        />
        <ToggleField
          label={t("enableBreachNotification")}
          checked={form.enableBreachNotification ?? false}
          onChange={(v) => updateField("enableBreachNotification", v)}
        />
      </div>

      {/* Save + Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
        <div className="text-xs text-[var(--text-tertiary)]">
          {data?.updatedBy &&
            data?.updatedAt &&
            t("lastUpdated", {
              user: data.updatedBy,
              date: new Date(data.updatedAt).toLocaleString(),
            })}
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
// Helper sub-components
// ---------------------------------------------------------------------------

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  warning,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  warning?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors",
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
      <div>
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
        {warning && checked && (
          <p className="text-[10px] text-[var(--warning)] mt-0.5">{warning}</p>
        )}
      </div>
    </div>
  );
}
