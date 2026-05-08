/**
 * @file AddWebhookForm.tsx
 * @component AddWebhookForm
 * @description Dialog form for adding a new Slack or Teams webhook configuration.
 *              Validates HTTPS URL and requires at least 1 event selected.
 * @layer infrastructure
 */

"use client";

import { useState } from "react";
import type { CreateWebhookParams } from "@/hooks/api/useExternalNotifications";

const SUPPORTED_EVENTS = [
  { value: "post_published", label: "Post published" },
  { value: "post_failed", label: "Post failed" },
  { value: "approval_pending", label: "Approval pending" },
  { value: "approval_approved", label: "Approval approved" },
  { value: "approval_rejected", label: "Approval rejected" },
  { value: "crisis_mode_entered", label: "Crisis mode entered" },
  { value: "crisis_mode_exited", label: "Crisis mode exited" },
];

interface AddWebhookFormProps {
  onSubmit: (params: Omit<CreateWebhookParams, "projectId">) => void;
  onClose: () => void;
  isPending: boolean;
}

export function AddWebhookForm({ onSubmit, onClose, isPending }: AddWebhookFormProps) {
  const [channel, setChannel] = useState<"slack" | "teams">("slack");
  const [label, setLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [urlError, setUrlError] = useState<string | null>(null);

  const toggleEvent = (event: string) => {
    setEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        setUrlError("Webhook URL must use HTTPS");
        return false;
      }
      setUrlError(null);
      return true;
    } catch {
      setUrlError("Enter a valid URL");
      return false;
    }
  };

  const canSubmit =
    label.trim() &&
    webhookUrl.trim() &&
    !urlError &&
    webhookUrl.startsWith("https://") &&
    events.length > 0;

  const handleSubmit = () => {
    if (!validateUrl(webhookUrl)) return;
    if (events.length === 0) return;
    onSubmit({ channel, webhookUrl: webhookUrl.trim(), label: label.trim(), events });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-webhook-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <button
        type="button"
        aria-label="Close add webhook dialog"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <h3 id="add-webhook-title" className="text-base font-semibold text-gray-900">
          Add Webhook
        </h3>

        <div className="mt-4 space-y-4">
          {/* Channel */}
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-xs font-medium text-gray-700 mb-1.5 p-0">Channel</legend>
            <div className="flex gap-3">
              {(["slack", "teams"] as const).map((c) => (
                <label key={c} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="channel"
                    value={c}
                    checked={channel === c}
                    onChange={() => setChannel(c)}
                    className="text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium capitalize">
                    {c === "teams" ? "Microsoft Teams" : "Slack"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {/* Label */}
          <div>
            <label htmlFor="webhook-label" className="block text-xs font-medium text-gray-700 mb-1">
              Label
            </label>
            <input
              id="webhook-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. #social-media-alerts"
              className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Webhook URL */}
          <div>
            <label htmlFor="webhook-url" className="block text-xs font-medium text-gray-700 mb-1">
              Webhook URL (HTTPS required)
            </label>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                if (e.target.value) validateUrl(e.target.value);
                else setUrlError(null);
              }}
              placeholder="https://hooks.slack.com/services/…"
              aria-invalid={urlError ? "true" : undefined}
              aria-describedby={urlError ? "webhook-url-error" : undefined}
              className={[
                "w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2",
                urlError
                  ? "border-red-400 focus:ring-red-400"
                  : "border-gray-200 focus:ring-indigo-500",
              ].join(" ")}
            />
            {urlError && (
              <p id="webhook-url-error" role="alert" className="mt-1 text-xs text-red-600">
                {urlError}
              </p>
            )}
          </div>

          {/* Events */}
          <fieldset className="border-0 p-0 m-0 min-w-0">
            <legend className="block text-xs font-medium text-gray-700 mb-2 p-0">
              Events (select at least 1)
            </legend>
            <div className="space-y-2">
              {SUPPORTED_EVENTS.map((e) => (
                <label key={e.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.includes(e.value)}
                    onChange={() => toggleEvent(e.value)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700">{e.label}</span>
                </label>
              ))}
            </div>
            {events.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">Select at least one event</p>
            )}
          </fieldset>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isPending}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {isPending ? "Adding…" : "Add Webhook"}
          </button>
        </div>
      </div>
    </div>
  );
}
