/**
 * @file page.tsx
 * @description Admin form for triggering force re-auth on a single channel.
 *              MVP scope: input channel ID + optional reason. Cross-tenant
 *              listing UI deferred. Click submit → POST → audit log + toast.
 * @component AdminForceReauthPage
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useChannelForceReauth } from "@/hooks/api/useChannelForceReauth";
import { getErrorMessage } from "@/lib/parseApiError";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AdminForceReauthPage() {
  const [channelId, setChannelId] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useChannelForceReauth();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!channelId.trim()) return;
    mutation.mutate({
      channelId: channelId.trim(),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  };

  return (
    <div>
      <PageHeader
        title="Force channel re-auth"
        description="Flag a connected channel as needing re-authorization. The next refresh will fail naturally and the tenant sees a reconnect banner. Action is audit-logged."
      />

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <div>
          <label
            htmlFor="channelId"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Channel ID
          </label>
          <input
            id="channelId"
            type="text"
            required
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="550e8400-e29b-41d4-a716-446655440000"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <div>
          <label
            htmlFor="reason"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Reason (optional)
          </label>
          <input
            id="reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. post Facebook secret rotation 2026-05-06"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <button
          type="submit"
          disabled={mutation.isPending || !channelId.trim()}
          className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Flagging…" : "Force re-auth"}
        </button>
      </form>

      {mutation.isError && (
        <div
          className="mt-4 max-w-xl rounded-md border border-[var(--error)] bg-[var(--error-subtle)] p-3"
          role="alert"
        >
          <p className="text-sm text-[var(--error)]">{getErrorMessage(mutation.error)}</p>
        </div>
      )}

      {mutation.isSuccess && (
        <div
          className="mt-4 max-w-xl rounded-md border border-[var(--success)] bg-[var(--success-subtle)] p-3"
          role="status"
        >
          <p className="text-sm text-[var(--success)]">
            Channel {mutation.data.channelId} ({mutation.data.provider}) flagged for re-auth at{" "}
            {new Date(mutation.data.authFailedAt).toLocaleString()}.
          </p>
        </div>
      )}
    </div>
  );
}
