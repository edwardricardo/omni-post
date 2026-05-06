/**
 * @file page.tsx
 * @description Admin form for cross-tenant ApiKey rotation. Operator inputs
 *              the api key id (from incident log or tenant ticket); rotation
 *              is performed via the existing RotateApiKeyUseCase wrapped with
 *              admin auth. The new raw key is shown ONCE and never recoverable.
 * @component AdminApiKeyRotatePage
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useApiKeyAdminRotate } from "@/hooks/api/useApiKeyAdminRotate";
import { getErrorMessage } from "@/lib/parseApiError";
import { PageHeader } from "@/components/ui/PageHeader";

export default function AdminApiKeyRotatePage() {
  const [apiKeyId, setApiKeyId] = useState("");
  const mutation = useApiKeyAdminRotate();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!apiKeyId.trim()) return;
    mutation.mutate({ apiKeyId: apiKeyId.trim() });
  };

  return (
    <div>
      <PageHeader
        title="Rotate API key (admin override)"
        description="Cross-tenant ApiKey rotation. Old key invalidated immediately. New raw key shown ONCE — operator must copy it and deliver to the tenant securely. Audit-logged."
      />

      <form onSubmit={handleSubmit} className="max-w-xl space-y-4">
        <div>
          <label
            htmlFor="apiKeyId"
            className="mb-1 block text-sm font-medium text-[var(--text-primary)]"
          >
            API Key ID
          </label>
          <input
            id="apiKeyId"
            type="text"
            required
            value={apiKeyId}
            onChange={(e) => setApiKeyId(e.target.value)}
            placeholder="ak_..."
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
            disabled={mutation.isPending}
          />
        </div>

        <button
          type="submit"
          disabled={mutation.isPending || !apiKeyId.trim()}
          className="rounded-md bg-[var(--error)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {mutation.isPending ? "Rotating…" : "Rotate API key"}
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
            Rotated. The new raw key is below — copy it now, it will not be shown again.
          </p>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              New raw key
            </p>
            <code className="mt-1 block break-all rounded bg-[var(--bg-surface)] px-2 py-1 text-xs">
              {mutation.data.rawKey}
            </code>
          </div>
          {mutation.data.accountId && (
            <p className="text-xs text-[var(--text-secondary)]">
              Account: <strong>{mutation.data.accountId}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
