/**
 * @file NotificationPreferences.tsx
 * @description Notification preferences form. Renders toggles for each notification type
 *              and persists via PUT /notifications/preferences.
 * @layer infrastructure
 */

"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  useNotificationPreferences,
  useSaveNotificationPreferences,
  type NotificationPreferenceDto,
} from "@/hooks/api/useNotificationsApi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationPreference = NotificationPreferenceDto;

// Translation key suffixes for each notification type. The labels and
// descriptions live under `notifications.types.<KEY>.{label,description}`.
const TYPE_KEYS = [
  "APPROVAL_REQUESTED",
  "POST_APPROVED",
  "POST_REJECTED",
  "COMMENT_ADDED",
  "COMMENT_REPLY",
  "MENTION",
] as const;

type TypeKey = (typeof TYPE_KEYS)[number];

function isKnownType(type: string): type is TypeKey {
  return (TYPE_KEYS as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Toggle component (avoids external dependency for a simple boolean toggle)
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
        checked ? "bg-blue-600" : "bg-gray-200",
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        ].join(" ")}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * @component NotificationPreferences
 * @description Notification preferences form rendering toggles for each notification
 *              type (approvals, comments, mentions). Fetches current preferences on
 *              mount and persists changes via PUT endpoint with save confirmation toast.
 */
export function NotificationPreferences() {
  const t = useTranslations("notifications");
  const [edits, setEdits] = useState<NotificationPreference[] | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch` —
  // queryOptions factory consumed via the useNotificationsApi barrel. The
  // mutation invalidates `notificationsQueries.all()` on success (no manual
  // queryClient.invalidateQueries needed in this component).
  const { data: serverPrefs, isLoading, isError } = useNotificationPreferences();

  // Derive the edit buffer from server data, discarding stale local edits
  // whenever a fresh server payload lands.
  const lastServerRef = useRef<NotificationPreference[] | undefined>(undefined);
  if (lastServerRef.current !== serverPrefs) {
    lastServerRef.current = serverPrefs;
    if (edits !== null) setEdits(null);
  }
  const localPrefs = edits ?? serverPrefs ?? [];

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const saveMutation = useSaveNotificationPreferences();

  const handleToggle = (type: string, enabled: boolean) => {
    setEdits((prev) =>
      (prev ?? serverPrefs ?? []).map((p) => (p.type === type ? { ...p, enabled } : p))
    );
  };

  const handleSave = () =>
    saveMutation.mutate(localPrefs, {
      onSuccess: () => showToast("success", t("prefsSaved")),
      onError: () => showToast("error", t("prefsSaveError")),
    });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-gray-100 p-4 animate-pulse"
          >
            <div className="space-y-1.5">
              <div className="h-4 w-40 rounded bg-gray-200" />
              <div className="h-3 w-60 rounded bg-gray-100" />
            </div>
            <div className="h-6 w-11 rounded-full bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {t("prefsLoadError")}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "rounded-lg px-4 py-3 text-sm",
            toast.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200",
          ].join(" ")}
        >
          {toast.message}
        </div>
      )}

      {/* Preferences list */}
      <div className="space-y-3">
        {localPrefs.map((pref) => {
          const known = isKnownType(pref.type);
          const label = known ? t(`types.${pref.type}.label`) : pref.type;
          const description = known ? t(`types.${pref.type}.description`) : "";
          const toggleId = `notif-toggle-${pref.type}`;

          return (
            <div
              key={pref.type}
              className="flex items-center justify-between rounded-lg border border-gray-100 bg-white p-4"
            >
              <div className="mr-4">
                <label
                  htmlFor={toggleId}
                  className="text-sm font-medium text-gray-900 cursor-pointer"
                >
                  {label}
                </label>
                {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
              </div>
              <Toggle
                id={toggleId}
                checked={pref.enabled}
                onChange={(v) => handleToggle(pref.type, v)}
              />
            </div>
          );
        })}
      </div>

      {localPrefs.length === 0 && <p className="text-sm text-gray-500">{t("prefsEmpty")}</p>}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {saveMutation.isPending ? t("savingButton") : t("saveButton")}
        </button>
      </div>
    </div>
  );
}
