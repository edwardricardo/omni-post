/**
 * @file page.tsx
 * @description Admin form for rotating a WebhookSubscription.secretKey with
 *              a configurable grace window. MVP scope: input subscription ID
 *              + optional grace hours. The new raw secret is shown ONCE in
 *              the success banner — operator must copy it and update the
 *              provider before the grace window expires.
 * @component AdminWebhookRotateSecretPage
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useWebhookRotateSecret } from "@/hooks/api/useWebhookRotateSecret";
import { getErrorMessage } from "@/lib/parseApiError";
import { PageHeader } from "@/components/ui/PageHeader";

const DEFAULT_GRACE_HOURS = 24;

export default function AdminWebhookRotateSecretPage() {
  const [subscriptionId, setSubscriptionId] = useState("");
  const [graceHours, setGraceHours] = useState<number>(DEFAULT_GRACE_HOURS);
  const mutation = useWebhookRotateSecret();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!subscriptionId.trim()) return;
    mutation.mutate({
      webhookSubscriptionId: subscriptionId.trim(),
      graceWindowHours: graceHours,
    });
  };

  return (
    <div>
      <PageHeader
        title="Rotate webhook secret"
        description="Generate a new HMAC secret and keep the previous one valid for the grace window. Audit-logged. The provider must be updated with the new secret before the window expires."
      />

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <div>
          <label
            htmlFor="subscriptionId"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            WebhookSubscription ID
          </label>
          <input
            id="subscriptionId"
            type="text"
            required
            value={subscriptionId}
            onChange={(e) => setSubscriptionId(e.target.value)}
            placeholder="550e8400-e29b-41d4-a716-446655440000"
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <div>
          <label
            htmlFor="graceHours"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            Grace window (hours, 1–720)
          </label>
          <input
            id="graceHours"
            type="number"
            min={1}
            max={720}
            value={graceHours}
            onChange={(e) => setGraceHours(parseInt(e.target.value, 10) || DEFAULT_GRACE_HOURS)}
            className="w-32 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            During this window, the HMAC verifier accepts both the new and the previous secret.
          </p>
        </div>

        <button
          type="submit"
          disabled={mutation.isPending || !subscriptionId.trim()}
          className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Rotating…" : "Rotate secret"}
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
          className="mt-4 max-w-xl space-y-3 rounded-md border border-[var(--success)] bg-[var(--success-subtle)] p-3"
          role="status"
        >
          <p className="text-sm font-medium text-[var(--success)]">
            Rotation successful. Copy the new secret now — it will not be shown again.
          </p>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              New secret
            </p>
            <code className="mt-1 block break-all rounded bg-[var(--bg-surface)] px-2 py-1 text-xs">
              {mutation.data.newSecretKey}
            </code>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Old secret valid until{" "}
            <strong>{new Date(mutation.data.previousSecretKeyExpiresAt).toLocaleString()}</strong> (
            {mutation.data.graceWindowHours}h grace window).
          </p>
        </div>
      )}
    </div>
  );
}
