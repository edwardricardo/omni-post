/**
 * @file CredentialForm.tsx
 * @description Reusable form for editing a group of platform credentials.
 *   Shows masked current values as placeholders, accepts new values,
 *   and supports connection testing with inline result display.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";

import {
  useGroupSettings,
  useUpdateGroupSettings,
  useTestConnection,
} from "@/hooks/api/useSettings";
import type { TestResult } from "@/hooks/api/useSettings";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { ActionButton } from "../ui/ActionButton";
import { Badge } from "../ui/Badge";
import type { FieldDef } from "./constants";

interface CredentialFormProps {
  group: string;
  fields: FieldDef[];
  title?: string;
  description?: string;
}

/**
 * @component CredentialForm
 * @description Reusable credential editing form with masked current values,
 *   save (only modified fields), and connection testing.
 * @param props.group - The credential group to edit (e.g. "STRIPE")
 * @param props.fields - Ordered field definitions from buildFieldDefs()
 * @param props.title - Optional section title
 * @param props.description - Optional section description
 */
export function CredentialForm({ group, fields, title, description }: CredentialFormProps) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");

  const { data: current, isLoading } = useGroupSettings(group);
  const updateMutation = useUpdateGroupSettings();
  const testMutation = useTestConnection();

  const [edited, setEdited] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const updateField = useCallback((key: string, value: string) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = Object.values(edited).some((v) => v.length > 0);

  const handleSave = useCallback(async () => {
    const credentials: Record<string, string> = {};
    for (const [key, value] of Object.entries(edited)) {
      if (value.length > 0) {
        credentials[key] = value;
      }
    }
    if (Object.keys(credentials).length === 0) return;

    try {
      await updateMutation.mutateAsync({ group, credentials });
      toast({ title: tc("success"), description: t("form.saveSuccess") });
      setEdited({});
    } catch {
      toast({ title: tc("error"), description: t("form.saveError"), variant: "destructive" });
    }
  }, [edited, group, updateMutation, tc, t]);

  const handleTest = useCallback(async () => {
    setTestResult(null);
    try {
      const result = await testMutation.mutateAsync(group);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "Connection test failed" });
    }
  }, [group, testMutation]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <LoadingSpinner size="md" label={tc("loading")} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      {title && (
        <div className="mb-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && (
            <p className="text-sm text-[var(--text-secondary)] mt-1">{description}</p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field) => {
          const currentValue = current?.[field.key];
          const placeholder =
            currentValue === null || currentValue === undefined
              ? t("form.notConfigured")
              : currentValue;

          return (
            <div key={field.key}>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {field.label}
              </label>
              <input
                type={field.isSecret ? "password" : "text"}
                value={edited[field.key] ?? ""}
                onChange={(e) => updateField(field.key, e.target.value)}
                placeholder={placeholder}
                className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 mt-4">
        <ActionButton
          variant="primary"
          size="sm"
          onClick={handleSave}
          loading={updateMutation.isPending}
          disabled={!isDirty}
        >
          {t("form.save")}
        </ActionButton>
        <ActionButton
          variant="secondary"
          size="sm"
          onClick={handleTest}
          loading={testMutation.isPending}
        >
          {t("form.testConnection")}
        </ActionButton>
      </div>

      {testResult && (
        <div className="flex items-center gap-2 mt-3">
          <Badge variant={testResult.success ? "success" : "error"}>
            {testResult.success ? t("form.testPassed") : t("form.testFailed")}
          </Badge>
          <span className="text-sm text-[var(--text-secondary)]">{testResult.message}</span>
          {testResult.latencyMs !== undefined && (
            <span className="text-xs text-[var(--text-tertiary)]">{testResult.latencyMs}ms</span>
          )}
        </div>
      )}
    </div>
  );
}
