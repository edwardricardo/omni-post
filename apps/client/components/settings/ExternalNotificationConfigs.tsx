/**
 * @file ExternalNotificationConfigs.tsx
 * @component ExternalNotificationConfigs
 * @description List and management of Slack/Teams webhook configurations.
 *              Add, test, and delete webhook integrations.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  useExternalNotificationConfigs,
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
} from "@/hooks/api/useExternalNotifications";
import type { CreateWebhookParams } from "@/hooks/api/useExternalNotifications";
import { AddWebhookForm } from "./AddWebhookForm.js";
import { Plus, Trash2, TestTube2 } from "lucide-react";

interface ExternalNotificationConfigsProps {
  projectId: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  slack: "Slack",
  teams: "Teams",
};

const CHANNEL_COLOURS: Record<string, string> = {
  slack: "bg-green-100 text-green-700",
  teams: "bg-blue-100 text-blue-700",
};

export function ExternalNotificationConfigs({ projectId }: ExternalNotificationConfigsProps) {
  const t = useTranslations("settings.components");
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const {
    data: configs = [],
    isLoading,
    isError,
    refetch,
  } = useExternalNotificationConfigs(projectId);
  const createMutation = useCreateWebhook(projectId);
  const deleteMutation = useDeleteWebhook(projectId);
  const testMutation = useTestWebhook();

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const handleCreate = (params: Omit<CreateWebhookParams, "projectId">) => {
    createMutation.mutate(
      { ...params, projectId },
      {
        onSuccess: () => {
          setShowAddForm(false);
          showToast("success", t("notifications.toastAdded"));
        },
        onError: () => showToast("error", t("notifications.toastAddFailed")),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeleteId(null);
        showToast("success", t("notifications.toastDeleted"));
      },
      onError: () => showToast("error", t("notifications.toastDeleteFailed")),
    });
  };

  const handleTest = (id: string) => {
    testMutation.mutate(id, {
      onSuccess: ({ sent }) =>
        showToast(
          sent ? "success" : "error",
          sent ? t("notifications.toastTestSent") : t("notifications.toastTestFailed")
        ),
      onError: () => showToast("error", t("notifications.toastTestRequestFailed")),
    });
  };

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed bottom-4 right-4 z-50 rounded-lg px-4 py-3 text-sm shadow-md border",
            toast.type === "success"
              ? "bg-green-50 text-green-800 border-green-200"
              : "bg-red-50 text-red-800 border-red-200",
          ].join(" ")}
        >
          {toast.message}
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t("notifications.title")}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t("notifications.subtitle")}</p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("notifications.addWebhook")}
          </button>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 p-4 animate-pulse flex justify-between"
              >
                <div className="space-y-1.5">
                  <div className="h-4 w-32 rounded bg-gray-200" />
                  <div className="h-3 w-48 rounded bg-gray-100" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-14 rounded bg-gray-200" />
                  <div className="h-7 w-7 rounded bg-gray-200" />
                </div>
              </div>
            ))}
          </div>
        )}

        {isError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
          >
            <p className="text-sm text-red-700">{t("notifications.loadError")}</p>
            <button
              onClick={() => void refetch()}
              className="text-xs text-red-600 hover:underline ml-auto"
            >
              {t("notifications.retry")}
            </button>
          </div>
        )}

        {!isLoading && !isError && configs.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center">
            <p className="text-sm text-gray-500">{t("notifications.emptyTitle")}</p>
            <p className="text-xs text-gray-400 mt-1">{t("notifications.emptyHint")}</p>
          </div>
        )}

        {configs.map((config) => (
          <div
            key={config.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CHANNEL_COLOURS[config.channel] ?? "bg-gray-100 text-gray-700"}`}
              >
                {CHANNEL_LABELS[config.channel] ?? config.channel}
              </span>
              <div>
                <p className="text-sm font-medium text-gray-900">{config.label}</p>
                <p className="text-xs text-gray-500">
                  {t("notifications.eventCount", { count: config.events.length })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleTest(config.id)}
                disabled={testMutation.isPending}
                title={t("notifications.testTitle")}
                className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <TestTube2 className="h-3.5 w-3.5" />
                {t("notifications.test")}
              </button>
              <button
                onClick={() => setDeleteId(config.id)}
                title={t("notifications.deleteTitle")}
                className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add webhook modal */}
      {showAddForm && (
        <AddWebhookForm
          onSubmit={handleCreate}
          onClose={() => setShowAddForm(false)}
          isPending={createMutation.isPending}
        />
      )}

      {/* Delete confirmation */}
      {deleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-webhook-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <button
            type="button"
            aria-label={t("notifications.closeDeleteDialog")}
            className="absolute inset-0 cursor-default"
            onClick={() => setDeleteId(null)}
          />
          <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 id="delete-webhook-title" className="text-base font-semibold text-gray-900">
              {t("notifications.deleteDialogTitle")}
            </h3>
            <p className="mt-2 text-sm text-gray-500">{t("notifications.deleteDialogBody")}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                {t("notifications.cancel")}
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? t("notifications.deleting") : t("notifications.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
