"use client";

/**
 * @file PromptTemplateManager.tsx
 * @description Manages AI prompt templates. Lists system templates
 *              (read-only) and account templates (editable). Composes
 *              `TemplateCard` and `CreateTemplateForm` from the
 *              `./promptTemplateManager/` sub-folder; derived arrays
 *              (`categories`, `filtered`, `systemTemplates`,
 *              `accountTemplates`) are memoised so re-renders driven
 *              by the filter or modal state don't re-walk `templates`.
 * @component PromptTemplateManager
 * @layer infrastructure
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@packages/ui";
import { useAIPromptTemplates, useDeleteAIPromptTemplate } from "@/hooks/api/useAIPromptTemplates";
import { CreateTemplateForm, TemplateCard } from "./promptTemplateManager/index.js";

interface PromptTemplateManagerProps {
  accountId: string;
}

/**
 * @component PromptTemplateManager
 * @description Displays and manages AI prompt templates for an account.
 */
export function PromptTemplateManager({ accountId }: PromptTemplateManagerProps) {
  const t = useTranslations("ai.components");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: templates = [], isLoading, error } = useAIPromptTemplates(accountId);
  const deleteMutation = useDeleteAIPromptTemplate();

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(templates.map((t) => t.category))).sort()],
    [templates]
  );

  const filtered = useMemo(
    () =>
      categoryFilter === "All" ? templates : templates.filter((t) => t.category === categoryFilter),
    [templates, categoryFilter]
  );

  const systemTemplates = useMemo(() => filtered.filter((t) => t.isSystem), [filtered]);
  const accountTemplates = useMemo(() => filtered.filter((t) => !t.isSystem), [filtered]);

  const handleDelete = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ templateId: deleteTarget, accountId });
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteMutation, deleteTarget, accountId]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
        role="alert"
      >
        {t("templateManager.loadError")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{t("templateManager.title")}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {t("templateManager.summary", {
              total: templates.length,
              system: systemTemplates.length,
              custom: accountTemplates.length,
            })}
          </p>
        </div>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {t("templateManager.newTemplate")}
          </button>
        )}
      </div>

      {showCreateForm && (
        <CreateTemplateForm
          accountId={accountId}
          onClose={() => setShowCreateForm(false)}
          onCreated={() => setShowCreateForm(false)}
        />
      )}

      {categories.length > 2 && (
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                categoryFilter === cat
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {cat === "All" ? t("templateManager.categoryAll") : cat}
            </button>
          ))}
        </div>
      )}

      {systemTemplates.length > 0 && (
        <section>
          <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
            {t("templateManager.systemTemplates")}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {systemTemplates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                accountId={accountId}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
          {t("templateManager.yourTemplates")}
        </h4>
        {accountTemplates.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-sm">{t("templateManager.noCustom")}</p>
            <p className="text-xs mt-1">{t("templateManager.noCustomHint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accountTemplates.map((tpl) => (
              <TemplateCard
                key={tpl.id}
                template={tpl}
                accountId={accountId}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("templateManager.deleteTitle")}
        description={t("templateManager.deleteDescription")}
        confirmLabel={t("templateManager.deleteConfirm")}
        variant="danger"
        onConfirm={handleConfirmDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
