/**
 * @file NotificationPreferences.tsx
 * @description Notification preferences form. Renders toggles for each notification type
 *              and persists via PUT /notifications/preferences.
 * @layer ui
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotificationPreference {
  type: string;
  enabled: boolean;
}

// Human-readable labels for each notification type
const TYPE_LABELS: Record<string, { label: string; description: string }> = {
  APPROVAL_REQUESTED: {
    label: "Approval requested",
    description: "When a post is submitted for your review",
  },
  POST_APPROVED: {
    label: "Post approved",
    description: "When your submitted post is approved",
  },
  POST_REJECTED: {
    label: "Post rejected",
    description: "When your submitted post is rejected with feedback",
  },
  COMMENT_ADDED: {
    label: "Comment added",
    description: "When someone comments on your post",
  },
  COMMENT_REPLY: {
    label: "Comment reply",
    description: "When someone replies to your comment",
  },
  MENTION: {
    label: "Mention",
    description: "When someone @mentions you in a post or comment",
  },
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPreferences(): Promise<NotificationPreference[]> {
  const res = await fetch("/api/backend/notifications/preferences", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch preferences");
  const data = (await res.json()) as { ok: boolean; value?: NotificationPreference[] };
  return data.ok && data.value ? data.value : [];
}

async function savePreferences(preferences: NotificationPreference[]): Promise<void> {
  const res = await fetch("/api/backend/notifications/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences }),
  });
  if (!res.ok) throw new Error("Failed to save preferences");
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

export function NotificationPreferences() {
  const queryClient = useQueryClient();
  const [localPrefs, setLocalPrefs] = useState<NotificationPreference[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const {
    data: serverPrefs,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: fetchPreferences,
    staleTime: 60_000,
  });

  // Initialise local state from server data
  useEffect(() => {
    if (serverPrefs) setLocalPrefs(serverPrefs);
  }, [serverPrefs]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const saveMutation = useMutation({
    mutationFn: savePreferences,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
      showToast("success", "Preferences saved");
    },
    onError: () => showToast("error", "Failed to save preferences"),
  });

  const handleToggle = (type: string, enabled: boolean) => {
    setLocalPrefs((prev) => prev.map((p) => (p.type === type ? { ...p, enabled } : p)));
  };

  const handleSave = () => saveMutation.mutate(localPrefs);

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
      <p className="text-sm text-red-600">
        Failed to load notification preferences. Please refresh.
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
          const meta = TYPE_LABELS[pref.type];
          const label = meta?.label ?? pref.type;
          const description = meta?.description ?? "";
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

      {localPrefs.length === 0 && (
        <p className="text-sm text-gray-500">No notification preferences available.</p>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {saveMutation.isPending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </div>
  );
}
