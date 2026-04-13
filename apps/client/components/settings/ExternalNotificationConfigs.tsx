/**
 * @file ExternalNotificationConfigs.tsx
 * @component ExternalNotificationConfigs
 * @description List and management of Slack/Teams webhook configurations.
 *              Add, test, and delete webhook integrations.
 * @layer ui
 */

"use client";

import { useState, useCallback } from "react";
import {
  useExternalNotificationConfigs,
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
} from "@/hooks/api/useExternalNotifications";
import type { CreateWebhookParams } from "@/hooks/api/useExternalNotifications";
import { AddWebhookForm } from "./AddWebhookForm";
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
          showToast("success", "Webhook added successfully");
        },
        onError: () => showToast("error", "Failed to add webhook"),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => {
        setDeleteId(null);
        showToast("success", "Webhook deleted");
      },
      onError: () => showToast("error", "Failed to delete webhook"),
    });
  };

  const handleTest = (id: string) => {
    testMutation.mutate(id, {
      onSuccess: ({ sent }) =>
        showToast(sent ? "success" : "error", sent ? "Test notification sent!" : "Test failed"),
      onError: () => showToast("error", "Test request failed"),
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
            <h2 className="text-base font-semibold text-gray-900">External Notifications</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Send notifications to Slack or Teams channels via webhooks.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Webhook
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
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">Failed to load webhook configs</p>
            <button
              onClick={() => void refetch()}
              className="text-xs text-red-600 hover:underline ml-auto"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && configs.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 py-10 text-center">
            <p className="text-sm text-gray-500">No webhook integrations configured</p>
            <p className="text-xs text-gray-400 mt-1">Add one using the button above</p>
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
                  {config.events.length} event{config.events.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleTest(config.id)}
                disabled={testMutation.isPending}
                title="Send test notification"
                className="flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <TestTube2 className="h-3.5 w-3.5" />
                Test
              </button>
              <button
                onClick={() => setDeleteId(config.id)}
                title="Delete webhook"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteId(null);
          }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-gray-900">Delete Webhook</h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to delete this webhook? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteId)}
                disabled={deleteMutation.isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
